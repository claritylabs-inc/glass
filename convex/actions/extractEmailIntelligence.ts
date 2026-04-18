"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getModel, generateTextWithFallback } from "../lib/models";
import { makeEmbedText } from "../lib/sdkCallbacks";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { ImapFlow } from "imapflow";

// ── Helpers ──

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getHeader(
  headers: Array<{ name?: string | null; value?: string | null }>,
  name: string
): string {
  const header = headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase()
  );
  return header?.value || "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPlainTextFromParts(parts: any[]): string {
  for (const part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return Buffer.from(part.body.data, "base64url").toString("utf-8");
    }
    if (part.parts) {
      const nested = extractPlainTextFromParts(part.parts);
      if (nested) return nested;
    }
  }
  // Fall back to HTML
  for (const part of parts) {
    if (part.mimeType === "text/html" && part.body?.data) {
      const html = Buffer.from(part.body.data, "base64url").toString("utf-8");
      return stripHtml(html);
    }
    if (part.parts) {
      const nested = extractPlainTextFromParts(part.parts);
      if (nested) return nested;
    }
  }
  return "";
}

async function fetchGmailBody(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connection: any,
  messageId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any
): Promise<string> {
  const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
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
    const { credentials } = await oauth2Client.refreshAccessToken();
    await ctx.runMutation(internal.connections.updateTokens, {
      id: connection._id,
      accessToken: credentials.access_token!,
      tokenExpiry: credentials.expiry_date!,
    });
    oauth2Client.setCredentials(credentials);
  }

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const msgResponse = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const payload = msgResponse.data.payload;
  if (!payload) return "";

  // Single-part message
  if (payload.body?.data) {
    const text = Buffer.from(payload.body.data, "base64url").toString("utf-8");
    return payload.mimeType === "text/html" ? stripHtml(text) : text;
  }

  // Multi-part message
  if (payload.parts) {
    return extractPlainTextFromParts(payload.parts);
  }

  return "";
}

