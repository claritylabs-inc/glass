"use node";

import dayjs from "dayjs";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ImapFlow } from "imapflow";
import mammoth from "mammoth";
import { simpleParser, type ParsedMail } from "mailparser";
import { v } from "convex/values";
import { generateObject } from "ai";
import { z } from "zod";
import { action, internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import { getImessageWorkerUrl } from "../lib/imessageConfig";
import { getModelForOrg, getProviderOptionsForTask } from "../lib/models";

type ConnectedEmailAccount = {
  _id: Id<"connectedEmailAccounts">;
  orgId: Id<"organizations">;
  userId: Id<"users">;
  scope: "user" | "org";
  emailAddress: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  encryptedPassword: string;
};

const IMAP_CONNECTION_TIMEOUT_MS = 15_000;
const IMAP_GREETING_TIMEOUT_MS = 10_000;
const IMAP_SOCKET_TIMEOUT_MS = 18_000;
const SEARCH_CANDIDATE_MULTIPLIER = 3;
const SEARCH_MAX_CANDIDATES = 30;
const SEARCH_DOWNLOAD_MAX_BYTES = 5 * 1024 * 1024;
const THREAD_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

function normalizeThreadAttachmentFilename(filename?: string | null) {
  return (filename?.trim() || "email-attachment").toLowerCase();
}

async function getExistingThreadAttachmentNames(
  ctx: ActionCtx,
  args: { threadId: Id<"threads">; orgId: Id<"organizations"> },
) {
  const attachments = await ctx.runQuery(
    internal.threads.listThreadAttachmentsInternal,
    args,
  ) as Array<{ filename: string }>;
  return new Set(
    attachments.map((attachment) =>
      normalizeThreadAttachmentFilename(attachment.filename),
    ),
  );
}

const DailyAttentionSchema = z.object({
  items: z.array(
    z.object({
      subject: z.string(),
      from: z.string().optional(),
      reason: z.string(),
      suggestedAction: z.string(),
      urgency: z.enum(["low", "normal", "high"]),
    }),
  ).max(8),
});

function encryptionKey() {
  const secret = process.env.EMAIL_CONNECTIONS_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("EMAIL_CONNECTIONS_ENCRYPTION_KEY is not configured");
  }
  return createHash("sha256").update(secret).digest();
}

function encryptPassword(password: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: ciphertext.toString("base64"),
  });
}

