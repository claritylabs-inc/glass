"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";

const SCAN_OVERLAP_MS = 5 * 60 * 1000;

function matchesDomains(fromStr: string, domains: string[]): boolean {
  const lower = fromStr.toLowerCase();
  return domains.some((d) => lower.includes(d.toLowerCase()));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasAttachmentParts(payload: any): boolean {
  if (!payload) return false;
  if (payload.filename && (payload.body as Record<string, unknown>)?.attachmentId) return true;
  if (payload.parts) {
    return (payload.parts as Record<string, unknown>[]).some((part) => hasAttachmentParts(part));
  }
  return false;
}

function getHeader(headers: Array<{ name?: string | null; value?: string | null }>, name: string): string {
  const header = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value || "";
}

export const scanGmail = action({
  args: {
    connectionId: v.id("emailConnections"),
    sinceDate: v.optional(v.string()),
    untilDate: v.optional(v.string()),
    senderDomains: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Verify auth and get userId + orgId
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) throw new Error("Not authenticated");
    const userId = viewer._id;

    // Get org membership
    const orgData = await ctx.runQuery(api.orgs.viewerOrg);
    const orgId = orgData?.org?._id;

    const connection = await ctx.runQuery(api.connections.get, {
      id: args.connectionId,
    });
    if (!connection) throw new Error("Connection not found");

    // Save scan params
    const scanParams: Record<string, unknown> = {};
    if (args.sinceDate) scanParams.sinceDate = args.sinceDate;
    if (args.untilDate) scanParams.untilDate = args.untilDate;
    if (args.senderDomains?.length) scanParams.senderDomains = args.senderDomains;
    await ctx.runMutation(api.connections.updateLastScanParams, {
      id: args.connectionId,
      lastScanParams: scanParams,
    });

    await ctx.runMutation(api.connections.updateScanStatus, {
      id: args.connectionId,
      lastScanStatus: "scanning",
      lastScanAt: Date.now(),
    });

    // Set initial progress
    await ctx.runMutation(api.connections.updateScanProgress, {
      id: args.connectionId,
      scanProgress: { phase: "fetching" },
    });

    // Create scan log entry
    const startTime = Date.now();
    let scanLogId: Id<"emailScanLogs"> | undefined;
    try {
      scanLogId = await ctx.runMutation(internal.emailScanLogs.insert, {
        orgId: orgId ?? undefined,
        connectionId: args.connectionId,
        connectionLabel: connection.label,
        trigger: "manual" as const,
        status: "running",
        sinceDate: args.sinceDate,
        untilDate: args.untilDate,
        senderDomains: args.senderDomains,
        inboxFound: 0,
        sentFound: 0,
        totalInserted: 0,
        duplicatesSkipped: 0,
        durationMs: 0,
        log: ["Scan started"],
      });
    } catch {
      // Non-fatal: scan log creation failure shouldn't block scanning
    }

    try {
      // Set up OAuth2 client
      const oauth2Client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
      );
      oauth2Client.setCredentials({
        access_token: connection.accessToken,
        refresh_token: connection.refreshToken,
      });

      // Token refresh if within 5 minutes of expiry
      if (connection.tokenExpiry && connection.tokenExpiry - Date.now() < 5 * 60 * 1000) {
        try {
          const { credentials } = await oauth2Client.refreshAccessToken();
          await ctx.runMutation(internal.connections.updateTokens, {
            id: args.connectionId,
            accessToken: credentials.access_token!,
            tokenExpiry: credentials.expiry_date!,
          });
          oauth2Client.setCredentials(credentials);
        } catch (refreshError: unknown) {
          const status = (refreshError as { response?: { status?: number }; code?: number })?.response?.status || (refreshError as { code?: number })?.code;
          if (status === 401 || status === 403) {
            await ctx.runMutation(api.connections.updateScanStatus, {
              id: args.connectionId,
              lastScanStatus: "disconnected",
              lastScanError: "Google authorization expired. Please reconnect your Gmail account.",
            });
            await ctx.runMutation(api.connections.updateScanProgress, {
              id: args.connectionId,
              scanProgress: { phase: "complete" },
            });
            return { error: "Google authorization expired. Please reconnect your Gmail account." };
          }
          throw refreshError;
        }
      }

      const gmail = google.gmail({ version: "v1", auth: oauth2Client });

      const latestImported = await ctx.runQuery(
        internal.emails.latestImportedAtByConnection,
        { connectionId: args.connectionId }
      );
      const scanAnchorMs = args.sinceDate
        ? Date.parse(args.sinceDate)
        : latestImported?.timestamp
          ?? connection.lastScanAt
          ?? Date.now() - 14 * 24 * 60 * 60 * 1000;
      const since = new Date(scanAnchorMs - (args.sinceDate ? 0 : SCAN_OVERLAP_MS));

      const before = args.untilDate
        ? new Date(new Date(args.untilDate).getTime() + 24 * 60 * 60 * 1000)
        : undefined;

      // Build base query (date + optional domain filter)
      const baseQueryParts: string[] = [];

      const formatDate = (d: Date) =>
        `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;

      baseQueryParts.push(`after:${formatDate(since)}`);
      if (before) {
        baseQueryParts.push(`before:${formatDate(before)}`);
      }

      if (args.senderDomains?.length) {
        const domainQuery = args.senderDomains
          .map((d) => `from:${d}`)
          .join(" OR ");
        baseQueryParts.push(`(${domainQuery})`);
      }

      const baseQuery = baseQueryParts.join(" ");

      // Fetch from both inbox and sent
      const inboxQuery = `in:inbox ${baseQuery}`;
      const sentQuery = `in:sent ${baseQuery}`;

      async function listAllMessageIds(query: string): Promise<string[]> {
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
        listAllMessageIds(inboxQuery),
        listAllMessageIds(sentQuery),
      ]);

      // Merge and dedup
      const allIdSet = new Set([...inboxIds, ...sentIds]);
      const messageIds = [...allIdSet];

      if (scanLogId) {
        await ctx.runMutation(internal.emailScanLogs.update, {
          id: scanLogId,
          inboxFound: inboxIds.length,
          sentFound: sentIds.length,
          log: [
            "Scan started",
            `Found ${inboxIds.length} inbox emails`,
            `Found ${sentIds.length} sent emails`,
            `${messageIds.length} unique after dedup`,
          ],
        });
      }

      // Update progress with total count
      await ctx.runMutation(api.connections.updateScanProgress, {
        id: args.connectionId,
        scanProgress: { phase: "fetching", totalEmails: messageIds.length },
      });

      // Fetch each message metadata
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

        // Parse date
        let date: string;
        try {
          date = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();
        } catch {
          date = new Date().toISOString();
        }

        // Apply sender domain filter (Gmail query may be imprecise, double-check)
        if (args.senderDomains?.length && !matchesDomains(from, args.senderDomains)) {
          continue;
        }

        const attachments = hasAttachmentParts(msgResponse.data.payload);

        emails.push({
          messageId,
          subject,
          from,
          date,
          hasAttachments: attachments,
        });
      }

      // Insert new emails (dedup handled by mutation)
      let inserted = 0;
      for (const email of emails) {
        const result = await ctx.runMutation(api.emails.insert, {
          userId,
          orgId,
          connectionId: args.connectionId,
          messageId: email.messageId,
          subject: email.subject,
          from: email.from,
          date: email.date,
          hasAttachments: email.hasAttachments,
          processed: false,
        });
        if (result.inserted) inserted++;
      }

      await ctx.runMutation(api.connections.updateScanProgress, {
        id: args.connectionId,
        scanProgress: { phase: "complete", totalEmails: inserted, processedEmails: 0 },
      });

      await ctx.runMutation(api.connections.updateScanStatus, {
        id: args.connectionId,
        lastScanStatus: "success",
        lastScanAt: Date.now(),
        emailsFound: inserted,
      });

      await ctx.scheduler.runAfter(
        0,
        internal.actions.classifyEmails.classifyEmails,
        { connectionId: args.connectionId, userId, orgId }
      );

      const duplicatesSkipped = emails.length - inserted;
      if (scanLogId) {
        await ctx.runMutation(internal.emailScanLogs.update, {
          id: scanLogId,
          status: "success",
          totalInserted: inserted,
          duplicatesSkipped,
          durationMs: Date.now() - startTime,
          log: [
            "Scan started",
            `Found ${inboxIds.length} inbox emails`,
            `Found ${sentIds.length} sent emails`,
            `${messageIds.length} unique after dedup`,
            `Inserted ${inserted} new emails (${duplicatesSkipped} already imported)`,
            `Complete (${Math.round((Date.now() - startTime) / 1000)}s)`,
          ],
        });
      }

      return { emailsFound: inserted };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status = (error as { response?: { status?: number }; code?: number })?.response?.status || (error as { code?: number })?.code;

      let friendlyError: string;
      if (status === 401 || status === 403 || message.includes("invalid_grant")) {
        friendlyError = "Google authorization expired or was revoked. Please reconnect your Gmail account.";
        await ctx.runMutation(api.connections.updateScanStatus, {
          id: args.connectionId,
          lastScanStatus: "disconnected",
          lastScanError: friendlyError,
        });
      } else if (status === 429 || message.includes("rateLimitExceeded")) {
        friendlyError = "Gmail API rate limit exceeded. Please try again in a few minutes.";
        await ctx.runMutation(api.connections.updateScanStatus, {
          id: args.connectionId,
          lastScanStatus: "error",
          lastScanError: friendlyError,
        });
      } else if (message.includes("ENOTFOUND") || message.includes("getaddrinfo")) {
        friendlyError = "Could not connect to Gmail API — check your network connection.";
        await ctx.runMutation(api.connections.updateScanStatus, {
          id: args.connectionId,
          lastScanStatus: "error",
          lastScanError: friendlyError,
        });
      } else {
        friendlyError = `Gmail scan failed: ${message}`;
        await ctx.runMutation(api.connections.updateScanStatus, {
          id: args.connectionId,
          lastScanStatus: "error",
          lastScanError: friendlyError,
        });
      }

      if (scanLogId) {
        try {
          await ctx.runMutation(internal.emailScanLogs.update, {
            id: scanLogId,
            status: "error",
            error: friendlyError,
            durationMs: Date.now() - startTime,
            log: [
              "Scan started",
              `Error: ${friendlyError}`,
            ],
          });
        } catch {
          // Non-fatal: scan log update failure shouldn't block error handling
        }
      }

      await ctx.runMutation(api.connections.updateScanProgress, {
        id: args.connectionId,
        scanProgress: { phase: "complete" },
      });

      return { error: friendlyError };
    }
  },
});
