"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import { ImapFlow } from "imapflow";
import Anthropic from "@anthropic-ai/sdk";
import { EXTRACTION_PROMPT, METADATA_PROMPT, buildSectionsPrompt } from "../lib/prompts";
import { stripFences, applyExtracted, mergeChunkedSections, getPageChunks } from "../lib/extraction";

const MODEL = "claude-sonnet-4-6";
const CHUNK_THRESHOLD = 30;

async function callClaude(
  anthropic: Anthropic,
  pdfBase64: string,
  prompt: string,
  maxTokens: number = 16384,
) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  });
  return response.content[0].type === "text" ? response.content[0].text : "{}";
}

async function extractFromPdf(anthropic: Anthropic, pdfBase64: string) {
  const rawText = await callClaude(anthropic, pdfBase64, EXTRACTION_PROMPT);
  const parsed = JSON.parse(stripFences(rawText));
  const totalPages = parsed.totalPages ?? 0;

  if (totalPages <= CHUNK_THRESHOLD) {
    return { rawText, extracted: parsed };
  }

  const metadataRaw = await callClaude(anthropic, pdfBase64, METADATA_PROMPT, 4096);
  const metadataResult = JSON.parse(stripFences(metadataRaw));
  const pageCount = metadataResult.totalPages || totalPages;
  const chunks = getPageChunks(pageCount);

  const sectionChunks: any[] = [];
  for (const [start, end] of chunks) {
    const chunkRaw = await callClaude(
      anthropic,
      pdfBase64,
      buildSectionsPrompt(start, end),
      8192,
    );
    sectionChunks.push(JSON.parse(stripFences(chunkRaw)));
  }

  const merged = mergeChunkedSections(metadataResult, sectionChunks);
  return { rawText: JSON.stringify(merged), extracted: merged };
}

export const retryExtraction = action({
  args: {
    policyId: v.id("policies"),
    mode: v.optional(v.union(v.literal("reparse"), v.literal("full"))),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Verify auth
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) return { error: "Not authenticated" };

    const policy = await ctx.runQuery(api.policies.get, { id: args.policyId });
    if (!policy) return { error: "Policy not found" };
    if (!policy.emailId) return { error: "No linked email — cannot retry" };

    const mode = args.mode ?? "auto";

    // Reparse mode: only re-parse the saved raw response
    if (mode === "reparse" || mode === "auto") {
      if (policy.rawExtractionResponse) {
        try {
          const responseText = stripFences(policy.rawExtractionResponse);
          const extracted = JSON.parse(responseText);

          await ctx.runMutation(api.policies.updateExtraction, {
            id: args.policyId,
            fileName: `${(extracted.metadata ?? extracted).policyNumber || "policy"}.pdf`,
            ...applyExtracted(extracted),
          });

          return { success: true, reused: true };
        } catch {
          if (mode === "reparse") {
            return { error: "Could not parse saved AI response" };
          }
          // auto mode: fall through to full retry
        }
      } else if (mode === "reparse") {
        return { error: "No saved AI response to re-parse" };
      }
    }

    // Full retry with API call
    const emails = await ctx.runQuery(api.emails.list, {});
    const email = emails.find((e: any) => e._id === policy.emailId);
    if (!email) return { error: "Linked email not found" };

    const connection = await ctx.runQuery(api.connections.get, {
      id: email.connectionId,
    });
    if (!connection) return { error: "Email connection not found" };

    // Reset status to extracting
    await ctx.runMutation(api.policies.updateExtraction, {
      id: args.policyId,
      extractionStatus: "extracting",
      extractionError: "",
    });

    try {
      // Download PDF attachment via IMAP
      const client = new ImapFlow({
        host: connection.imapHost,
        port: connection.imapPort,
        secure: true,
        auth: { user: connection.email, pass: connection.password },
        logger: false,
      });

      let pdfBuffer: Buffer;
      try {
        await client.connect();
        const lock = await client.getMailboxLock("INBOX");
        try {
          const { content } = await client.download(
            String(email.uid ?? 0),
            "2",
            { uid: true }
          );
          const chunks: Buffer[] = [];
          for await (const chunk of content) {
            chunks.push(Buffer.from(chunk));
          }
          pdfBuffer = Buffer.concat(chunks);
        } finally {
          lock.release();
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

      // Store in Convex file storage
      const blob = new Blob([new Uint8Array(pdfBuffer)], {
        type: "application/pdf",
      });
      const fileId = await ctx.storage.store(blob);

      // Extract with Claude
      const pdfBase64 = pdfBuffer.toString("base64");
      const anthropic = new Anthropic();
      const { rawText, extracted } = await extractFromPdf(anthropic, pdfBase64);

      // Save raw response for future retries
      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        rawExtractionResponse: rawText,
      });

      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        fileId,
        fileName: `${(extracted.metadata ?? extracted).policyNumber || "policy"}.pdf`,
        ...applyExtracted(extracted),
      });

      return { success: true };
    } catch (error: any) {
      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        extractionStatus: "error",
        extractionError: error.message || "Extraction failed",
      });
      return { error: error.message || "Extraction failed" };
    }
  },
});