function decryptPassword(encrypted: string): string {
  const parsed = JSON.parse(encrypted) as { iv: string; tag: string; data: string };
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(parsed.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(parsed.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function headerLine(name: string, value?: string) {
  return value?.trim() ? `${name}: ${value.replace(/\r?\n/g, " ").trim()}\r\n` : "";
}

function safeEmailExportFilename(subject?: string, requested?: string) {
  const base = (requested?.trim() || subject?.trim() || "connected-email")
    .replace(/\.eml$/i, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "connected-email";
  return `${base}.eml`;
}

function buildSavedMessageExport(args: {
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  date?: Date;
  text?: string;
  html?: string | false;
}) {
  const html = typeof args.html === "string" && args.html.trim() ? args.html : undefined;
  const text = args.text?.trim() || (html ? "This email contains HTML content." : "");
  if (html) {
    const boundary = `glass-${createHash("sha256").update(`${args.subject ?? ""}${args.date?.toISOString() ?? ""}`).digest("hex").slice(0, 16)}`;
    return [
      headerLine("Subject", args.subject ?? "(no subject)"),
      headerLine("From", args.from),
      headerLine("To", args.to),
      headerLine("Cc", args.cc),
      headerLine("Date", args.date?.toUTCString()),
      "MIME-Version: 1.0\r\n",
      `Content-Type: multipart/alternative; boundary="${boundary}"\r\n`,
      "\r\n",
      `--${boundary}\r\n`,
      "Content-Type: text/plain; charset=utf-8\r\n",
      "Content-Transfer-Encoding: 8bit\r\n\r\n",
      text,
      "\r\n",
      `--${boundary}\r\n`,
      "Content-Type: text/html; charset=utf-8\r\n",
      "Content-Transfer-Encoding: 8bit\r\n\r\n",
      html,
      "\r\n",
      `--${boundary}--\r\n`,
    ].join("");
  }
  return [
    headerLine("Subject", args.subject ?? "(no subject)"),
    headerLine("From", args.from),
    headerLine("To", args.to),
    headerLine("Cc", args.cc),
    headerLine("Date", args.date?.toUTCString()),
    "MIME-Version: 1.0\r\n",
    "Content-Type: text/plain; charset=utf-8\r\n",
    "Content-Transfer-Encoding: 8bit\r\n",
    "\r\n",
    text,
    "\r\n",
  ].join("");
}

async function requireOrgMember(ctx: any, orgId: Id<"organizations">, userId: Id<"users">) {
  const members = await ctx.runQuery(internal.orgs.getMembersInternal, { orgId });
  const membership = members.find((member: any) => String(member.userId) === String(userId));
  if (!membership) throw new Error("Connected email is available only to direct org members");
  return membership;
}

async function withClient<T>(
  account: ConnectedEmailAccount,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
    socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
    auth: {
      user: account.username,
      pass: decryptPassword(account.encryptedPassword),
    },
    logger: false,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

function imapErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") {
    return String(error);
  }
  const record = error as Record<string, unknown>;
  const parts = [
    record.message,
    record.response,
    record.responseText,
    record.serverResponse,
    record.code,
    record.command,
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map((part) => part.trim());
  return [...new Set(parts)].join(" · ") || "IMAP command failed";
}

function mailboxSearchError(account: ConnectedEmailAccount, mailbox: string, error: unknown) {
  const message = imapErrorMessage(error);
  console.warn("[connectedEmail.searchInternal] IMAP search failed", {
    accountId: account._id,
    accountEmail: account.emailAddress,
    host: account.host,
    mailbox,
    error: message,
  });
  return {
    type: "mailbox_search_error" as const,
    accountId: account._id,
    accountEmail: account.emailAddress,
    accountHost: account.host,
    mailbox,
    message,
    hint:
      "Glass could not search this mailbox. The folder may not exist, the provider rejected the IMAP SEARCH command, or the mailbox connection needs to be reconnected.",
  };
}

function mailboxSearchQuery(args: {
  since: Date;
  before?: Date;
  query?: string;
}): Record<string, unknown> {
  const criteria: Record<string, unknown> = { since: args.since };
  if (args.before) criteria.before = args.before;
  const query = args.query?.trim();
  if (query) criteria.text = query;
  return criteria;
}

function searchDateWindow(args: {
  sinceDays?: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  const explicitFrom = args.dateFrom ? dayjs(args.dateFrom) : undefined;
  const explicitTo = args.dateTo ? dayjs(args.dateTo) : undefined;
  const endExclusive = explicitTo?.isValid()
    ? explicitTo.add(1, "day").startOf("day")
    : undefined;
  const fallbackBase = endExclusive ?? dayjs();
  const since = explicitFrom?.isValid()
    ? explicitFrom.startOf("day")
    : fallbackBase.subtract(args.sinceDays ?? 14, "day").startOf("day");
  const before = endExclusive && endExclusive.isAfter(since) ? endExclusive : undefined;
  return {
    since: since.toDate(),
    before: before?.toDate(),
    dateFrom: since.format("YYYY-MM-DD"),
    dateTo: before ? before.subtract(1, "day").format("YYYY-MM-DD") : undefined,
  };
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function messageRef(accountId: string, mailbox: string, uid: number) {
  return Buffer.from(JSON.stringify({ accountId, mailbox, uid }), "utf8").toString("base64url");
}

function parseMessageRef(ref: string): {
  accountId: Id<"connectedEmailAccounts">;
  mailbox: string;
  uid: number;
} {
  const parsed = JSON.parse(Buffer.from(ref, "base64url").toString("utf8"));
  return {
    accountId: parsed.accountId,
    mailbox: parsed.mailbox,
    uid: Number(parsed.uid),
  };
}

function addressText(value: ParsedMail["from"] | ParsedMail["to"] | ParsedMail["cc"]) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((entry) => entry.value.map((item) => item.address).filter(Boolean));
}

function isGlassSearchLoopAddress(address?: string) {
  const domain = address?.split("@").pop()?.trim().toLowerCase();
  return !!domain && (
    domain === "glass.insure" ||
    domain.endsWith(".glass.insure") ||
    domain === "glass.claritylabs.inc" ||
    domain.endsWith(".glass.claritylabs.inc")
  );
}

function isGlassSearchLoopEmail(parsed: ParsedMail) {
  return parsed.from?.value.some((item) => isGlassSearchLoopAddress(item.address)) ?? false;
}

function isRequirementAttachment(attachment: ParsedMail["attachments"][number]) {
  const name = attachment.filename?.toLowerCase() ?? "";
  const type = attachment.contentType.toLowerCase();
  return (
    type === "application/pdf" ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    type === "text/plain" ||
    type === "text/markdown" ||
    type === "text/csv" ||
    type === "application/json" ||
    name.endsWith(".pdf") ||
    name.endsWith(".docx") ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".csv") ||
    name.endsWith(".json")
  );
}

function isPdfAttachment(attachment: ParsedMail["attachments"][number]) {
  const name = attachment.filename?.toLowerCase() ?? "";
  const type = attachment.contentType.toLowerCase();
  return type === "application/pdf" || type.includes("pdf") || name.endsWith(".pdf");
}

function buildEmailRequirementText(parsed: ParsedMail) {
  const body = (parsed.text ?? "").replace(/\s+\n/g, "\n").trim();
  if (!body) return "";
  const headers = [
    parsed.subject ? `Subject: ${parsed.subject}` : undefined,
    parsed.from?.text ? `From: ${parsed.from.text}` : undefined,
    parsed.date ? `Date: ${parsed.date.toISOString()}` : undefined,
  ].filter(Boolean);
  return [...headers, "", body].join("\n");
}

function decodeText(buffer: ArrayBuffer) {
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

async function extractPdfText(buffer: ArrayBuffer) {
  const { getDocument, VerbosityLevel } =
    await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    useWorkerFetch: false,
    verbosity: VerbosityLevel.ERRORS,
  });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const items = (textContent as { items: Array<{ str?: string }> }).items;
    pages.push(items.map((item) => item.str ?? "").join(" "));
  }
  return pages.join("\n\n");
}

async function extractDocxText(buffer: ArrayBuffer) {
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}

async function extractAttachmentText(attachment: ParsedMail["attachments"][number]) {
  const lowerName = (attachment.filename ?? "").toLowerCase();
  const type = attachment.contentType.toLowerCase();
  const copy = new Uint8Array(attachment.content.length);
  copy.set(attachment.content);
  const buffer = copy.buffer;
  if (type.includes("pdf") || lowerName.endsWith(".pdf")) {
    return await extractPdfText(buffer);
  }
  if (type.includes("wordprocessingml") || lowerName.endsWith(".docx")) {
    return await extractDocxText(buffer);
  }
  if (
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("csv") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".markdown") ||
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".json")
  ) {
    return decodeText(buffer);
  }
  throw new Error("Unsupported attachment type for text reading");
}

