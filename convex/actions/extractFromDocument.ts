"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * Extract intelligence from an org document (PDF, DOCX, XLSX, TXT, etc.).
 *
 * Converted to fire-and-forget via cl-pipelines. Returns immediately with
 * { orgDocumentId } so the caller can subscribe to the pipeline status via
 * the ExtractionBanner component.
 *
 * Callers should toast "Extraction started — safe to navigate away."
 */
export const extractFromDocument = action({
  args: {
    fileId: v.id("_storage"),
    fileName: v.optional(v.string()),
    documentId: v.optional(v.id("orgDocuments")),
  },
  returns: v.any(),
  handler: async (
    ctx,
    args,
  ): Promise<{ error: string } | { success: true; orgDocumentId: string }> => {
    const viewer = (await ctx.runQuery(api.users.viewer)) as { _id: string } | null;
    if (!viewer) return { error: "Not authenticated" };

    const orgData = (await ctx.runQuery(api.orgs.viewerOrg, {})) as
      | { membership: { orgId: string } }
      | null;
    if (!orgData) return { error: "No organization" };
    const orgId = orgData.membership.orgId as Id<"organizations">;
    const userId = viewer._id as Id<"users">;

    // If a documentId is provided, verify org ownership before touching it
    if (args.documentId) {
      const belongsToOrg = await ctx.runQuery(internal.orgDocuments.belongsToOrg, {
        id: args.documentId,
        orgId,
      });
      if (!belongsToOrg) return { error: "Invalid document reference" };
    }

    // Ensure we have a document row — create one if not provided
    let orgDocumentId: Id<"orgDocuments">;
    if (args.documentId) {
      orgDocumentId = args.documentId;
    } else {
      // Create a new orgDocuments row
      const existing = await ctx.runMutation(
        (internal as any).orgDocuments.findByStorageId,
        { storageId: args.fileId },
      ) as Id<"orgDocuments"> | null;

      if (existing) {
        orgDocumentId = existing;
      } else {
        orgDocumentId = await ctx.runMutation(
          api.orgDocuments.create,
          {
            storageId: args.fileId,
            fileName: args.fileName ?? "document",
          },
        ) as Id<"orgDocuments">;
      }
    }

    // Fire-and-forget: start the cl-pipelines extraction
    // The pipeline will update pipelineStatus on the orgDocuments row as it progresses.
    await ctx.runAction(internal.actions.orgDocumentExtraction.startOrgDocumentExtraction, {
      orgDocumentId,
      orgId,
      userId,
      storageId: args.fileId,
      fileName: args.fileName ?? "document",
    });

    return { success: true, orgDocumentId: String(orgDocumentId) };
  },
});
