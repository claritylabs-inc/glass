"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { ImapFlow } from "imapflow";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";

const SCAN_OVERLAP_MS = 5 * 60 * 1000;

function hasImapAttachmentParts(structure: any): boolean {
  if (!structure) return false;
  if (structure.disposition === "attachment") return true;
  if (structure.type === "application/pdf") return true;
  if (structure.childNodes) {
    return structure.childNodes.some((child: any) => hasImapAttachmentParts(child));
  }
  return false;
}

function hasGmailAttachmentParts(payload: any): boolean {
  if (!payload) return false;
  if (payload.filename && payload.body?.attachmentId) return true;
  if (payload.parts) {
    return payload.parts.some((part: any) => hasGmailAttachmentParts(part));
  }
  return false;
}

function getHeader(
  headers: Array<{ name?: string | null; value?: string | null }>,
  name: string,
): string {
  const header = headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  );
  return header?.value || "";
}

/**
 * Cron entry point: queries all active email connections and schedules
 * individual scans for each one.
 */
export const runDailyScan = internalAction({
  args: {},
  returns: v.object({ scheduled: v.number() }),
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const connections: any[] = await ctx.runQuery(
      internal.connections.listAllInternal,
    );

    const active = connections.filter(
      (c) => c.lastScanStatus !== "disconnected" && c.provider !== "demo",
    );

    for (const connection of active) {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.dailyScan.scanSingleConnection,
        { connectionId: connection._id },
      );
    }

    return { scheduled: active.length };
  },
});

/**
 * Scans a single email connection without auth context.
 * Determines the provider and runs the appropriate scan logic.
 */
export const scanSingleConnection = internalAction({
  args: {
    connectionId: v.id("emailConnections"),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.runQuery(
      internal.connections.getInternal,
      { id: args.connectionId },
    );
    if (!connection) return { error: "Connection not found" };

    const latestImported = await ctx.runQuery(
      internal.emails.latestImportedAtByConnection,
      { connectionId: args.connectionId },
    );
    const scanAnchorMs =
      latestImported?.timestamp
      ?? connection.lastScanAt
      ?? Date.now() - 14 * 24 * 60 * 60 * 1000;
    const since = new Date(scanAnchorMs - SCAN_OVERLAP_MS);

    const userId = connection.userId;
    const orgId = connection.orgId;

    await ctx.runMutation(api.connections.updateScanStatus, {
      id: args.connectionId,
      lastScanStatus: "scanning",
      lastScanAt: Date.now(),
    });

    await ctx.runMutation(api.connections.updateScanProgress, {
      id: args.connectionId,
      scanProgress: { phase: "fetching" },
    });

    const startTime = Date.now();
    const scanLogId = await ctx.runMutation(internal.emailScanLogs.insert, {
      orgId: orgId ?? undefined,
      connectionId: args.connectionId,
      connectionLabel: connection.label,
      trigger: "daily" as const,
      status: "running",
      inboxFound: 0,
      sentFound: 0,
      totalInserted: 0,
      duplicatesSkipped: 0,
      durationMs: 0,
      log: ["Daily scan started"],
    });

    try {
      let result: { emailsFound: number };

      if (connection.provider === "google") {
        result = await scanGmailInternal(ctx, connection, args.connectionId, since, userId, orgId);
      } else {
        result = await scanImapInternal(ctx, connection, args.connectionId, since, userId, orgId);
      }

      await ctx.runMutation(api.connections.updateScanProgress, {
        id: args.connectionId,
        scanProgress: {
          phase: "complete",
          totalEmails: result.emailsFound,
          processedEmails: 0,
        },
      });

      await ctx.runMutation(api.connections.updateScanStatus, {
        id: args.connectionId,
        lastScanStatus: "success",
        lastScanAt: Date.now(),
        emailsFound: result.emailsFound,
      });

      await ctx.runMutation(internal.emailScanLogs.update, {
        id: scanLogId,
        status: "success",
        totalInserted: result.emailsFound,
        durationMs: Date.now() - startTime,
        log: [
          "Daily scan started",
          `Inserted ${result.emailsFound} new emails`,
          "Complete",
        ],
      });

      if (userId) {
        await ctx.scheduler.runAfter(
          0,
          internal.actions.classifyEmails.classifyEmails,
          { connectionId: args.connectionId, userId, orgId },
        );
      }

      return result;
    } catch (error: any) {
      const message = error.message || "Unknown error";

      await ctx.runMutation(api.connections.updateScanStatus, {
        id: args.connectionId,
        lastScanStatus: "error",
        lastScanError: `Daily scan failed: ${message}`,
      });

      await ctx.runMutation(api.connections.updateScanProgress, {
        id: args.connectionId,
        scanProgress: { phase: "complete" },
      });

      try {
        await ctx.runMutation(internal.emailScanLogs.update, {
          id: scanLogId,
          status: "error",
          error: message,
          log: ["Daily scan started", `Error: ${message}`],
        });
      } catch { /* scanLogId may not exist */ }

      return { error: message };
    }
  },
});