async function fetchParsedMessage(client: ImapFlow, mailbox: string, uid: number) {
  await client.mailboxOpen(mailbox);
  const downloaded = await client.download(String(uid), undefined, {
    uid: true,
    maxBytes: SEARCH_DOWNLOAD_MAX_BYTES,
  });
  const raw = await streamToBuffer(downloaded.content);
  return await simpleParser(raw);
}

async function accessibleAccount(ctx: any, args: {
  orgId: Id<"organizations">;
  userId?: Id<"users">;
  accountId?: Id<"connectedEmailAccounts">;
}): Promise<ConnectedEmailAccount> {
  if (args.accountId) {
    const account = await ctx.runQuery(internal.connectedEmail.getAccessibleInternal, {
      accountId: args.accountId,
      orgId: args.orgId,
      userId: args.userId,
    }) as ConnectedEmailAccount | null;
    if (!account) throw new Error("Connected email account not found");
    return account as ConnectedEmailAccount;
  }
  const accounts = await ctx.runQuery(internal.connectedEmail.listAccessibleInternal, {
    orgId: args.orgId,
    userId: args.userId,
  }) as ConnectedEmailAccount[];
  const account = accounts[0];
  if (!account) throw new Error("No connected email account is available");
  return account;
}

export const connect = action({
  args: {
    orgId: v.id("organizations"),
    scope: v.optional(v.union(v.literal("user"), v.literal("org"))),
    label: v.optional(v.string()),
    emailAddress: v.string(),
    host: v.string(),
    port: v.number(),
    secure: v.boolean(),
    username: v.string(),
    password: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<Id<"connectedEmailAccounts">> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await requireOrgMember(ctx, args.orgId, userId as Id<"users">);

    const encryptedPassword = encryptPassword(args.password);
    const testAccount: ConnectedEmailAccount = {
      _id: "test" as Id<"connectedEmailAccounts">,
      orgId: args.orgId,
      userId: userId as Id<"users">,
      scope: args.scope ?? "user",
      emailAddress: args.emailAddress.trim().toLowerCase(),
      host: args.host.trim(),
      port: args.port,
      secure: args.secure,
      username: args.username.trim(),
      encryptedPassword,
    };
    await withClient(testAccount, async (client) => {
      await client.mailboxOpen("INBOX");
      return true;
    });

    return await ctx.runMutation(internal.connectedEmail.upsertInternal, {
      orgId: args.orgId,
      userId: userId as Id<"users">,
      scope: args.scope ?? "user",
      label: args.label?.trim() || undefined,
      emailAddress: args.emailAddress.trim().toLowerCase(),
      host: args.host.trim(),
      port: args.port,
      secure: args.secure,
      username: args.username.trim(),
      encryptedPassword,
      encryptionKeyVersion: "v1",
    }) as Id<"connectedEmailAccounts">;
  },
});

