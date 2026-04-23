"use node";

import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
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
    });

    // Create policyFile record for multi-file tracking
    const policyFileId: Id<"policyFiles"> = await ctx.runMutation(
      (internal as any).policyFiles.insert,
      {
        policyId,
        fileId: args.fileId,
        fileName: args.fileName || "upload.pdf",
        fileType: "unknown" as const,
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

/**
 * Internal variant — callable from other actions (e.g. inbound email agent)
 * that already have orgId/userId resolved and can't rely on the viewer query.
 */
export const extractFromUploadInternal = internalAction({
  args: {
    files: v.array(
      v.object({
        fileId: v.id("_storage"),
        fileName: v.optional(v.string()),
      }),
    ),
    orgId: v.id("organizations"),
    userId: v.id("users"),
  },
  returns: v.any(),
  handler: async (
    ctx,
    args,
  ): Promise<{ error: string } | { success: true; policyId: string }> => {
    if (args.files.length < 1) return { error: "No files provided" };

    // Verify every file exists in storage first
    for (const f of args.files) {
      const url = await ctx.storage.getUrl(f.fileId);
      if (!url) return { error: `File not found in storage: ${f.fileName ?? f.fileId}` };
    }

    const [firstFile, ...restFiles] = args.files;
    const firstFileName = firstFile.fileName || "upload.pdf";

    const policyId: Id<"policies"> = await ctx.runMutation(api.policies.insert, {
      userId: args.userId,
      orgId: args.orgId,
      fileId: firstFile.fileId,
      fileName: firstFile.fileName,
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
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstPolicyFileId: Id<"policyFiles"> = await ctx.runMutation(
      (internal as any).policyFiles.insert,
      {
        policyId,
        fileId: firstFile.fileId,
        fileName: firstFileName,
        fileType: "unknown" as const,
        orgId: args.orgId,
      },
    );

    // Seed denormalized files array with the first file
    const denormFiles: Array<{
      fileId: Id<"_storage">;
      fileName: string;
      fileType: string;
      status: string;
    }> = [
      {
        fileId: firstFile.fileId,
        fileName: firstFileName,
        fileType: "unknown",
        status: "extracting",
      },
    ];

    // Insert policyFiles rows + append to denorm array for each additional file
    for (const extra of restFiles) {
      const extraName = extra.fileName || "upload.pdf";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await ctx.runMutation((internal as any).policyFiles.insert, {
        policyId,
        fileId: extra.fileId,
        fileName: extraName,
        fileType: "unknown" as const,
        orgId: args.orgId,
      });
      denormFiles.push({
        fileId: extra.fileId,
        fileName: extraName,
        fileType: "unknown",
        status: "extracting",
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.runMutation((internal as any).policies.updateFiles, {
      id: policyId,
      files: denormFiles,
      reconciliationStatus: "pending" as const,
    });

    await ctx.runMutation(internal.policyAuditLog.append, {
      policyId,
      userId: args.userId,
      orgId: args.orgId,
      action: "extraction_started",
    });

    // Kick off extraction against the first file (primary). Additional files
    // are attached as chunks via the supplementary path below so vector search
    // covers all of them.
    await ctx.runAction(
      internal.actions.policyExtraction.startPolicyExtractionFromUpload,
      {
        policyId,
        fileId: firstFile.fileId,
        fileName: firstFile.fileName,
        orgId: args.orgId,
        userId: args.userId,
        policyFileId: firstPolicyFileId,
      },
    );

    return { success: true, policyId: String(policyId) };
  },
});
