"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { ImapFlow } from "imapflow";

function hasAttachmentParts(structure: any): boolean {
  if (!structure) return false;
  if (structure.disposition === "attachment") return true;
  if (structure.type === "application/pdf") return true;
  if (structure.childNodes) {
    return structure.childNodes.some((child: any) => hasAttachmentParts(child));
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
    // Verify auth and get userId
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) throw new Error("Not authenticated");
    const userId = viewer._id;

    const connection = await ctx.runQuery(api.connections.get, {
      id: args.connectionId,
    });
    if (!connection) throw new Error("Connection not found");

    // Save scan params
    const scanParams: any = {};
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

    try {
      // Determine date range
      const since = args.sinceDate
        ? new Date(args.sinceDate)
        : connection.lastScanAt
          ? new Date(connection.lastScanAt)
          : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

      const before = args.untilDate
        ? new Date(new Date(args.untilDate).getTime() + 24 * 60 * 60 * 1000) // include the end date
        : undefined;

      // Build IMAP search criteria
      const searchCriteria: any = { since };
      if (before) searchCriteria.before = before;

      // Fetch emails via IMAP
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

      // Insert new emails (dedup handled by mutation)
      let inserted = 0;
      for (const email of emails) {
        await ctx.runMutation(api.emails.insert, {
          userId,
          connectionId: args.connectionId,
          messageId: email.messageId,
          uid: email.uid,
          subject: email.subject,
          from: email.from,
          date: email.date,
          hasAttachments: email.hasAttachments,
          processed: false,
        });
        inserted++;
      }

      // Update progress to classifying phase
      await ctx.runMutation(api.connections.updateScanProgress, {
        id: args.connectionId,
        scanProgress: { phase: "classifying", totalEmails: inserted, processedEmails: 0 },
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
        { connectionId: args.connectionId, userId }
      );

      return { emailsFound: inserted };
    } catch (error: any) {
      const message =
        error.message || "Unknown error";
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

      return { error: friendlyError };
    }
  },
});