export const searchInternal = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
    accountId: v.optional(v.id("connectedEmailAccounts")),
    mailbox: v.optional(v.string()),
    query: v.optional(v.string()),
    sinceDays: v.optional(v.number()),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown[]> => {
    const account: ConnectedEmailAccount = await accessibleAccount(ctx, args);
    const mailbox = args.mailbox ?? "INBOX";
    const window = searchDateWindow({
      sinceDays: args.sinceDays,
      dateFrom: args.dateFrom,
      dateTo: args.dateTo,
    });
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 25);
    const query = args.query?.trim().toLowerCase();

    try {
      return await withClient(account, async (client) => {
        await client.mailboxOpen(mailbox);
        const searchResult = await client.search(
          mailboxSearchQuery({
            since: window.since,
            before: window.before,
            query: args.query,
          }),
          { uid: true },
        );
        const candidateLimit = Math.min(
          SEARCH_MAX_CANDIDATES,
          Math.max(limit * SEARCH_CANDIDATE_MULTIPLIER, limit),
        );
        const uids = Array.isArray(searchResult) ? searchResult.slice(-candidateLimit).reverse() : [];
        const rows = [];
        for (const uid of uids) {
          if (rows.length >= limit) break;
          try {
            const parsed = await fetchParsedMessage(client, mailbox, uid);
            if (isGlassSearchLoopEmail(parsed)) continue;
            const haystack = [
              parsed.subject,
              parsed.from?.text,
              Array.isArray(parsed.to) ? parsed.to.map((item) => item.text).join(", ") : parsed.to?.text,
              Array.isArray(parsed.cc) ? parsed.cc.map((item) => item.text).join(", ") : parsed.cc?.text,
              parsed.text,
            ].filter(Boolean).join("\n").toLowerCase();
            if (query && !haystack.includes(query)) continue;
            rows.push({
              emailRef: messageRef(account._id, mailbox, uid),
              accountId: account._id,
              accountEmail: account.emailAddress,
              accountHost: account.host,
              mailbox,
              uid,
              dateFrom: window.dateFrom,
              dateTo: window.dateTo,
              subject: parsed.subject ?? "(no subject)",
              from: parsed.from?.text,
              to: addressText(parsed.to),
              cc: addressText(parsed.cc),
              date: parsed.date?.toISOString(),
              snippet: (parsed.text ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
              attachmentCount: parsed.attachments.length,
              attachments: parsed.attachments.map((attachment) => ({
                filename: attachment.filename,
                contentType: attachment.contentType,
                size: attachment.size,
              })),
            });
          } catch (error) {
            console.warn("[connectedEmail.searchInternal] Skipping unreadable message", {
              accountId: account._id,
              accountEmail: account.emailAddress,
              mailbox,
              uid,
              error: imapErrorMessage(error),
            });
          }
        }
        return rows;
      });
    } catch (error) {
      return [mailboxSearchError(account, mailbox, error)];
    }
  },
});

export const readInternal = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
    emailRef: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const ref = parseMessageRef(args.emailRef);
    const account = await accessibleAccount(ctx, {
      orgId: args.orgId,
      userId: args.userId,
      accountId: ref.accountId,
    });
    return await withClient(account, async (client) => {
      const parsed = await fetchParsedMessage(client, ref.mailbox, ref.uid);
      return {
        emailRef: args.emailRef,
        accountId: account._id,
        accountEmail: account.emailAddress,
        accountHost: account.host,
        mailbox: ref.mailbox,
        uid: ref.uid,
        subject: parsed.subject ?? "(no subject)",
        from: parsed.from?.text,
        to: addressText(parsed.to).join(", "),
        cc: addressText(parsed.cc).join(", "),
        date: parsed.date?.toISOString(),
        text: (parsed.text ?? "").slice(0, 20_000),
        html: typeof parsed.html === "string" ? parsed.html.slice(0, 20_000) : undefined,
        attachments: parsed.attachments.map((attachment) => ({
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
        })),
      };
    });
  },
});

