"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import Anthropic from "@anthropic-ai/sdk";
import { applyExtracted, extractFromPdf } from "../lib/extraction";

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

    const log = async (message: string) => {
      await ctx.runMutation(internal.policies.appendExtractionLog, { id: args.policyId, message });
    };

    // Set status to extracting
    await ctx.runMutation(internal.policies.clearExtractionLog, { id: args.policyId });
    await log("Reading uploaded PDF...");
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
      const { rawText, extracted } = await extractFromPdf(
        anthropic, pdfBase64, log,
        async (raw) => {
          await ctx.runMutation(api.policies.updateExtraction, {
            id: args.policyId,
            rawMetadataResponse: raw,
          });
        },
      );

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

      await log("Extraction complete");
      return { success: true };
    } catch (error: any) {
      await log(`Failed: ${error.message || "Re-extraction failed"}`);
      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        extractionStatus: "error",
        extractionError: error.message || "Re-extraction failed",
      });
      return { error: error.message || "Re-extraction failed" };
    }
  },
});
