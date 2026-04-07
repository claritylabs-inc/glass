"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { applyExtracted, applyExtractedQuote, extractFromPdf, extractQuoteFromPdf, classifyDocumentType, buildExtractionModels } from "../lib/extraction";
import { Id } from "../_generated/dataModel";

/**
 * Extract a policy or quote from a manually uploaded PDF file.
 * Does not require an email connection — used for direct uploads.
 */
export const extractFromUpload = action({
  args: {
    fileId: v.id("_storage"),
    fileName: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<{ error: string } | { success: true; type: string; id: string }> => {
    const viewer = await ctx.runQuery(api.users.viewer) as any;
    if (!viewer) return { error: "Not authenticated" };

    const orgData = await ctx.runQuery(api.orgs.viewerOrg) as any;
    if (!orgData) return { error: "No organization" };

    const orgId = orgData.membership.orgId as Id<"organizations">;
    const userId = viewer._id as Id<"users">;

    const blob = await ctx.storage.get(args.fileId);
    if (!blob) return { error: "File not found in storage" };

    const arrayBuffer = await blob.arrayBuffer();
    const pdfBase64 = Buffer.from(arrayBuffer).toString("base64");
    const sizeKB = Math.round(arrayBuffer.byteLength / 1024);

    // Classify document type (policy vs quote)
    const models = buildExtractionModels();
    const { documentType } = await classifyDocumentType(pdfBase64, { models });

    if (documentType === "quote") {
      // === QUOTE EXTRACTION ===
      const quoteId: Id<"quotes"> = await ctx.runMutation(api.quotes.insert, {
        userId,
        orgId,
        fileId: args.fileId,
        fileName: args.fileName,
        carrier: "Extracting...",
        quoteNumber: "Extracting...",
        quoteYear: new Date().getFullYear(),
        isRenewal: false,
        coverages: [],
        insuredName: "Extracting...",
        extractionStatus: "extracting",
      });

      const log = async (message: string) => {
        await ctx.runMutation(internal.quotes.appendExtractionLog, { id: quoteId, message });
      };

      await ctx.runMutation(internal.policyAuditLog.append, {
        quoteId,
        userId,
        orgId,
        action: "extraction_started",
      });

      try {
        await ctx.runMutation(internal.quotes.clearExtractionLog, { id: quoteId });
        await log(`Uploaded PDF (${sizeKB} KB). Classified as quote.`);

        const { rawText, extracted } = await extractQuoteFromPdf(pdfBase64, {
          log,
          models,
          concurrency: 3,
          onMetadata: async (raw: string) => {
            await ctx.runMutation(api.quotes.updateExtraction, {
              id: quoteId,
              rawMetadataResponse: raw,
            });
          },
        });

        await ctx.runMutation(api.quotes.updateExtraction, {
          id: quoteId,
          rawExtractionResponse: rawText,
        });

        await ctx.runMutation(api.quotes.updateExtraction, {
          id: quoteId,
          fileName: args.fileName || `${(extracted.metadata ?? extracted).quoteNumber || "quote"}.pdf`,
          ...applyExtractedQuote(extracted),
        });

        await log("Quote extraction complete");

        await ctx.runMutation(internal.policyAuditLog.append, {
          quoteId,
          userId,
          orgId,
          action: "extraction_complete",
        });

        return { success: true, type: "quote", id: quoteId };
      } catch (error: any) {
        await log(`Failed: ${error.message || "Extraction failed"}`);
        await ctx.runMutation(api.quotes.updateExtraction, {
          id: quoteId,
          extractionStatus: "error",
          extractionError: error.message || "Extraction failed",
        });
        return { error: error.message || "Extraction failed" };
      }
    } else {
      // === POLICY EXTRACTION ===
      const policyId: Id<"policies"> = await ctx.runMutation(api.policies.insert, {
        userId,
        orgId,
        fileId: args.fileId,
        fileName: args.fileName,
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

      const log = async (message: string) => {
        await ctx.runMutation(internal.policies.appendExtractionLog, { id: policyId, message });
      };

      await ctx.runMutation(internal.policyAuditLog.append, {
        policyId,
        userId,
        orgId,
        action: "extraction_started",
      });

      try {
        await ctx.runMutation(internal.policies.clearExtractionLog, { id: policyId });
        await log(`Uploaded PDF (${sizeKB} KB). Classified as policy.`);

        const { rawText, extracted } = await extractFromPdf(pdfBase64, {
          log,
          models,
          concurrency: 3,
          onMetadata: async (raw: string) => {
            await ctx.runMutation(api.policies.updateExtraction, {
              id: policyId,
              rawMetadataResponse: raw,
            });
          },
        });

        await ctx.runMutation(api.policies.updateExtraction, {
          id: policyId,
          rawExtractionResponse: rawText,
        });

        await ctx.runMutation(api.policies.updateExtraction, {
          id: policyId,
          fileName: args.fileName || `${(extracted.metadata ?? extracted).policyNumber || "policy"}.pdf`,
          ...applyExtracted(extracted),
        });

        await log("Extraction complete");

        await ctx.runMutation(internal.policyAuditLog.append, {
          policyId,
          userId,
          orgId,
          action: "extraction_complete",
        });

        return { success: true, type: "policy", id: policyId };
      } catch (error: any) {
        await log(`Failed: ${error.message || "Extraction failed"}`);
        await ctx.runMutation(api.policies.updateExtraction, {
          id: policyId,
          extractionStatus: "error",
          extractionError: error.message || "Extraction failed",
        });
        return { error: error.message || "Extraction failed" };
      }
    }
  },
});