export const readAttachmentInternal = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
    emailRef: v.string(),
    filename: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const ref = parseMessageRef(args.emailRef);
    const account = await accessibleAccount(ctx, {
      orgId: args.orgId,
      userId: args.userId,
      accountId: ref.accountId,
    });
    return await withClient(account, async (client) => {
      const parsed = await fetchParsedMessage(client, ref.mailbox, ref.uid);
      const requested = args.filename.trim().toLowerCase();
      const attachment = parsed.attachments.find(
        (item) => item.filename?.toLowerCase() === requested,
      );
      if (!attachment) throw new Error("Attachment not found on this email");
      const text = await extractAttachmentText(attachment);
      return {
        emailRef: args.emailRef,
        accountId: account._id,
        accountEmail: account.emailAddress,
        accountHost: account.host,
        mailbox: ref.mailbox,
        uid: ref.uid,
        subject: parsed.subject ?? "(no subject)",
        from: parsed.from?.text,
        date: parsed.date?.toISOString(),
        filename: attachment.filename ?? args.filename,
        contentType: attachment.contentType,
        size: attachment.size,
        text: text.replace(/\s+\n/g, "\n").trim().slice(0, 30_000),
        truncated: text.trim().length > 30_000,
      };
    });
  },
});

export const saveAttachmentsToThreadInternal = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    threadId: v.id("threads"),
    emailRef: v.string(),
    filenames: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const ref = parseMessageRef(args.emailRef);
    const account = await accessibleAccount(ctx, {
      orgId: args.orgId,
      userId: args.userId,
      accountId: ref.accountId,
    });
    return await withClient(account, async (client): Promise<Record<string, unknown>> => {
      const parsed = await fetchParsedMessage(client, ref.mailbox, ref.uid);
      const requested = new Set((args.filenames ?? []).map((name) => name.toLowerCase()));
      const existingNames = await getExistingThreadAttachmentNames(ctx, {
        threadId: args.threadId,
        orgId: args.orgId,
      });
      const skippedDuplicateFilenames: string[] = [];
      const attachments = parsed.attachments.filter((attachment) => {
        if (attachment.size > THREAD_ATTACHMENT_MAX_BYTES) return false;
        if (requested.size === 0) return true;
        return !!attachment.filename && requested.has(attachment.filename.toLowerCase());
      }).filter((attachment) => {
        const filename = attachment.filename ?? "email-attachment";
        const normalized = normalizeThreadAttachmentFilename(filename);
        if (existingNames.has(normalized)) {
          skippedDuplicateFilenames.push(filename);
          return false;
        }
        existingNames.add(normalized);
        return true;
      });
      if (attachments.length === 0) {
        return skippedDuplicateFilenames.length > 0
          ? {
              status: "duplicate_attachments" as const,
              attachments: [],
              skippedDuplicateFilenames: [...new Set(skippedDuplicateFilenames)],
            }
          : { status: "no_saveable_attachments" as const };
      }

      const saved = [];
      for (const attachment of attachments) {
        const copy = new Uint8Array(attachment.content.length);
        copy.set(attachment.content);
        const blob = new Blob([copy], {
          type: attachment.contentType,
        });
        const fileId = await ctx.storage.store(blob);
        saved.push({
          filename: attachment.filename ?? "email-attachment",
          contentType: attachment.contentType,
          size: attachment.size,
          fileId,
        });
      }

      const messageId = await ctx.runMutation(internal.threads.insertAttachmentMessageInternal, {
        threadId: args.threadId,
        orgId: args.orgId,
        content: [
          `Saved ${saved.length} document${saved.length === 1 ? "" : "s"} from connected email for reuse in this thread.`,
          parsed.subject ? `Source email: ${parsed.subject}` : undefined,
        ].filter(Boolean).join("\n"),
        attachments: saved,
      }) as Id<"threadMessages">;

      return {
        status: "saved" as const,
        messageId,
        attachments: saved,
        skippedDuplicateFilenames: [...new Set(skippedDuplicateFilenames)],
      };
    });
  },
});