async function fetchImapBody(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connection: any,
  uid: number
): Promise<string> {
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

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const { content } = await client.download(String(uid), undefined, {
        uid: true,
      });
      const chunks: Buffer[] = [];
      for await (const chunk of content) {
        chunks.push(Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks).toString("utf-8");
      // Simple extraction: if it looks like HTML, strip tags
      if (raw.includes("<html") || raw.includes("<body")) {
        return stripHtml(raw);
      }
      return raw;
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

// ── Main Action ──

export const extractSingle = internalAction({
  args: {
    emailId: v.id("emails"),
    connectionId: v.id("emailConnections"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const email = await ctx.runQuery(internal.emails.getInternal, {
      id: args.emailId,
    });
    if (!email) {
      console.error(`Email ${args.emailId} not found`);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connection: any = await ctx.runQuery(internal.connections.getInternal, {
      id: args.connectionId,
    });
    if (!connection) {
      console.error(`Connection ${args.connectionId} not found`);
      await ctx.runMutation(internal.emails.updateIntelligenceStatus, {
        id: args.emailId,
        intelligenceStatus: "error" as const,
      });
      return;
    }

    // ── Stage 1: Fetch email body ──
    let body: string;
    try {
      if (connection.provider === "google") {
        // Gmail messageId is stored in email.messageId (may have angle brackets from Message-ID header)
        // Gmail API uses the internal message ID, which was the original msgId from list
        // The messageId stored might be the Message-ID header — we need the Gmail internal ID
        // In scanGmail.ts, messageId is set to the Message-ID header value or `gmail-${msgId}`
        // If it starts with "gmail-", the actual Gmail ID is after the prefix
        let gmailId = email.messageId;
        if (gmailId.startsWith("gmail-")) {
          gmailId = gmailId.slice(6);
        } else {
          // It's a Message-ID header value — we need to search for it
          const oauth2Client = new OAuth2Client(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET
          );
          oauth2Client.setCredentials({
            access_token: connection.accessToken,
            refresh_token: connection.refreshToken,
          });
          const gmail = google.gmail({ version: "v1", auth: oauth2Client });
          const searchResult = await gmail.users.messages.list({
            userId: "me",
            q: `rfc822msgid:${gmailId}`,
            maxResults: 1,
          });
          gmailId = searchResult.data.messages?.[0]?.id || gmailId;
        }
        body = await fetchGmailBody(connection, gmailId, ctx);
      } else {
        // IMAP
        const uid = email.uid;
        if (!uid) throw new Error("No UID for IMAP email");
        body = await fetchImapBody(connection, uid);
      }
    } catch (error: unknown) {
      console.error(
        `Body fetch failed for email ${args.emailId}: ${error instanceof Error ? error.message : String(error)}`
      );
      await ctx.runMutation(internal.emails.updateIntelligenceStatus, {
        id: args.emailId,
        intelligenceStatus: "error" as const,
      });
      return;
    }

    // Truncate body to ~8000 chars if very long
    if (body.length > 8000) {
      body = body.slice(0, 8000);
    }

    if (!body.trim()) {
      // Empty body — nothing to extract
      await ctx.runMutation(internal.emails.updateIntelligenceStatus, {
        id: args.emailId,
        intelligenceStatus: "extracted" as const,
        intelligenceExtractedAt: Date.now(),
      });
      return;
    }

    // ── Stage 2: Parallel extraction ──
    const emailContext = `Email subject: ${email.subject}\nFrom: ${email.from}\nDate: ${email.date}\nBody: ${body}`;

    try {
      const [businessResult, riskResult] = await Promise.all([
        // Business Context Agent
        generateTextWithFallback({
          model: getModel("email_extraction"),
          maxOutputTokens: 8192,
          system: `You are extracting business intelligence from an email. Extract structured facts about the company, its operations, finances, and relationships. Only extract facts that are clearly stated or strongly implied.

IMPORTANT: Include temporal context when available. If the email mentions dates, time periods, quarters, fiscal years, or "as of" dates, include them in the extracted fact. For example: "Annual revenue of $5M as of FY2025" rather than just "Annual revenue is $5M".

Respond with ONLY valid JSON, no markdown.

Format: { "entries": [{ "content": "...", "category": "company_info" | "products_services" | "operations" | "employees" | "financial" | "clients" | "insurance" | "investors" | "vendors" | "partners" }] }

INTERNAL categories (about THIS org): company_info = own entity details, legal name, addresses, structure. products_services = own products/services — specs, features, pricing, service standards. operations = own internal processes, equipment, fleet. employees = own headcount, roles, HR. financial = own revenue, payroll, assets, expenses.
EXTERNAL relationship categories (about OTHER parties): clients = companies/people who buy from this org. insurance = brokers, carriers who insure this org. investors = investors, shareholders. vendors = companies who sell to or serve this org. partners = joint ventures, affiliates, uncertain relationships.

If no relevant business facts found, return { "entries": [] }.`,
          prompt: emailContext,
        }),

        // Risk & Intelligence Agent
        generateTextWithFallback({
          model: getModel("email_extraction"),
          maxOutputTokens: 8192,
          system: `You are extracting risk signals from an email. Extract information about claims, incidents, compliance issues, risk exposures, and business changes. Only extract facts that are clearly stated or strongly implied.

Do NOT extract insurance coverage details (limits, deductibles, policy terms) — those are handled separately by policy extraction.

IMPORTANT: Include temporal context when available. If the email mentions dates, deadlines, renewal dates, or incident dates, include them in the extracted fact.

Respond with ONLY valid JSON, no markdown.

Format: { "entries": [{ "content": "...", "category": "risk" | "observation" }] }

If no relevant risk signals found, return { "entries": [] }.`,
          prompt: emailContext,
        }),
      ]);

      function parseEntries(text: string): Array<{ content: string; category: string }> {
        try {
          const cleaned = text.replace(/```json\n?|```\n?/g, "").trim();
          const parsed = JSON.parse(cleaned);
          return Array.isArray(parsed?.entries) ? parsed.entries : [];
        } catch { return []; }
      }
      const businessEntries = parseEntries(businessResult.text);
      const riskEntries = parseEntries(riskResult.text);
      const allEntries = [...businessEntries, ...riskEntries];

      // ── Stage 3: Dedup + Embed + Store ──
      const embedText = makeEmbedText();
      let inserted = 0;

      for (const entry of allEntries) {
        try {
          // Generate embedding
          const embedding = await embedText(entry.content);

          // Check for near-duplicates via vector search
          const similar = await ctx.vectorSearch("orgIntelligence", "by_embedding", {
            vector: embedding,
            limit: 3,
            filter: (q) => q.eq("orgId", args.orgId),
          });

          const isDuplicate = similar.some(
            (s: { _score?: number }) => s._score && s._score > 0.95
          );
          if (isDuplicate) continue;

          // Insert intelligence entry
          await ctx.runMutation(internal.intelligence.insert, {
            orgId: args.orgId,
            content: entry.content,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            category: entry.category as any,
            confidence: "inferred" as const,
            source: "email" as const,
            sourceRef: args.emailId as string,
            sourceLabel: `Email: ${email.subject?.slice(0, 50) ?? "untitled"}`,
            documentDate: email.date ? new Date(email.date).toISOString().slice(0, 10) : undefined,
            embedding,
          });
          inserted++;
        } catch (entryError: unknown) {
          console.error(
            `Failed to process intelligence entry: ${entryError instanceof Error ? entryError.message : String(entryError)}`
          );
          // Continue with remaining entries
        }
      }

      console.log(
        `Extracted ${inserted} intelligence entries from email ${args.emailId}`
      );

      // ── Stage 4: Mark complete ──
      await ctx.runMutation(internal.emails.updateIntelligenceStatus, {
        id: args.emailId,
        intelligenceStatus: "extracted" as const,
        intelligenceExtractedAt: Date.now(),
      });
    } catch (error: unknown) {
      console.error(
        `Extraction failed for email ${args.emailId}: ${error instanceof Error ? error.message : String(error)}`
      );
      await ctx.runMutation(internal.emails.updateIntelligenceStatus, {
        id: args.emailId,
        intelligenceStatus: "error" as const,
      });
    }
  },
});
