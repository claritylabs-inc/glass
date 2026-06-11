"use node";

import dayjs from "dayjs";
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
    // Additional files to merge with the primary before extraction
    additionalFiles: v.optional(
      v.array(
        v.object({
          fileId: v.id("_storage"),
          fileName: v.optional(v.string()),
        }),
      ),
    ),
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

    // If additional files are provided, merge them all into a single PDF and use
    // that as the primary file. Original storage objects are left orphaned.
    let primaryFileId: Id<"_storage"> = args.fileId;
    let primaryFileName: string | undefined = args.fileName;
    if (args.additionalFiles && args.additionalFiles.length > 0) {
      const { mergePdfsFromUrls, mergedFileName } = await import("../lib/mergePdfs");
      const allFiles = [
        { fileId: args.fileId, fileName: args.fileName },
        ...args.additionalFiles,
      ];
      const urls: string[] = [];
      for (const f of allFiles) {
        const url = await ctx.storage.getUrl(f.fileId);
        if (!url) return { error: `File not found in storage: ${f.fileName ?? f.fileId}` };
        urls.push(url);
      }
      const mergedBytes = await mergePdfsFromUrls(urls);
      const blob = new Blob([new Uint8Array(mergedBytes)], { type: "application/pdf" });
      primaryFileId = (await ctx.storage.store(blob)) as Id<"_storage">;
      primaryFileName = mergedFileName(args.fileName ?? "upload.pdf", allFiles.length);
    }

    // Verify the file exists before creating rows
    const pdfUrl = await ctx.storage.getUrl(primaryFileId);
    if (!pdfUrl) return { error: "File not found in storage" };

    // If a pre-created policyId (from broker upload) is provided, use it;
    // otherwise create a new placeholder policy record.
    const policyId: Id<"policies"> = args.policyId ?? await ctx.runMutation(api.policies.insert, {
      userId,
      orgId,
      fileId: primaryFileId,
      fileName: primaryFileName,
      carrier: "Extracting...",
      policyNumber: "Extracting...",
      policyTypes: ["other"],
      documentType: "policy",
      policyYear: dayjs().year(),
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
        fileId: primaryFileId,
        fileName: primaryFileName || "upload.pdf",
        fileType: "unknown" as const,
        orgId,
      },
    );

    // Update denormalized files array on policy. If we merged, also patch the
    // policy's primary fileId/fileName so the broker-pre-created row points
    // at the merged PDF instead of the first uploaded file.
    await ctx.runMutation((internal as any).policies.updateFiles, {
      id: policyId,
      files: [{ fileId: primaryFileId, fileName: primaryFileName || "upload.pdf", fileType: "unknown", status: "extracting" }],
      reconciliationStatus: "pending" as const,
      primaryFileId,
      primaryFileName: primaryFileName || "upload.pdf",
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
      fileId: primaryFileId,
      fileName: primaryFileName,
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

    // Verify every file exists in storage first + collect URLs for potential merge
    const urls: string[] = [];
    for (const f of args.files) {
      const url = await ctx.storage.getUrl(f.fileId);
      if (!url) return { error: `File not found in storage: ${f.fileName ?? f.fileId}` };
      urls.push(url);
    }

    // If multiple files, merge into a single PDF and use that as the primary.
    let primaryFileId = args.files[0].fileId;
    let primaryFileName = args.files[0].fileName || "upload.pdf";
    if (args.files.length > 1) {
      const { mergePdfsFromUrls, mergedFileName } = await import("../lib/mergePdfs");
      const mergedBytes = await mergePdfsFromUrls(urls);
      const blob = new Blob([new Uint8Array(mergedBytes)], { type: "application/pdf" });
      primaryFileId = (await ctx.storage.store(blob)) as Id<"_storage">;
      primaryFileName = mergedFileName(primaryFileName, args.files.length);
    }

    const policyId: Id<"policies"> = await ctx.runMutation(api.policies.insert, {
      userId: args.userId,
      orgId: args.orgId,
      fileId: primaryFileId,
      fileName: primaryFileName,
      carrier: "Extracting...",
      policyNumber: "Extracting...",
      policyTypes: ["other"],
      documentType: "policy",
      policyYear: dayjs().year(),
      effectiveDate: "Extracting...",
      expirationDate: "Extracting...",
      isRenewal: false,
      coverages: [],
      insuredName: "Extracting...",
    });


    const policyFileId: Id<"policyFiles"> = await ctx.runMutation(
      (internal as any).policyFiles.insert,
      {
        policyId,
        fileId: primaryFileId,
        fileName: primaryFileName,
        fileType: "unknown" as const,
        orgId: args.orgId,
      },
    );


    await ctx.runMutation((internal as any).policies.updateFiles, {
      id: policyId,
      files: [
        {
          fileId: primaryFileId,
          fileName: primaryFileName,
          fileType: "unknown",
          status: "extracting",
        },
      ],
      reconciliationStatus: "pending" as const,
    });

    await ctx.runMutation(internal.policyAuditLog.append, {
      policyId,
      userId: args.userId,
      orgId: args.orgId,
      action: "extraction_started",
    });

    await ctx.runAction(
      internal.actions.policyExtraction.startPolicyExtractionFromUpload,
      {
        policyId,
        fileId: primaryFileId,
        fileName: primaryFileName,
        orgId: args.orgId,
        userId: args.userId,
        policyFileId,
      },
    );

    return { success: true, policyId: String(policyId) };
  },
});