export const saveMessageToThreadInternal = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    threadId: v.id("threads"),
    emailRef: v.string(),
    filename: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const ref = parseMessageRef(args.emailRef);
    const account = await accessibleAccount(ctx, {
      orgId: args.orgId,
      userId: args.userId,
      accountId: ref.accountId,
    });
    return await withClient(account, async (client): Promise<Record<string, unknown>> => {
      const parsed = await fetchParsedMessage(client, ref.mailbox, ref.uid);
      const exportContent = buildSavedMessageExport({
        subject: parsed.subject ?? "(no subject)",
        from: parsed.from?.text,
        to: addressText(parsed.to).join(", "),
        cc: addressText(parsed.cc).join(", "),
        date: parsed.date,
        text: parsed.text ?? undefined,
        html: parsed.html,
      });
      const size = Buffer.byteLength(exportContent, "utf8");
      if (size > THREAD_ATTACHMENT_MAX_BYTES) {
        return {
          status: "message_too_large" as const,
          message: "The email message export is too large to save to this thread.",
        };
      }

      const filename = safeEmailExportFilename(parsed.subject ?? undefined, args.filename);
      const existingNames = await getExistingThreadAttachmentNames(ctx, {
        threadId: args.threadId,
        orgId: args.orgId,
      });
      if (existingNames.has(normalizeThreadAttachmentFilename(filename))) {
        return {
          status: "duplicate_attachments" as const,
          attachments: [],
          skippedDuplicateFilenames: [filename],
        };
      }

      const saved = {
        filename,
        contentType: "message/rfc822",
        size,
        fileId: await ctx.storage.store(new Blob([exportContent], { type: "message/rfc822" })),
      };

      const messageId = await ctx.runMutation(internal.threads.insertAttachmentMessageInternal, {
        threadId: args.threadId,
        orgId: args.orgId,
        content: [
          "Saved 1 document from connected email for reuse in this thread.",
          parsed.subject ? `Source email: ${parsed.subject}` : undefined,
          parsed.from?.text ? `From: ${parsed.from.text}` : undefined,
        ].filter(Boolean).join("\n"),
        attachments: [saved],
      }) as Id<"threadMessages">;

      return {
        status: "saved" as const,
        messageId,
        attachment: saved,
        attachments: [saved],
      };
    });
  },
});

export const saveAttachmentsToThread = action({
  args: {
    orgId: v.id("organizations"),
    threadId: v.id("threads"),
    emailRef: v.string(),
    filenames: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await requireOrgMember(ctx, args.orgId, userId as Id<"users">);
    return await ctx.runAction(internal.actions.connectedEmail.saveAttachmentsToThreadInternal, {
      orgId: args.orgId,
      userId: userId as Id<"users">,
      threadId: args.threadId,
      emailRef: args.emailRef,
      filenames: args.filenames,
    }) as Record<string, unknown>;
  },
});

export const importPolicyAttachmentsInternal = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    emailRef: v.string(),
    filenames: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const ref = parseMessageRef(args.emailRef);
    const account = await accessibleAccount(ctx, {
      orgId: args.orgId,
      userId: args.userId,
      accountId: ref.accountId,
    });
    return await withClient(account, async (client): Promise<Record<string, unknown>> => {
      const parsed = await fetchParsedMessage(client, ref.mailbox, ref.uid);
      const requested = new Set((args.filenames ?? []).map((name) => name.toLowerCase()));
      const attachments = parsed.attachments.filter((attachment) => {
        if (!isPdfAttachment(attachment)) return false;
        if (requested.size === 0) return true;
        return !!attachment.filename && requested.has(attachment.filename.toLowerCase());
      });
      if (attachments.length === 0) return { status: "no_pdf_attachments" as const };
      const files = [];
      for (const attachment of attachments) {
        const copy = new Uint8Array(attachment.content.length);
        copy.set(attachment.content);
        const blob = new Blob([copy], {
          type: attachment.contentType,
        });
        const fileId = await ctx.storage.store(blob);
        files.push({
          fileId,
          fileName: attachment.filename ?? "email-attachment.pdf",
        });
      }
      const result = await ctx.runAction(
        internal.actions.extractFromUpload.extractFromUploadInternal,
        {
          orgId: args.orgId,
          userId: args.userId,
          files,
        },
      ) as unknown;
      return {
        status: "started" as const,
        files,
        result,
      };
    });
  },
});

export const importPolicyAttachments = action({
  args: {
    orgId: v.id("organizations"),
    emailRef: v.string(),
    filenames: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await requireOrgMember(ctx, args.orgId, userId as Id<"users">);
    return await ctx.runAction(internal.actions.connectedEmail.importPolicyAttachmentsInternal, {
      orgId: args.orgId,
      userId: userId as Id<"users">,
      emailRef: args.emailRef,
      filenames: args.filenames,
    }) as Record<string, unknown>;
  },
});

