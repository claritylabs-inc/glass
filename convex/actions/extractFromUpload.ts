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
    const viewer = await ctx.runQuery(api.users.viewer) as { _id: string } | null;
    if (!viewer) return { error: "Not authenticated" };

    const orgData = await ctx.runQuery(api.orgs.viewerOrg) as { membership: { orgId: string } } | null;
    if (!orgData) return { error: "No organization" };

    const orgId = orgData.membership.orgId as Id<"organizations">;
    const userId = viewer._id as Id<"users">;

    const blob = await ctx.storage.get(args.fileId);
    if (!blob) return { error: "File not found in storage" };

    const arrayBuffer = await blob.arrayBuffer();
    const pdfBase64 = Buffer.from(arrayBuffer).toString("base64");
    const sizeKB = Math.round(arrayBuffer.byteLength / 1024);

    // Create placeholder policy record (type determined by extraction)
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
      const doc = result.document as { type?: string; quoteNumber?: string; policyNumber?: string };
      const chunks = result.chunks;
      const tokenUsage = result.tokenUsage;

      await log(`Extraction complete. Type: ${doc.type}. ${chunks.length} chunks. Tokens: ${tokenUsage.inputTokens}in/${tokenUsage.outputTokens}out`);

      // Map InsuranceDocument → Prism policy fields
      const fields = insuranceDocToPolicy(result.document);
      const docName = doc.type === "quote"
        ? (doc.quoteNumber || "quote")
        : (doc.policyNumber || "policy");

      await ctx.runMutation(api.policies.updateExtraction, {
        id: policyId,
        fileName: args.fileName || `${docName}.pdf`,
        ...fields,
      });

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
          } catch (err: unknown) {
            await log(`Warning: failed to embed chunk ${chunk.id}: ${err instanceof Error ? err.message : String(err)}`);
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
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : "Extraction failed";
      await log(`Failed: ${errMsg}`);
      await ctx.runMutation(api.policies.updateExtraction, {
        id: policyId,
        extractionStatus: "error",
        extractionError: errMsg,
      });
      return { error: errMsg };
    }
  },
});
