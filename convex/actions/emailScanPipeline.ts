"use node";

/**
 * cl-pipelines pipeline for email scanning.
 *
 * Drives every scan run (manual or cron, IMAP or Gmail) through a single
 * durable pipeline keyed on the emailConnections row as the job doc.
 *
 * Phases:
 *   1. connect        — validate credentials / refresh OAuth token
 *   2. fetch          — IMAP or Gmail fetch + insert emails into DB
 *   3. classify       — run classifyEmails action (reused as-is)
 *   4. schedule_ext   — schedule extractPolicy for insurance emails
 *   5. (terminal)     — mark complete
 *
 * Retry semantics:
 *   mode: "resume" (default) — restart from the failed phase
 *   mode: "full"             — restart from connect
 */

import { v } from "convex/values";
import { internalAction, action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { advancePhase, runPipeline } from "@claritylabs/cl-pipelines";
import {
  createConvexStorageAdapter,
  createConvexSchedulerAdapter,
} from "@claritylabs/cl-pipelines/convex";
import type { Phase, PhaseResult } from "@claritylabs/cl-pipelines";
import { ImapFlow } from "imapflow";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

// ─── State Type ────────────────────────────────────────────────────────────────

export type EmailScanState = {
  connectionId: string;
  orgId?: string;
  userId?: string;
  trigger: "manual" | "daily" | "calendar";
  sinceDate?: string;
  untilDate?: string;
  senderDomains?: string[];
  /** set after connect phase for Gmail; saved for possible token refresh mid-run */
  accessToken?: string;
  /** cumulative counts updated during fetch */
  emailsInserted?: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SCAN_OVERLAP_MS = 5 * 60 * 1000;

function hasImapAttachmentParts(structure: unknown): boolean {
  if (!structure) return false;
  const s = structure as { disposition?: string; type?: string; childNodes?: unknown[] };
  if (s.disposition === "attachment") return true;
  if (s.type === "application/pdf") return true;
  if (s.childNodes) return (s.childNodes as unknown[]).some(hasImapAttachmentParts);
  return false;
}

function hasGmailAttachmentParts(payload: unknown): boolean {
  if (!payload) return false;
  const p = payload as { filename?: string; body?: { attachmentId?: string }; parts?: unknown[] };
  if (p.filename && p.body?.attachmentId) return true;
  if (p.parts) return (p.parts as unknown[]).some(hasGmailAttachmentParts);
  return false;
}

function getHeader(
  headers: Array<{ name?: string | null; value?: string | null }>,
  name: string,
): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function matchesDomains(fromStr: string, domains: string[]): boolean {
  const lower = fromStr.toLowerCase();
  return domains.some((d) => lower.includes(d.toLowerCase()));
}

// ─── Convex mutations ref builder ──────────────────────────────────────────────

function makeMutations() {
  return {
    getJob: internal.connections.pipelineGetJob,
    setStatus: internal.connections.pipelineSetStatus,
    setCheckpoint: internal.connections.pipelineSetCheckpoint,
    appendLog: internal.connections.pipelineAppendLog,
    clearLog: internal.connections.pipelineClearLog,
  };
}

// ─── Phase factory ─────────────────────────────────────────────────────────────

export function makePhases(convexCtx: ActionCtx): Phase<EmailScanState>[] {
  // ── Phase 1: connect ──────────────────────────────────────────────────────────
  const connectPhase: Phase<EmailScanState> = {
    name: "connect",
    run: async (pCtx): Promise<PhaseResult<EmailScanState>> => {
      const { state } = pCtx.checkpoint;
      const connection = await convexCtx.runQuery(internal.connections.getInternal, {
        id: state.connectionId as Id<"emailConnections">,
      });
      if (!connection) return { kind: "error", error: "Connection not found" };

      // Write scan log row (audit)
      const orgId = state.orgId as Id<"organizations"> | undefined;
      await convexCtx.runMutation(internal.emailScanLogs.insert, {
        orgId,
        connectionId: state.connectionId as Id<"emailConnections">,
        connectionLabel: connection.label,
        trigger: state.trigger,
        status: "running",
        sinceDate: state.sinceDate,
        untilDate: state.untilDate,
        senderDomains: state.senderDomains,
        inboxFound: 0,
        sentFound: 0,
        totalInserted: 0,
        duplicatesSkipped: 0,
        durationMs: 0,
        log: [`${state.trigger === "daily" ? "Daily" : "Manual"} scan started`],
      });

      // Update connection scan status
      await convexCtx.runMutation(api.connections.updateScanStatus, {
        id: state.connectionId as Id<"emailConnections">,
        lastScanStatus: "scanning",
        lastScanAt: Date.now(),
      });
      await convexCtx.runMutation(api.connections.updateScanProgress, {
        id: state.connectionId as Id<"emailConnections">,
        scanProgress: { phase: "fetching" },
      });

      if (connection.provider === "google") {
        // Validate / refresh OAuth token
        const oauth2Client = new OAuth2Client(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
        );
        oauth2Client.setCredentials({
          access_token: connection.accessToken,
          refresh_token: connection.refreshToken,
        });

        if (connection.tokenExpiry && connection.tokenExpiry - Date.now() < 5 * 60 * 1000) {
          try {
            const { credentials } = await oauth2Client.refreshAccessToken();
            await convexCtx.runMutation(internal.connections.updateTokens, {
              id: state.connectionId as Id<"emailConnections">,
              accessToken: credentials.access_token!,
              tokenExpiry: credentials.expiry_date!,
            });
            const nextState: EmailScanState = { ...state, accessToken: credentials.access_token! };
            await pCtx.log("OAuth token refreshed");
            return { kind: "next", nextPhase: "fetch", state: nextState };
          } catch (refreshError: unknown) {
            const status = (refreshError as any)?.response?.status || (refreshError as any)?.code;
            if (status === 401 || status === 403) {
              await convexCtx.runMutation(api.connections.updateScanStatus, {
                id: state.connectionId as Id<"emailConnections">,
                lastScanStatus: "disconnected",
                lastScanError: "Google authorization expired. Please reconnect your Gmail account.",
              });
              return { kind: "error", error: "Google authorization expired — reconnect required" };
            }
            throw refreshError;
          }
        }

        await pCtx.log("Gmail connection validated");
        return { kind: "next", nextPhase: "fetch", state: { ...state, accessToken: connection.accessToken } };
      } else {
        // IMAP — validate credentials exist
        if (!connection.imapHost || !connection.imapPort || !connection.password) {
          return { kind: "error", error: "IMAP connection missing host, port, or password" };
        }
        await pCtx.log("IMAP credentials validated");
        return { kind: "next", nextPhase: "fetch", state };
      }
    },
  };

  // ── Phase 2: fetch ────────────────────────────────────────────────────────────
  const fetchPhase: Phase<EmailScanState> = {
    name: "fetch",
    run: async (pCtx): Promise<PhaseResult<EmailScanState>> => {
      const { state } = pCtx.checkpoint;
      const connection = await convexCtx.runQuery(internal.connections.getInternal, {
        id: state.connectionId as Id<"emailConnections">,
      });
      if (!connection) return { kind: "error", error: "Connection not found" };

      const latestImported = await convexCtx.runQuery(
        internal.emails.latestImportedAtByConnection,
        { connectionId: state.connectionId as Id<"emailConnections"> },
      );
      const scanAnchorMs = state.sinceDate
        ? Date.parse(state.sinceDate)
        : latestImported?.timestamp ?? connection.lastScanAt ?? Date.now() - 14 * 24 * 60 * 60 * 1000;
      const since = new Date(scanAnchorMs - (state.sinceDate ? 0 : SCAN_OVERLAP_MS));
      const before = state.untilDate
        ? new Date(new Date(state.untilDate).getTime() + 24 * 60 * 60 * 1000)
        : undefined;

      const orgId = state.orgId as Id<"organizations"> | undefined;
      const userId = state.userId as Id<"users"> | undefined;

      let inserted = 0;
      let inboxCount = 0;
      let sentCount = 0;

      if (connection.provider === "google") {
        // Gmail fetch
        const oauth2Client = new OAuth2Client(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
        );
        oauth2Client.setCredentials({
          access_token: state.accessToken ?? connection.accessToken,
          refresh_token: connection.refreshToken,
        });
        const gmail = google.gmail({ version: "v1", auth: oauth2Client });

        const formatDate = (d: Date) =>
          `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;

        const baseQueryParts = [`after:${formatDate(since)}`];
        if (before) baseQueryParts.push(`before:${formatDate(before)}`);
        if (state.senderDomains?.length) {
          baseQueryParts.push(`(${state.senderDomains.map((d) => `from:${d}`).join(" OR ")})`);
        }
        const baseQuery = baseQueryParts.join(" ");

        async function listGmailIds(query: string): Promise<string[]> {
          const ids: string[] = [];
          let pageToken: string | undefined;
          do {
            const res = await gmail.users.messages.list({ userId: "me", q: query, pageToken, maxResults: 500 });
            if (res.data.messages) for (const m of res.data.messages) if (m.id) ids.push(m.id);
            pageToken = res.data.nextPageToken || undefined;
          } while (pageToken);
          return ids;
        }

        const [inboxIds, sentIds] = await Promise.all([
          listGmailIds(`in:inbox ${baseQuery}`),
          listGmailIds(`in:sent ${baseQuery}`),
        ]);
        const allIdSet = new Set([...inboxIds, ...sentIds]);
        const messageIds = [...allIdSet];
        inboxCount = inboxIds.length;
        sentCount = sentIds.length;

        await convexCtx.runMutation(api.connections.updateScanProgress, {
          id: state.connectionId as Id<"emailConnections">,
          scanProgress: { phase: "fetching", totalEmails: messageIds.length },
        });
        await pCtx.log(`Gmail: ${inboxCount} inbox + ${sentCount} sent = ${messageIds.length} unique`);

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
          if (state.senderDomains?.length && !matchesDomains(from, state.senderDomains)) continue;
          let date: string;
          try { date = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(); }
          catch { date = new Date().toISOString(); }
          const result = await convexCtx.runMutation(api.emails.insert, {
            userId,
            orgId,
            connectionId: state.connectionId as Id<"emailConnections">,
            messageId,
            subject,
            from,
            date,
            hasAttachments: hasGmailAttachmentParts(msgResponse.data.payload),
            processed: false,
          });
          if ((result as any).inserted) inserted++;
        }
      } else {
        // IMAP fetch
        const searchCriteria: Record<string, unknown> = { since };
        if (before) searchCriteria.before = before;

        const client = new ImapFlow({
          host: connection.imapHost!,
          port: connection.imapPort!,
          secure: true,
          auth: { user: connection.email, pass: connection.password! },
          logger: false,
        });

        const emails: Array<{ uid: number; messageId: string; subject: string; from: string; date: string; hasAttachments: boolean }> = [];
        const sentEmails: typeof emails = [];

        try {
          await client.connect();
          const lock = await client.getMailboxLock("INBOX");
          try {
            for await (const message of client.fetch(searchCriteria, { uid: true, envelope: true, bodyStructure: true })) {
              const envelope = message.envelope!;
              const from = envelope.from?.[0];
              const fromStr = from ? `${from.name || ""} <${from.address || ""}>` : "Unknown";
              if (state.senderDomains?.length && !matchesDomains(fromStr, state.senderDomains)) continue;
              emails.push({
                uid: message.uid,
                messageId: envelope.messageId || `uid-${message.uid}`,
                subject: envelope.subject || "(No Subject)",
                from: fromStr,
                date: envelope.date?.toISOString() || new Date().toISOString(),
                hasAttachments: hasImapAttachmentParts(message.bodyStructure),
              });
            }
          } finally { lock.release(); }

          // Try Sent mailbox variants
          for (const sentFolder of ["[Gmail]/Sent Mail", "Sent"]) {
            try {
              const sentLock = await client.getMailboxLock(sentFolder);
              try {
                for await (const message of client.fetch(searchCriteria, { uid: true, envelope: true, bodyStructure: true })) {
                  const envelope = message.envelope!;
                  const from = envelope.from?.[0];
                  const fromStr = from ? `${from.name || ""} <${from.address || ""}>` : "Unknown";
                  if (state.senderDomains?.length && !matchesDomains(fromStr, state.senderDomains)) continue;
                  sentEmails.push({
                    uid: message.uid,
                    messageId: envelope.messageId || `uid-${message.uid}`,
                    subject: envelope.subject || "(No Subject)",
                    from: fromStr,
                    date: envelope.date?.toISOString() || new Date().toISOString(),
                    hasAttachments: hasImapAttachmentParts(message.bodyStructure),
                  });
                }
              } finally { sentLock.release(); }
              break; // success — stop trying
            } catch { /* try next folder */ }
          }

          // Merge and dedup
          const seenIds = new Set(emails.map((e) => e.messageId));
          for (const se of sentEmails) {
            if (!seenIds.has(se.messageId)) { emails.push(se); seenIds.add(se.messageId); }
          }
          await client.logout();
        } catch (error) {
          try { await client.logout(); } catch { /* ignore */ }
          throw error;
        }

        inboxCount = emails.length - sentEmails.length;
        sentCount = sentEmails.length;
        await convexCtx.runMutation(api.connections.updateScanProgress, {
          id: state.connectionId as Id<"emailConnections">,
          scanProgress: { phase: "fetching", totalEmails: emails.length },
        });
        await pCtx.log(`IMAP: ${inboxCount} inbox + ${sentCount} sent = ${emails.length} unique`);

        for (const email of emails) {
          const result = await convexCtx.runMutation(api.emails.insert, {
            userId,
            orgId,
            connectionId: state.connectionId as Id<"emailConnections">,
            messageId: email.messageId,
            uid: email.uid,
            subject: email.subject,
            from: email.from,
            date: email.date,
            hasAttachments: email.hasAttachments,
            processed: false,
          });
          if ((result as any).inserted) inserted++;
        }
      }

      await convexCtx.runMutation(api.connections.updateScanStatus, {
        id: state.connectionId as Id<"emailConnections">,
        lastScanStatus: "success",
        lastScanAt: Date.now(),
        emailsFound: inserted,
      });
      await convexCtx.runMutation(api.connections.updateScanProgress, {
        id: state.connectionId as Id<"emailConnections">,
        scanProgress: { phase: "classifying", totalEmails: inserted, processedEmails: 0 },
      });
      await pCtx.log(`Inserted ${inserted} new emails`);

      const nextState: EmailScanState = { ...state, emailsInserted: inserted };
      return { kind: "next", nextPhase: "classify", state: nextState };
    },
  };

  // ── Phase 3: classify ─────────────────────────────────────────────────────────
  const classifyPhase: Phase<EmailScanState> = {
    name: "classify",
    run: async (pCtx): Promise<PhaseResult<EmailScanState>> => {
      const { state } = pCtx.checkpoint;
      await pCtx.log("Starting email classification");
      if (!state.userId) {
        await pCtx.log("No userId — skipping classification");
        return { kind: "next", nextPhase: "schedule_extractions", state };
      }
      await convexCtx.runAction(internal.actions.classifyEmails.classifyEmails, {
        connectionId: state.connectionId as Id<"emailConnections">,
        userId: state.userId as Id<"users">,
        orgId: state.orgId as Id<"organizations"> | undefined,
      });
      await pCtx.log("Classification complete");
      await convexCtx.runMutation(api.connections.updateScanProgress, {
        id: state.connectionId as Id<"emailConnections">,
        scanProgress: {
          phase: "extracting",
          totalEmails: state.emailsInserted ?? 0,
          processedEmails: state.emailsInserted ?? 0,
        },
      });
      return { kind: "next", nextPhase: "schedule_extractions", state };
    },
  };

  // ── Phase 4: schedule_extractions ─────────────────────────────────────────────
  const scheduleExtractionsPhase: Phase<EmailScanState> = {
    name: "schedule_extractions",
    run: async (pCtx): Promise<PhaseResult<EmailScanState>> => {
      const { state } = pCtx.checkpoint;
      // Insurance-related emails with attachments that haven't been extracted yet
      const allEmails = await convexCtx.runQuery(internal.emails.listUnprocessedWithAttachments, {
        connectionId: state.connectionId as Id<"emailConnections">,
      });
      const toExtract = allEmails.filter((e: any) => e.isInsuranceRelated && e.hasAttachments);

      let scheduled = 0;
      for (const email of toExtract) {
        if (!state.userId || !state.orgId) continue;
        await convexCtx.scheduler.runAfter(
          scheduled * 60_000, // 60s stagger
          internal.actions.extractPolicy.extractPolicy,
          {
            emailId: email._id,
            connectionId: state.connectionId as Id<"emailConnections">,
            userId: state.userId as Id<"users">,
            orgId: state.orgId as Id<"organizations">,
          },
        );
        scheduled++;
      }

      await pCtx.log(`Scheduled ${scheduled} policy extraction(s)`);
      await convexCtx.runMutation(api.connections.updateScanProgress, {
        id: state.connectionId as Id<"emailConnections">,
        scanProgress: { phase: "complete", extracting: scheduled },
      });
      return { kind: "done" };
    },
  };

  return [connectPhase, fetchPhase, classifyPhase, scheduleExtractionsPhase];
}

// ─── Entry point: startEmailScan ──────────────────────────────────────────────

/**
 * Start (or resume) an email scan pipeline for a given connection.
 * Called by scanInbox, scanGmail, and scanSingleConnection (cron).
 */
export const startEmailScan = internalAction({
  args: {
    connectionId: v.id("emailConnections"),
    orgId: v.optional(v.id("organizations")),
    userId: v.optional(v.id("users")),
    trigger: v.union(v.literal("manual"), v.literal("daily"), v.literal("calendar")),
    sinceDate: v.optional(v.string()),
    untilDate: v.optional(v.string()),
    senderDomains: v.optional(v.array(v.string())),
    mode: v.optional(v.union(v.literal("resume"), v.literal("full"))),
  },
  handler: async (ctx, args) => {
    const phases = makePhases(ctx);
    const storage = createConvexStorageAdapter<EmailScanState>({
      ctx: ctx as any,
      mutations: makeMutations(),
    });
    const scheduler = createConvexSchedulerAdapter({
      ctx: ctx as any,
      advanceAction: internal.actions.emailScanPipeline.advanceEmailScan,
    });

    const initialState: EmailScanState = {
      connectionId: args.connectionId,
      orgId: args.orgId,
      userId: args.userId,
      trigger: args.trigger,
      sinceDate: args.sinceDate,
      untilDate: args.untilDate,
      senderDomains: args.senderDomains,
    };

    await runPipeline({
      jobId: args.connectionId,
      phases,
      storage,
      scheduler,
      initialState,
      retryMode: args.mode ?? "resume",
    });
  },
});

/**
 * cl-pipelines advance function — called by the scheduler to resume the next phase.
 */
export const advanceEmailScan = internalAction({
  args: { jobId: v.string() },
  handler: async (ctx, args) => {
    const phases = makePhases(ctx);
    const storage = createConvexStorageAdapter<EmailScanState>({
      ctx: ctx as any,
      mutations: makeMutations(),
    });
    const scheduler = createConvexSchedulerAdapter({
      ctx: ctx as any,
      advanceAction: internal.actions.emailScanPipeline.advanceEmailScan,
    });

    await advancePhase({ jobId: args.jobId, phases, storage, scheduler });
  },
});

/**
 * Public action to retry a failed email scan.
 * mode: "resume" = restart from the failed phase; "full" = restart from connect.
 */
export const retryEmailScan = action({
  args: {
    connectionId: v.id("emailConnections"),
    mode: v.union(v.literal("resume"), v.literal("full")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) throw new Error("Not authenticated");
    const orgData = await ctx.runQuery(api.orgs.viewerOrg, {});
    await ctx.runAction(internal.actions.emailScanPipeline.startEmailScan, {
      connectionId: args.connectionId,
      orgId: orgData?.org?._id,
      userId: viewer._id,
      trigger: "manual",
      mode: args.mode,
    });
    return null;
  },
});
