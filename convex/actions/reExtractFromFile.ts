"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import Anthropic from "@anthropic-ai/sdk";
import { EXTRACTION_PROMPT, METADATA_PROMPT, buildSectionsPrompt } from "../lib/prompts";
import { stripFences, applyExtracted, mergeChunkedSections, getPageChunks } from "../lib/extraction";

const MODEL = "claude-sonnet-4-5-20250514";
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

export const reExtractFromFile = action({
  args: {
    policyId: v.id("policies"),
    fileId: v.id("_storage"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Verify auth
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) return { error: "Not authenticated" };

    // Verify policy exists and belongs to user
    const policy = await ctx.runQuery(api.policies.get, { id: args.policyId });
    if (!policy) return { error: "Policy not found" };

    // Set status to extracting
    await ctx.runMutation(api.policies.updateExtraction, {
      id: args.policyId,
      extractionStatus: "extracting",
      extractionError: "",
    });

    try {
      // Read file from Convex storage
      const blob = await ctx.storage.get(args.fileId);
      if (!blob) throw new Error("File not found in storage");

      const arrayBuffer = await blob.arrayBuffer();
      const pdfBase64 = Buffer.from(arrayBuffer).toString("base64");

      // Extract with Claude
      const anthropic = new Anthropic();
      const { rawText, extracted } = await extractFromPdf(anthropic, pdfBase64);

      // Save raw response
      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        rawExtractionResponse: rawText,
      });

      // Apply extraction results with new file
      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        fileId: args.fileId,
        fileName: `${(extracted.metadata ?? extracted).policyNumber || "policy"}.pdf`,
        ...applyExtracted(extracted),
      });

      return { success: true };
    } catch (error: any) {
      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        extractionStatus: "error",
        extractionError: error.message || "Re-extraction failed",
      });
      return { error: error.message || "Re-extraction failed" };
    }
  },
});
