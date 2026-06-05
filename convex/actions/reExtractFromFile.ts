"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * Re-extract a policy from a newly uploaded file (full restart with new PDF).
 * Updates the policy's fileId then delegates to cl-pipelines full restart.
 * Thin wrapper — all extraction logic lives in policyExtraction.ts.
 */
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

    const orgId = (policy as any).orgId as Id<"organizations"> | undefined;
    const userId = viewer._id as Id<"users">;

    await ctx.runMutation(internal.policyAuditLog.append, {
      policyId: args.policyId,
      userId,
      action: "pdf_uploaded",
    });

    // Update fileId on the policy to point at the new file
    await ctx.runMutation((internal as any).policies.updateExtractionInternal, {
      id: args.policyId,
      fields: { fileId: args.fileId },
    });

    // Start a full pipeline restart with the new file
    await ctx.runAction(internal.actions.policyExtraction.startPolicyExtractionFromUpload, {
      policyId: args.policyId,
      fileId: args.fileId,
      orgId: orgId!,
      userId,
      policyVersionKind: "re_extraction",
    });

    return { success: true };
  },
});