// ---------------------------------------------------------------------------
// IMAP scan logic (mirrors scanInbox.ts without auth)
// ---------------------------------------------------------------------------
async function scanImapInternal(
  ctx: any,
  connection: any,
  connectionId: any,
  since: Date,
  userId: any,
  orgId: any,
) {
  if (!connection.imapHost || !connection.imapPort || !connection.password) {
    throw new Error("IMAP connection missing host, port, or password");
  }

  const client = new ImapFlow({
    host: connection.imapHost,
    port: connection.imapPort,
    secure: true,
    auth: { user: connection.email, pass: connection.password },
    logger: false,
  });

  const emails: Array<{
    uid: number;
    messageId: string;
    subject: string;
    from: string;
    date: string;
    hasAttachments: boolean;
  }> = [];

  const searchCriteria: any = { since };

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      for await (const message of client.fetch(searchCriteria, {
        uid: true,
        envelope: true,
        bodyStructure: true,
      })) {
        const envelope = message.envelope!;
        const from = envelope.from?.[0];
        const fromStr = from
          ? `${from.name || ""} <${from.address || ""}>`
          : "Unknown";

        emails.push({
          uid: message.uid,
          messageId: envelope.messageId || `uid-${message.uid}`,
          subject: envelope.subject || "(No Subject)",
          from: fromStr,
          date: envelope.date?.toISOString() || new Date().toISOString(),
          hasAttachments: hasImapAttachmentParts(message.bodyStructure),
        });
      }
    } finally {
      lock.release();
    }

    // Also scan Sent mailbox
    const sentEmails: typeof emails = [];
    try {
      const sentLock = await client.getMailboxLock("[Gmail]/Sent Mail");
      try {
        for await (const message of client.fetch(searchCriteria, {
          uid: true,
          envelope: true,
          bodyStructure: true,
        })) {
          const envelope = message.envelope!;
          const from = envelope.from?.[0];
          const fromStr = from
            ? `${from.name || ""} <${from.address || ""}>`
            : "Unknown";

          sentEmails.push({
            uid: message.uid,
            messageId: envelope.messageId || `uid-${message.uid}`,
            subject: envelope.subject || "(No Subject)",
            from: fromStr,
            date: envelope.date?.toISOString() || new Date().toISOString(),
            hasAttachments: hasImapAttachmentParts(message.bodyStructure),
          });
        }
      } finally {
        sentLock.release();
      }
    } catch {
      try {
        const sentLock2 = await client.getMailboxLock("Sent");
        try {
          for await (const message of client.fetch(searchCriteria, {
            uid: true,
            envelope: true,
            bodyStructure: true,
          })) {
            const envelope = message.envelope!;
            const from = envelope.from?.[0];
            const fromStr = from
              ? `${from.name || ""} <${from.address || ""}>`
              : "Unknown";

            sentEmails.push({
              uid: message.uid,
              messageId: envelope.messageId || `uid-${message.uid}`,
              subject: envelope.subject || "(No Subject)",
              from: fromStr,
              date: envelope.date?.toISOString() || new Date().toISOString(),
              hasAttachments: hasImapAttachmentParts(message.bodyStructure),
            });
          }
        } finally {
          sentLock2.release();
        }
      } catch {
        // No accessible sent mailbox — continue with inbox only
      }
    }

    // Merge inbox + sent, dedup by messageId
    const seenIds = new Set(emails.map((e) => e.messageId));
    for (const se of sentEmails) {
      if (!seenIds.has(se.messageId)) {
        emails.push(se);
        seenIds.add(se.messageId);
      }
    }

    await client.logout();
  } catch (error) {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
    throw error;
  }

  await ctx.runMutation(api.connections.updateScanProgress, {
    id: connectionId,
    scanProgress: { phase: "fetching", totalEmails: emails.length },
  });

  let inserted = 0;
  for (const email of emails) {
    const result = await ctx.runMutation(api.emails.insert, {
      userId,
      orgId,
      connectionId,
      messageId: email.messageId,
      uid: email.uid,
      subject: email.subject,
      from: email.from,
      date: email.date,
      hasAttachments: email.hasAttachments,
      processed: false,
    });
    if (result.inserted) inserted++;
  }

  return { emailsFound: inserted };
}