export const importRequirementAttachmentsInternal = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    emailRef: v.string(),
    filenames: v.optional(v.array(v.string())),
    includeEmailBody: v.optional(v.boolean()),
    sourceType: v.optional(
      v.union(
        v.literal("lease_agreement"),
        v.literal("client_contract"),
        v.literal("vendor_requirements"),
        v.literal("other"),
      ),
    ),
    appliesTo: v.optional(
      v.union(v.literal("vendors"), v.literal("own_org"), v.literal("both")),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const ref = parseMessageRef(args.emailRef);
    const account = await accessibleAccount(ctx, {
      orgId: args.orgId,
      userId: args.userId,
      accountId: ref.accountId,
    });
    return await withClient(account, async (client): Promise<Record<string, unknown>> => {
      const parsed = await fetchParsedMessage(client, ref.mailbox, ref.uid);
      const requested = new Set((args.filenames ?? []).map((name) => name.toLowerCase()));
      const attachments = parsed.attachments.filter((attachment) => {
        if (!isRequirementAttachment(attachment)) return false;
        if (requested.size === 0) return true;
        return !!attachment.filename && requested.has(attachment.filename.toLowerCase());
      });
      const emailText = args.includeEmailBody ? buildEmailRequirementText(parsed) : "";
      if (attachments.length === 0 && !emailText) {
        return { status: "no_requirement_sources" as const };
      }

      const imports = [];
      if (emailText) {
        const result = await ctx.runAction(
          internal.actions.complianceRequirements.importRequirementsInternal,
          {
            orgId: args.orgId,
            userId: args.userId,
            pastedText: emailText,
            sourceType: args.sourceType,
            appliesTo: args.appliesTo,
          },
        ) as { createdCount: number; requirementIds: Id<"insuranceRequirements">[] };
        imports.push({
          source: "email_body" as const,
          subject: parsed.subject ?? "(no subject)",
          createdCount: result.createdCount,
          requirementIds: result.requirementIds,
        });
      }

      for (const attachment of attachments) {
        const copy = new Uint8Array(attachment.content.length);
        copy.set(attachment.content);
        const blob = new Blob([copy], {
          type: attachment.contentType,
        });
        const fileId = await ctx.storage.store(blob);
        const result = await ctx.runAction(
          internal.actions.complianceRequirements.importRequirementsInternal,
          {
            orgId: args.orgId,
            userId: args.userId,
            fileId,
            fileName: attachment.filename ?? "email-requirements",
            contentType: attachment.contentType,
            sourceType: args.sourceType,
            appliesTo: args.appliesTo,
          },
        ) as { createdCount: number; requirementIds: Id<"insuranceRequirements">[] };
        imports.push({
          source: "attachment" as const,
          fileId,
          fileName: attachment.filename ?? "email-requirements",
          createdCount: result.createdCount,
          requirementIds: result.requirementIds,
        });
      }

      return {
        status: "imported" as const,
        imports,
      };
    });
  },
});

