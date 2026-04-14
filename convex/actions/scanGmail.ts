"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";

function matchesDomains(fromStr: string, domains: string[]): boolean {
  const lower = fromStr.toLowerCase();
  return domains.some((d) => lower.includes(d.toLowerCase()));
}

function hasAttachmentParts(payload: any): boolean {
  if (!payload) return false;
  if (payload.filename && payload.body?.attachmentId) return true;
  if (payload.parts) {
    return payload.parts.some((part: any) => hasAttachmentParts(part));
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
        } catch (refreshError: any) {
          const status = refreshError?.response?.status || refreshError?.code;
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

      // Determine date range
      const since = args.sinceDate
        ? new Date(args.sinceDate)
        : connection.lastScanAt
          ? new Date(connection.lastScanAt)
          : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

      const before = args.untilDate
        ? new Date(new Date(args.untilDate).getTime() + 24 * 60 * 60 * 1000)
        : undefined;

      // Build Gmail search query
      const queryParts: string[] = [];

      const formatDate = (d: Date) =>
        `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;

      queryParts.push(`after:${formatDate(since)}`);
      if (before) {
        queryParts.push(`before:${formatDate(before)}`);
      }

      if (args.senderDomains?.length) {
        const domainQuery = args.senderDomains
          .map((d) => `from:${d}`)
          .join(" OR ");
        queryParts.push(`(${domainQuery})`);
      }

      const searchQuery = queryParts.join(" ");

      // List messages with pagination
      const messageIds: string[] = [];
      let pageToken: string | undefined;

      do {
        const listResponse = await gmail.users.messages.list({
          userId: "me",
          q: searchQuery,
          pageToken,
          maxResults: 500,
        });

        if (listResponse.data.messages) {
          for (const msg of listResponse.data.messages) {
            if (msg.id) messageIds.push(msg.id);
          }
        }

        pageToken = listResponse.data.nextPageToken || undefined;
      } while (pageToken);

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
        await ctx.runMutation(api.emails.insert, {
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
        { connectionId: args.connectionId, userId, orgId }
      );

      return { emailsFound: inserted };
    } catch (error: any) {
      const message = error.message || "Unknown error";
      const status = error?.response?.status || error?.code;

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

      await ctx.runMutation(api.connections.updateScanProgress, {
        id: args.connectionId,
        scanProgress: { phase: "complete" },
      });

      return { error: friendlyError };
    }
  },
});
