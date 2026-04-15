"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText } from "ai";
import { getModel } from "../lib/models";
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

function getHeader(
  headers: Array<{ name?: string | null; value?: string | null }>,
  name: string
): string {
  const header = headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase()
  );
  return header?.value || "";
}

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
  connection: any,
  messageId: string,
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

    const connection = await ctx.runQuery(internal.connections.getInternal, {
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
    } catch (error: any) {
      console.error(
        `Body fetch failed for email ${args.emailId}: ${error.message || error}`
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
        generateText({
          model: getModel("email_extraction"),
          maxOutputTokens: 2048,
          system: `You are extracting business intelligence from an email. Extract structured facts about the company, its operations, finances, and relationships. Only extract facts that are clearly stated or strongly implied.

IMPORTANT: Include temporal context when available. If the email mentions dates, time periods, quarters, fiscal years, or "as of" dates, include them in the extracted fact. For example: "Annual revenue of $5M as of FY2025" rather than just "Annual revenue is $5M".

Respond with ONLY valid JSON, no markdown.

Format: { "entries": [{ "content": "...", "category": "company_info" | "products_services" | "operations" | "employees" | "financial" | "clients" | "insurance" | "investors" | "vendors" | "partners" }] }

Category guide: company_info = entity details, locations, legal structure. products_services = what the company sells or provides. operations = internal processes, equipment, fleet, facilities. employees = headcount, roles, HR. financial = revenue, payroll, assets. clients = client/customer relationships. insurance = broker, carrier, underwriter relationships. investors = investor, shareholder, funding. vendors = vendors, service providers, suppliers, procurement. partners = general partnerships or uncertain relationship types.

If no relevant business facts found, return { "entries": [] }.`,
          prompt: emailContext,
        }),

        // Risk & Intelligence Agent
        generateText({
          model: getModel("email_extraction"),
          maxOutputTokens: 2048,
          system: `You are extracting risk signals and insurance intelligence from an email. Extract information about coverage discussions, claims, incidents, compliance, risk exposures, and business changes. Only extract facts that are clearly stated or strongly implied.

IMPORTANT: Include temporal context when available. If the email mentions dates, deadlines, renewal dates, or incident dates, include them in the extracted fact.

Respond with ONLY valid JSON, no markdown.

Format: { "entries": [{ "content": "...", "category": "coverage" | "risk" | "observation" }] }

If no relevant risk/insurance signals found, return { "entries": [] }.`,
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
            filter: (q: any) => q.eq("orgId", args.orgId),
          });

          const isDuplicate = similar.some(
            (s: any) => s._score && s._score > 0.95
          );
          if (isDuplicate) continue;

          // Insert intelligence entry
          await ctx.runMutation(internal.intelligence.insert, {
            orgId: args.orgId,
            content: entry.content,
            category: entry.category as any,
            confidence: "inferred" as const,
            source: "email" as const,
            sourceRef: args.emailId as string,
            sourceLabel: `Email: ${email.subject?.slice(0, 50) ?? "untitled"}`,
            documentDate: email.date ? new Date(email.date).toISOString().slice(0, 10) : undefined,
            embedding,
          });
          inserted++;
        } catch (entryError: any) {
          console.error(
            `Failed to process intelligence entry: ${entryError.message || entryError}`
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
    } catch (error: any) {
      console.error(
        `Extraction failed for email ${args.emailId}: ${error.message || error}`
      );
      await ctx.runMutation(internal.emails.updateIntelligenceStatus, {
        id: args.emailId,
        intelligenceStatus: "error" as const,
      });
    }
  },
});
