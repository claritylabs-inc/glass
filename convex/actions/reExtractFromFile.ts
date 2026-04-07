"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { applyExtracted, applyExtractedQuote, extractFromPdf, extractQuoteFromPdf, buildExtractionModels } from "../lib/extraction";

export const reExtractFromFile = action({
  args: {
    policyId: v.id("policies"),
    fileId: v.id("_storage"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) return { error: "Not authenticated" };

    const policy = await ctx.runQuery(api.policies.get, { id: args.policyId });
    if (!policy) return { error: "Policy not found" };

    const log = async (message: string) => {
      await ctx.runMutation(internal.policies.appendExtractionLog, { id: args.policyId, message });
    };

    await ctx.runMutation(internal.policyAuditLog.append, {
      policyId: args.policyId,
      userId: viewer._id,
      action: "pdf_uploaded",
    });

    await ctx.runMutation(internal.policies.clearExtractionLog, { id: args.policyId });
    await log("Reading uploaded PDF...");
    await ctx.runMutation(api.policies.updateExtraction, {
      id: args.policyId,
      extractionStatus: "extracting",
      extractionError: "",
    });

    try {
      const blob = await ctx.storage.get(args.fileId);
      if (!blob) throw new Error("File not found in storage");

      const arrayBuffer = await blob.arrayBuffer();
      const pdfBase64 = Buffer.from(arrayBuffer).toString("base64");

      const models = buildExtractionModels();
      const { rawText, extracted } = await extractFromPdf(
        pdfBase64, {
        log,
        models,
        onMetadata: async (raw) => {
          await ctx.runMutation(api.policies.updateExtraction, {
            id: args.policyId,
            rawMetadataResponse: raw,
          });
        },
      });

      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        rawExtractionResponse: rawText,
      });

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

export const reExtractQuoteFromFile = action({
  args: {
    quoteId: v.id("quotes"),
    fileId: v.id("_storage"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) return { error: "Not authenticated" };

    const quote = await ctx.runQuery(api.quotes.get, { id: args.quoteId });
    if (!quote) return { error: "Quote not found" };

    const log = async (message: string) => {
      await ctx.runMutation(internal.quotes.appendExtractionLog, { id: args.quoteId, message });
    };

    await ctx.runMutation(internal.policyAuditLog.append, {
      quoteId: args.quoteId,
      userId: viewer._id,
      action: "pdf_uploaded",
    });

    await ctx.runMutation(internal.quotes.clearExtractionLog, { id: args.quoteId });
    await log("Reading uploaded PDF...");
    await ctx.runMutation(api.quotes.updateExtraction, {
      id: args.quoteId,
      extractionStatus: "extracting",
      extractionError: "",
    });

    try {
      const blob = await ctx.storage.get(args.fileId);
      if (!blob) throw new Error("File not found in storage");

      const arrayBuffer = await blob.arrayBuffer();
      const pdfBase64 = Buffer.from(arrayBuffer).toString("base64");

      const models = buildExtractionModels();
      const { rawText, extracted } = await extractQuoteFromPdf(
        pdfBase64, {
        log,
        models,
        onMetadata: async (raw) => {
          await ctx.runMutation(api.quotes.updateExtraction, {
            id: args.quoteId,
            rawMetadataResponse: raw,
          });
        },
      });

      await ctx.runMutation(api.quotes.updateExtraction, {
        id: args.quoteId,
        rawExtractionResponse: rawText,
      });

      await ctx.runMutation(api.quotes.updateExtraction, {
        id: args.quoteId,
        fileName: `${(extracted.metadata ?? extracted).quoteNumber || "quote"}.pdf`,
        ...applyExtractedQuote(extracted),
      });

      await log("Quote extraction complete");
      return { success: true };
    } catch (error: any) {
      await log(`Failed: ${error.message || "Re-extraction failed"}`);
      await ctx.runMutation(api.quotes.updateExtraction, {
        id: args.quoteId,
        extractionStatus: "error",
        extractionError: error.message || "Re-extraction failed",
      });
      return { error: error.message || "Re-extraction failed" };
    }
  },
});
