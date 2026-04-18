"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { buildExtractor, insuranceDocToPolicy } from "../lib/extraction";
import { makeEmbedText } from "../lib/sdkCallbacks";
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

    const resolvedFileName = args.fileName ?? "upload.pdf";

    // Create placeholder policy record (type determined by extraction)
    const policyId: Id<"policies"> = await ctx.runMutation(api.policies.insert, {
      userId,
      orgId,
      fileId: args.fileId,
      fileName: resolvedFileName,
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

    // ── Create policyFiles record for this upload ──
    let policyFileId: Id<"policyFiles"> | undefined;
    try {
      policyFileId = await ctx.runMutation(internal.policyFiles.insert, {
        policyId,
        fileId: args.fileId,
        fileName: resolvedFileName,
        fileType: "unknown",
        extractionStatus: "extracting",
        orgId,
      });

      // Update the denormalized files array on the policy
      await ctx.runMutation(internal.policies.updateFiles, {
        id: policyId,
        files: [{
          fileId: args.fileId,
          fileName: resolvedFileName,
          fileType: "unknown",
          status: "extracting",
        }],
      });
    } catch (err: any) {
      // Non-critical — log but don't abort extraction
      console.error("Failed to create policyFiles record:", err.message);
    }

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
      await log(`Uploaded PDF (${sizeKB} KB). Starting extraction pipeline.`);

      // Unified extraction — SDK handles classification, extraction, and assembly
      const extractor = buildExtractor({
        log,
        onProgress: async (msg) => { await log(msg); },
      });

      const result = await extractor.extract(
        pdfBase64,
        policyId as string,
      );
      const doc = result.document as any;
      const chunks = result.chunks;
      const tokenUsage = result.tokenUsage;

      await log(`Extraction complete. Type: ${doc.type}. ${chunks.length} chunks. Tokens: ${tokenUsage.inputTokens}in/${tokenUsage.outputTokens}out`);

      // Map InsuranceDocument → Prism policy fields
      const fields = insuranceDocToPolicy(result.document);
      const docName = doc.type === "quote"
        ? (doc.quoteNumber || "quote")
        : (doc.policyNumber || "policy");
      const finalFileName = args.fileName || `${docName}.pdf`;

      await ctx.runMutation(api.policies.updateExtraction, {
        id: policyId,
        fileName: finalFileName,
        ...fields,
      });

      // ── Update policyFiles record with extraction result ──
      if (policyFileId) {
        try {
          await ctx.runMutation(internal.policyFiles.updateExtraction, {
            id: policyFileId,
            extractionStatus: "complete",
            extractedData: result.document,
          });

          // Update denormalized files array — single upload, so set reconciled immediately
          await ctx.runMutation(internal.policies.updateFiles, {
            id: policyId,
            files: [{
              fileId: args.fileId,
              fileName: finalFileName,
              fileType: "unknown",
              status: "complete",
            }],
            reconciliationStatus: "reconciled",
          });
        } catch (err: any) {
          // Non-critical
          console.error("Failed to update policyFiles record:", err.message);
        }
      }

      // Store document chunks for vector search
      if (chunks.length > 0) {
        const embed = makeEmbedText();
        for (const chunk of chunks) {
          try {
            const embedding = await embed(chunk.text);
            await ctx.runMutation(internal.documentChunks.insert, {
              orgId,
              policyId,
              chunkId: chunk.id,
              chunkType: chunk.type,
              text: chunk.text,
              metadata: chunk.metadata,
              embedding,
              createdAt: Date.now(),
            });
          } catch (err: any) {
            await log(`Warning: failed to embed chunk ${chunk.id}: ${err.message}`);
          }
        }
        await log(`Stored ${chunks.length} chunks for vector search.`);
      }

      await log(`${doc.type === "quote" ? "Quote" : "Policy"} extraction complete`);

      await ctx.runMutation(internal.policyAuditLog.append, {
        policyId,
        userId,
        orgId,
        action: "extraction_complete",
      });

      return { success: true, type: doc.type, id: policyId };
    } catch (error: any) {
      await log(`Failed: ${error.message || "Extraction failed"}`);
      await ctx.runMutation(api.policies.updateExtraction, {
        id: policyId,
        extractionStatus: "error",
        extractionError: error.message || "Extraction failed",
      });

      // Mark policyFiles record as error too
      if (policyFileId) {
        try {
          await ctx.runMutation(internal.policyFiles.updateExtraction, {
            id: policyFileId,
            extractionStatus: "error",
            extractionError: error.message || "Extraction failed",
          });
          await ctx.runMutation(internal.policies.updateFiles, {
            id: policyId,
            files: [{
              fileId: args.fileId,
              fileName: resolvedFileName,
              fileType: "unknown",
              status: "error",
            }],
          });
        } catch {
          // Non-critical
        }
      }

      return { error: error.message || "Extraction failed" };
    }
  },
});
