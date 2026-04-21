"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { ImapFlow } from "imapflow";

const SCAN_OVERLAP_MS = 5 * 60 * 1000;

function hasAttachmentParts(structure: unknown): boolean {
  if (!structure) return false;
  const s = structure as { disposition?: string; type?: string; childNodes?: unknown[] };
  if (s.disposition === "attachment") return true;
  if (s.type === "application/pdf") return true;
  if (s.childNodes) {
    return s.childNodes.some((child) => hasAttachmentParts(child));
  }
  return false;
}

function matchesDomains(fromStr: string, domains: string[]): boolean {
  const lower = fromStr.toLowerCase();
  return domains.some((d) => lower.includes(d.toLowerCase()));
}

export const scanInbox = action({
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
    const orgData = await ctx.runQuery(api.orgs.viewerOrg, {});
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

    const startTime = Date.now();
    const scanLogId = await ctx.runMutation(internal.emailScanLogs.insert, {
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

    try {
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

      // Build IMAP search criteria
      const searchCriteria: Record<string, unknown> = { since };
      if (before) searchCriteria.before = before;

      // Fetch emails via IMAP
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
      const sentEmails: typeof emails = [];

      try {
        await client.connect();
        const lock = await client.getMailboxLock("INBOX");
        try {
          for await (const message of client.fetch(
            searchCriteria,
            { uid: true, envelope: true, bodyStructure: true }
          )) {
            const envelope = message.envelope!;
            const from = envelope.from?.[0];
            const fromStr = from
              ? `${from.name || ""} <${from.address || ""}>`
              : "Unknown";

            // Apply sender domain filter
            if (args.senderDomains?.length && !matchesDomains(fromStr, args.senderDomains)) {
              continue;
            }

            emails.push({
              uid: message.uid,
              messageId: envelope.messageId || `uid-${message.uid}`,
              subject: envelope.subject || "(No Subject)",
              from: fromStr,
              date: envelope.date?.toISOString() || new Date().toISOString(),
              hasAttachments: hasAttachmentParts(message.bodyStructure),
            });
          }
        } finally {
          lock.release();
        }

        // Also scan Sent mailbox
        try {
          const sentLock = await client.getMailboxLock("[Gmail]/Sent Mail");
          try {
            for await (const message of client.fetch(
              searchCriteria,
              { uid: true, envelope: true, bodyStructure: true }
            )) {
              const envelope = message.envelope!;
              const from = envelope.from?.[0];
              const fromStr = from
                ? `${from.name || ""} <${from.address || ""}>`
                : "Unknown";

              if (args.senderDomains?.length && !matchesDomains(fromStr, args.senderDomains)) {
                continue;
              }

              sentEmails.push({
                uid: message.uid,
                messageId: envelope.messageId || `uid-${message.uid}`,
                subject: envelope.subject || "(No Subject)",
                from: fromStr,
                date: envelope.date?.toISOString() || new Date().toISOString(),
                hasAttachments: hasAttachmentParts(message.bodyStructure),
              });
            }
          } finally {
            sentLock.release();
          }
        } catch {
          // Try common alternative name
          try {
            const sentLock2 = await client.getMailboxLock("Sent");
            try {
              for await (const message of client.fetch(
                searchCriteria,
                { uid: true, envelope: true, bodyStructure: true }
              )) {
                const envelope = message.envelope!;
                const from = envelope.from?.[0];
                const fromStr = from
                  ? `${from.name || ""} <${from.address || ""}>`
                  : "Unknown";

                if (args.senderDomains?.length && !matchesDomains(fromStr, args.senderDomains)) {
                  continue;
                }

                sentEmails.push({
                  uid: message.uid,
                  messageId: envelope.messageId || `uid-${message.uid}`,
                  subject: envelope.subject || "(No Subject)",
                  from: fromStr,
                  date: envelope.date?.toISOString() || new Date().toISOString(),
                  hasAttachments: hasAttachmentParts(message.bodyStructure),
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
        try { await client.logout(); } catch { /* ignore */ }
        throw error;
      }

      // Update progress with email count
      await ctx.runMutation(api.connections.updateScanProgress, {
        id: args.connectionId,
        scanProgress: { phase: "fetching", totalEmails: emails.length },
      });

      const inboxCount = emails.length - sentEmails.length;
      await ctx.runMutation(internal.emailScanLogs.update, {
        id: scanLogId,
        inboxFound: inboxCount,
        sentFound: sentEmails.length,
        log: [
          "Scan started",
          `Found ${inboxCount} inbox emails`,
          `Found ${sentEmails.length} sent emails`,
          `${emails.length} unique after dedup`,
        ],
      });

      // Insert new emails (dedup handled by mutation)
      let inserted = 0;
      for (const email of emails) {
        const result = await ctx.runMutation(api.emails.insert, {
          userId,
          orgId,
          connectionId: args.connectionId,
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
      await ctx.runMutation(internal.emailScanLogs.update, {
        id: scanLogId,
        status: "success",
        totalInserted: inserted,
        duplicatesSkipped,
        durationMs: Date.now() - startTime,
        log: [
          "Scan started",
          `Found ${inboxCount} inbox emails`,
          `Found ${sentEmails.length} sent emails`,
          `${emails.length} unique after dedup`,
          `Inserted ${inserted} new emails (${duplicatesSkipped} already imported)`,
          `Complete (${Math.round((Date.now() - startTime) / 1000)}s)`,
        ],
      });

      return { emailsFound: inserted };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      const friendlyError: string = message.includes("AUTHENTICATIONFAILED")
        ? "Authentication failed — check your email and password (Gmail requires an App Password)"
        : message.includes("ENOTFOUND") || message.includes("getaddrinfo")
          ? `Could not connect to ${connection.imapHost} — check the IMAP host`
          : message.includes("ETIMEDOUT") || message.includes("ECONNREFUSED")
            ? `Connection to ${connection.imapHost}:${connection.imapPort} timed out or was refused`
            : `Scan failed: ${message}`;

      await ctx.runMutation(api.connections.updateScanStatus, {
        id: args.connectionId,
        lastScanStatus: "error",
        lastScanError: friendlyError,
      });

      await ctx.runMutation(api.connections.updateScanProgress, {
        id: args.connectionId,
        scanProgress: { phase: "complete" },
      });

      try {
        await ctx.runMutation(internal.emailScanLogs.update, {
          id: scanLogId,
          status: "error",
          error: friendlyError,
          durationMs: Date.now() - startTime,
          log: ["Scan started", `Error: ${friendlyError}`],
        });
      } catch { /* scanLogId may not exist if error happened before log creation */ }

      return { error: friendlyError };
    }
  },
});
