"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * Extract a policy or quote from a manually uploaded PDF file.
 * Does not require an email connection — used for direct uploads.
 * Thin wrapper — all extraction logic lives in policyExtraction.ts.
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

    // Verify the file exists before creating rows
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
    const policyFileId: Id<"policyFiles"> = await ctx.runMutation(
      (internal as any).policyFiles.insert,
      {
        policyId,
        fileId: args.fileId,
        fileName: args.fileName || "upload.pdf",
        fileType: "unknown" as const,
        extractionStatus: "extracting" as const,
        orgId,
      },
    );

    // Update denormalized files array on policy
    await ctx.runMutation((internal as any).policies.updateFiles, {
      id: policyId,
      files: [{ fileId: args.fileId, fileName: args.fileName || "upload.pdf", fileType: "unknown", status: "extracting" }],
      reconciliationStatus: "pending" as const,
    });

    await ctx.runMutation(internal.policyAuditLog.append, {
      policyId,
      userId,
      orgId,
      action: "extraction_started",
    });

    // Start cl-pipelines extraction (fire-and-forget)
    await ctx.runAction(internal.actions.policyExtraction.startPolicyExtractionFromUpload, {
      policyId,
      fileId: args.fileId,
      fileName: args.fileName,
      orgId,
      userId,
      policyFileId,
    });

    return { success: true, type: "policy", id: String(policyId) };
  },
});
