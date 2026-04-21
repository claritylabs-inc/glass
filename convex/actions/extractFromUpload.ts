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
    // Broker upload path: pre-created policy row from createBrokerUpload
    policyId: v.optional(v.id("policies")),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<{ error: string } | { success: true; type: string; id: string }> => {
    const viewer = await ctx.runQuery(api.users.viewer) as { _id: string } | null;
    if (!viewer) return { error: "Not authenticated" };

    const orgData = await ctx.runQuery(api.orgs.viewerOrg, {}) as { membership: { orgId: string } } | null;
    if (!orgData) return { error: "No organization" };

    const orgId = orgData.membership.orgId as Id<"organizations">;
    const userId = viewer._id as Id<"users">;

    const pdfUrl = await ctx.storage.getUrl(args.fileId);
    if (!pdfUrl) return { error: "File not found in storage" };

    // If a pre-created policyId (from broker upload) is provided, use it;
    // otherwise create a new placeholder policy record.
    const policyId: Id<"policies"> = args.policyId ?? await ctx.runMutation(api.policies.insert, {
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

    // Create policyFile record for multi-file tracking
    const policyFileId = await ctx.runMutation((internal as any).policyFiles.insert, {
      policyId,
      fileId: args.fileId,
      fileName: args.fileName || "upload.pdf",
      fileType: "unknown" as const,
      extractionStatus: "extracting" as const,
      orgId,
    });

    // Update denormalized files array on policy
    await ctx.runMutation((internal as any).policies.updateFiles, {
      id: policyId,
      files: [{ fileId: args.fileId, fileName: args.fileName || "upload.pdf", fileType: "unknown", status: "extracting" }],
      reconciliationStatus: "pending" as const,
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
      await log(`Uploaded PDF stored. Starting extraction pipeline.`);

      // Unified extraction — SDK handles classification, extraction, and assembly.
      // Pass the Convex storage URL directly so the SDK / AI SDK can stream the PDF
      // without materializing a base64 copy in this action's memory.
      const extractor = buildExtractor({
        log,
        onProgress: async (msg) => { await log(msg); },
      });

      const result = await extractor.extract(
        new URL(pdfUrl),
        policyId as string,
      );
      const doc = result.document as { type?: string; quoteNumber?: string; policyNumber?: string };
      const chunks = result.chunks;
      const tokenUsage = result.tokenUsage;

      await log(`Extraction complete. Type: ${doc.type}. ${chunks.length} chunks. Tokens: ${tokenUsage.inputTokens}in/${tokenUsage.outputTokens}out`);

      // Map InsuranceDocument → Glass policy fields
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

      // Update policyFile with extraction result
      await ctx.runMutation((internal as any).policyFiles.updateExtraction, {
        id: policyFileId,
        extractionStatus: "complete",
        extractedData: result.document,
      });

      // Single file upload — mark as reconciled (no multi-file reconciliation needed)
      await ctx.runMutation((internal as any).policies.updateFiles, {
        id: policyId,
        files: [{ fileId: args.fileId, fileName: args.fileName || "upload.pdf", fileType: "unknown", status: "complete" }],
        reconciliationStatus: "reconciled",
      });

      await ctx.runMutation(internal.policyAuditLog.append, {
        policyId,
        userId,
        orgId,
        action: "extraction_complete",
      });

      // Emit broker-activity event if this was a broker-uploaded policy
      try {
        const finalPolicy = await ctx.runQuery(internal.policies.getInternal, { id: policyId });
        if (finalPolicy?.uploadedByBrokerOrgId && finalPolicy.orgId) {
          const docType = (finalPolicy.documentType ?? "policy") as "policy" | "quote";
          await ctx.runMutation((internal as any).brokerActivity.record, {
            brokerOrgId: finalPolicy.uploadedByBrokerOrgId,
            clientOrgId: finalPolicy.orgId,
            type: "policy_extraction_completed" as const,
            actorSide: "system" as const,
            payload: {
              policyId,
              documentType: docType,
              uploadedBySide: finalPolicy.uploadedBySide ?? "client",
            },
            summary: `${docType === "quote" ? "Quote" : "Policy"} extraction completed`,
          });
        }
      } catch (err) {
        console.error("brokerActivity record failed (non-critical):", err);
      }

      // Schedule duplicate policy detection
      await ctx.scheduler.runAfter(
        2000,
        (internal as any).actions.detectDuplicatePolicies.detectDuplicates,
        { policyId, orgId },
      );

      return { success: true, type: doc.type ?? "policy", id: policyId };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : "Extraction failed";
      await log(`Failed: ${errMsg}`);
      // Mark policyFile as error
      try {
        await ctx.runMutation((internal as any).policyFiles.updateExtraction, {
          id: policyFileId,
          extractionStatus: "error",
          extractionError: errMsg,
        });
        await ctx.runMutation((internal as any).policies.updateFiles, {
          id: policyId,
          files: [{ fileId: args.fileId, fileName: args.fileName || "upload.pdf", fileType: "unknown", status: "error" }],
        });
      } catch { /* non-critical */ }
      await ctx.runMutation(api.policies.updateExtraction, {
        id: policyId,
        extractionStatus: "error",
        extractionError: errMsg,
      });
      return { error: errMsg };
    }
  },
});