export const importRequirementAttachments = action({
  args: {
    orgId: v.id("organizations"),
    emailRef: v.string(),
    filenames: v.optional(v.array(v.string())),
    includeEmailBody: v.optional(v.boolean()),
    sourceType: v.optional(
      v.union(
        v.literal("lease_agreement"),
        v.literal("client_contract"),
        v.literal("vendor_requirements"),
        v.literal("other"),
      ),
    ),
    appliesTo: v.optional(
      v.union(v.literal("vendors"), v.literal("own_org"), v.literal("both")),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await requireOrgMember(ctx, args.orgId, userId as Id<"users">);
    return await ctx.runAction(internal.actions.connectedEmail.importRequirementAttachmentsInternal, {
      orgId: args.orgId,
      userId: userId as Id<"users">,
      emailRef: args.emailRef,
      filenames: args.filenames,
      includeEmailBody: args.includeEmailBody,
      sourceType: args.sourceType,
      appliesTo: args.appliesTo,
    }) as Record<string, unknown>;
  },
});

export const scanPreviousDayForOrg = action({
  args: {
    orgId: v.id("organizations"),
    cronSecret: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const expectedSecret = process.env.EMAIL_SCAN_CRON_SECRET;
    if (!expectedSecret) {
      throw new Error("EMAIL_SCAN_CRON_SECRET is not configured");
    }
    if (args.cronSecret !== expectedSecret) {
      throw new Error("Unauthorized mailbox scan");
    }

    const accounts = await ctx.runQuery(
      internal.connectedEmail.listOrgScopedInternal,
      { orgId: args.orgId },
    ) as ConnectedEmailAccount[];
    if (accounts.length === 0) return { status: "no_org_mailboxes" as const };

    const members = await ctx.runQuery(internal.orgs.getMembersInternal, {
      orgId: args.orgId,
    }) as Array<{
      userId: Id<"users">;
      role: string;
      user?: { name?: string; phone?: string };
    }>;
    const firstMember = members[0];
    if (!firstMember) return { status: "no_org_members" as const };

    const start = dayjs().subtract(1, "day").startOf("day");
    const end = dayjs().startOf("day");
    const rows: Array<Record<string, unknown>> = [];

    for (const account of accounts.slice(0, 5)) {
      const accountRows = await withClient(account, async (client) => {
        await client.mailboxOpen("INBOX");
        const searchResult = await client.search(
          { since: start.toDate(), before: end.toDate() },
          { uid: true },
        );
        const uids = Array.isArray(searchResult) ? searchResult.slice(-50).reverse() : [];
        const messages = [];
        for (const uid of uids) {
          const parsed = await fetchParsedMessage(client, "INBOX", uid);
          messages.push({
            emailRef: messageRef(account._id, "INBOX", uid),
            account: account.emailAddress,
            subject: parsed.subject ?? "(no subject)",
            from: parsed.from?.text,
            date: parsed.date ? dayjs(parsed.date).toISOString() : undefined,
            snippet: (parsed.text ?? "").replace(/\s+/g, " ").trim().slice(0, 800),
            attachments: parsed.attachments.map((attachment) => ({
              filename: attachment.filename,
              contentType: attachment.contentType,
              size: attachment.size,
            })),
          });
        }
        return messages;
      });
      rows.push(...accountRows);
    }

    if (rows.length === 0) return { status: "no_messages" as const };

    const classification = await generateObject({
      model: await getModelForOrg(ctx, args.orgId, "mailbox_coordinator"),
      providerOptions: getProviderOptionsForTask("mailbox_coordinator"),
      schema: DailyAttentionSchema,
      system:
        "You review yesterday's mailbox summaries for a commercial insurance team. Return only messages that appear to need insurance-specific attention, such as policy renewals, certificates, claims, compliance requirements, vendor insurance, lease/contract insurance language, cancellations, nonrenewals, premium issues, or broker/client follow-up. Ignore marketing, newsletters, receipts, generic scheduling, and unrelated personal mail.",
      prompt: JSON.stringify(rows),
    });

    const items = classification.object.items;
    if (items.length === 0) {
      return { status: "no_attention_items" as const, scannedCount: rows.length };
    }

    const body = [
      `Yesterday's connected-mailbox scan found ${items.length} item${items.length === 1 ? "" : "s"} that may need insurance attention:`,
      ...items.map(
        (item, index) =>
          `${index + 1}. ${item.subject}${item.from ? ` from ${item.from}` : ""}: ${item.reason} Suggested action: ${item.suggestedAction}`,
      ),
    ].join("\n\n");

    const workerUrl = getImessageWorkerUrl();
    const phoneMembers = members
      .filter((member) => typeof member.user?.phone === "string" && member.user.phone.length > 0)
      .slice(0, 10);
    const sentPhones: string[] = [];
    if (workerUrl && phoneMembers.length > 0) {
      const seenPhones = new Set<string>();
      for (const member of phoneMembers) {
        const toPhone = member.user!.phone!;
        if (seenPhones.has(toPhone)) continue;
        seenPhones.add(toPhone);
        try {
          const response = await fetch(`${workerUrl.replace(/\/$/, "")}/send`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.IMESSAGE_WORKER_SECRET ?? ""}`,
            },
            body: JSON.stringify({ toPhone, message: body }),
          });
          if (response.ok) {
            sentPhones.push(toPhone);
            const threadId = await ctx.runMutation(internal.threads.findOrCreateByPhone, {
              orgId: args.orgId,
              userId: member.userId,
              fromPhone: toPhone,
              userName: member.user?.name,
            });
            await ctx.runMutation(internal.threads.insertImessageMessage, {
              threadId,
              orgId: args.orgId,
              role: "agent",
              userId: member.userId,
              content: body,
            });
          }
        } catch (error) {
          console.warn("[connectedEmail] Daily iMessage scan alert failed:", error);
        }
      }
    }

    const webThread = sentPhones.length === 0
      ? await ctx.runMutation(internal.threads.createProactiveInternal, {
          orgId: args.orgId,
          userId: firstMember.userId,
          title: "Mailbox items needing attention",
          content: body,
        })
      : undefined;

    return {
      status: "surfaced" as const,
      scannedCount: rows.length,
      itemCount: items.length,
      sentPhones,
      webThread,
    };
  },
});

export const scanPreviousDay = action({
  args: {
    cronSecret: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const expectedSecret = process.env.EMAIL_SCAN_CRON_SECRET;
    if (!expectedSecret) {
      throw new Error("EMAIL_SCAN_CRON_SECRET is not configured");
    }
    if (args.cronSecret !== expectedSecret) {
      throw new Error("Unauthorized mailbox scan");
    }

    const orgIds = await ctx.runQuery(
      internal.connectedEmail.listOrgIdsWithOrgScopedAccountsInternal,
      {},
    ) as Id<"organizations">[];
    const results = [];
    for (const orgId of orgIds) {
      const result = await ctx.runAction(api.actions.connectedEmail.scanPreviousDayForOrg, {
        orgId,
        cronSecret: args.cronSecret,
      });
      results.push({ orgId, result });
    }
    return {
      status: "scanned" as const,
      orgCount: orgIds.length,
      results,
    };
  },
});
