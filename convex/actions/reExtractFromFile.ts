"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { buildExtractor, insuranceDocToPolicy } from "../lib/extraction";
import { makeEmbedText } from "../lib/sdkCallbacks";

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

      // Delete old chunks before re-extracting
      await ctx.runMutation(internal.documentChunks.deleteByPolicy, { policyId: args.policyId });

      // Unified extraction — SDK handles classification, extraction, and assembly
      const extractor = buildExtractor({
        log,
        onProgress: async (msg) => { await log(msg); },
        onCheckpointSave: async (cp) => {
          await ctx.runMutation(api.policies.updateExtraction, {
            id: args.policyId,
            extractionCheckpoint: cp,
          });
        },
      });

      const result = await extractor.extract(
        pdfBase64,
        args.policyId as string,
      );
      const doc = result.document as Record<string, unknown>;
      const chunks = result.chunks;
      const tokenUsage = result.tokenUsage;

      await log(`Extraction complete. Type: ${doc.type}. ${chunks.length} chunks. Tokens: ${tokenUsage.inputTokens}in/${tokenUsage.outputTokens}out`);

      // Map InsuranceDocument → Prism policy fields
      const fields = insuranceDocToPolicy(result.document);
      const docName = doc.type === "quote"
        ? (doc.quoteNumber || "quote")
        : (doc.policyNumber || "policy");

      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        fileId: args.fileId,
        fileName: `${docName}.pdf`,
        extractionCheckpoint: undefined,
        ...fields,
      });

      // Store document chunks for vector search
      const orgId = (policy as Record<string, unknown>).orgId;
      if (chunks.length > 0 && orgId) {
        const embed = makeEmbedText();
        for (const chunk of chunks) {
          try {
            const embedding = await embed(chunk.text);
            await ctx.runMutation(internal.documentChunks.insert, {
              orgId,
              policyId: args.policyId,
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

      await log("Re-extraction complete");
      return { success: true };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : "Re-extraction failed";
      await log(`Failed: ${errMsg}`);
      await ctx.runMutation(api.policies.updateExtraction, {
        id: args.policyId,
        extractionStatus: "error",
        extractionError: errMsg,
      });
      return { error: errMsg };
    }
  },
});