// ---------------------------------------------------------------------------
// Gmail scan logic (mirrors scanGmail.ts without auth)
// ---------------------------------------------------------------------------
async function scanGmailInternal(
  ctx: any,
  connection: any,
  connectionId: any,
  since: Date,
  userId: any,
  orgId: any,
) {
  const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
  });

  // Token refresh if within 5 minutes of expiry
  if (
    connection.tokenExpiry &&
    connection.tokenExpiry - Date.now() < 5 * 60 * 1000
  ) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      await ctx.runMutation(internal.connections.updateTokens, {
        id: connectionId,
        accessToken: credentials.access_token!,
        tokenExpiry: credentials.expiry_date!,
      });
      oauth2Client.setCredentials(credentials);
    } catch (refreshError: any) {
      const status = refreshError?.response?.status || refreshError?.code;
      if (status === 401 || status === 403) {
        await ctx.runMutation(api.connections.updateScanStatus, {
          id: connectionId,
          lastScanStatus: "disconnected",
          lastScanError:
            "Google authorization expired. Please reconnect your Gmail account.",
        });
        await ctx.runMutation(api.connections.updateScanProgress, {
          id: connectionId,
          scanProgress: { phase: "complete" },
        });
        return { emailsFound: 0 };
      }
      throw refreshError;
    }
  }

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const formatDate = (d: Date) =>
    `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;

  const inboxQuery = `in:inbox after:${formatDate(since)}`;
  const sentQuery = `in:sent after:${formatDate(since)}`;

  async function listGmailIds(gmail: any, query: string): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const res = await gmail.users.messages.list({
        userId: "me",
        q: query,
        pageToken,
        maxResults: 500,
      });
      if (res.data.messages) {
        for (const msg of res.data.messages) {
          if (msg.id) ids.push(msg.id);
        }
      }
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);
    return ids;
  }

  const [inboxIds, sentIds] = await Promise.all([
    listGmailIds(gmail, inboxQuery),
    listGmailIds(gmail, sentQuery),
  ]);

  const allIdSet = new Set([...inboxIds, ...sentIds]);
  const messageIds = [...allIdSet];

  await ctx.runMutation(api.connections.updateScanProgress, {
    id: connectionId,
    scanProgress: { phase: "fetching", totalEmails: messageIds.length },
  });

  const emails: Array<{
    messageId: string;
    subject: string;
    from: string;
    date: string;
    hasAttachments: boolean;
  }> = [];

  for (const msgId of messageIds) {
    const msgResponse = await gmail.users.messages.get({
      userId: "me",
      id: msgId,
      format: "metadata",
      metadataHeaders: ["Subject", "From", "Date", "Message-ID"],
    });

    const headers = msgResponse.data.payload?.headers || [];
    const subject = getHeader(headers, "Subject") || "(No Subject)";
    const from = getHeader(headers, "From") || "Unknown";
    const dateStr = getHeader(headers, "Date");
    const messageId = getHeader(headers, "Message-ID") || `gmail-${msgId}`;

    let date: string;
    try {
      date = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();
    } catch {
      date = new Date().toISOString();
    }

    const attachments = hasGmailAttachmentParts(msgResponse.data.payload);

    emails.push({ messageId, subject, from, date, hasAttachments: attachments });
  }

  let inserted = 0;
  for (const email of emails) {
    const result = await ctx.runMutation(api.emails.insert, {
      userId,
      orgId,
      connectionId,
      messageId: email.messageId,
      subject: email.subject,
      from: email.from,
      date: email.date,
      hasAttachments: email.hasAttachments,
      processed: false,
    });
    if (result.inserted) inserted++;
  }

  return { emailsFound: inserted };
}
