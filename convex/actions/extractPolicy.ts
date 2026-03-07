"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { ImapFlow } from "imapflow";
import Anthropic from "@anthropic-ai/sdk";
import { EXTRACTION_PROMPT, METADATA_PROMPT, buildSectionsPrompt } from "../lib/prompts";
import { stripFences, applyExtracted, mergeChunkedSections, getPageChunks } from "../lib/extraction";

const MODEL = "claude-sonnet-4-5-20250514";
const CHUNK_THRESHOLD = 30; // pages

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
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBase64,
            },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  });
  return response.content[0].type === "text" ? response.content[0].text : "{}";
}

async function extractFromPdf(anthropic: Anthropic, pdfBase64: string) {
  // First pass — try single-call extraction
  const rawText = await callClaude(anthropic, pdfBase64, EXTRACTION_PROMPT);
  const parsed = JSON.parse(stripFences(rawText));
  const totalPages = parsed.totalPages ?? 0;

  // If document is short enough, single pass is sufficient
  if (totalPages <= CHUNK_THRESHOLD) {
    return { rawText, extracted: parsed };
  }

  // Long document — do chunked extraction
  // First call already gave us an attempt; use metadata from it
  // but re-extract sections in chunks for better coverage
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
  const mergedRaw = JSON.stringify(merged);
  return { rawText: mergedRaw, extracted: merged };
}

export const extractPolicy = internalAction({
  args: {
    emailId: v.id("emails"),
    connectionId: v.id("emailConnections"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const thisEmail = await ctx.runQuery(internal.emails.getInternal, {
      id: args.emailId,
    });
    if (!thisEmail) throw new Error("Email not found");

    const connection = await ctx.runQuery(internal.connections.getInternal, {
      id: args.connectionId,
    });
    if (!connection) throw new Error("Connection not found");

    // Create a pending policy record
    const policyId = await ctx.runMutation(api.policies.insert, {
      userId: args.userId,
      emailId: args.emailId,
      carrier: "Extracting...",
      policyNumber: "Extracting...",
      policyTypes: ["other"],
      documentType: "policy",
      policyYear: new Date().getFullYear(),
      effectiveDate: "Extracting...",
      expirationDate: "Extracting...",
      isRenewal: false,
      coverages: [],
      insuredName: "Extracting...",
      extractionStatus: "extracting",
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
            String(thisEmail.uid ?? 0),
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

      // Save raw response for retries
      await ctx.runMutation(api.policies.updateExtraction, {
        id: policyId,
        rawExtractionResponse: rawText,
      });

      await ctx.runMutation(api.policies.updateExtraction, {
        id: policyId,
        fileId,
        fileName: `${(extracted.metadata ?? extracted).policyNumber || "policy"}.pdf`,
        ...applyExtracted(extracted),
      });

      // Update extraction progress on connection
      await incrementExtracted(ctx, args.connectionId);
    } catch (error: any) {
      await ctx.runMutation(api.policies.updateExtraction, {
        id: policyId,
        extractionStatus: "error",
        extractionError: error.message || "Extraction failed",
      });
      console.error("Policy extraction failed:", error.message);

      // Still increment so progress completes
      await incrementExtracted(ctx, args.connectionId);
    }
  },
});

async function incrementExtracted(ctx: any, connectionId: any) {
  try {
    const conn = await ctx.runQuery(internal.connections.getInternal, { id: connectionId });
    if (!conn?.scanProgress) return;

    const progress = { ...conn.scanProgress };
    progress.extracted = (progress.extracted ?? 0) + 1;

    // If all extractions done, mark complete
    if (progress.extracted >= (progress.extracting ?? 0)) {
      progress.phase = "complete";
    }

    await ctx.runMutation(api.connections.updateScanProgress, {
      id: connectionId,
      scanProgress: progress,
    });
  } catch {
    // Non-critical — don't fail extraction over progress tracking
  }
}
