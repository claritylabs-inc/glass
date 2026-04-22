"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";

/**
 * Retry policy extraction via cl-pipelines.
 * Thin wrapper — all logic lives in policyExtraction.ts.
 */
export const retryExtraction = action({
  args: {
    policyId: v.id("policies"),
    mode: v.optional(v.union(v.literal("resume"), v.literal("full"))),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<{ error: string } | { success: boolean }> => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) return { error: "Not authenticated" };

    const policy = await ctx.runQuery(api.policies.get, { id: args.policyId });
    if (!policy) return { error: "Policy not found" };

    const mode = args.mode ?? "resume";

    await ctx.runMutation(internal.policyAuditLog.append, {
      policyId: args.policyId,
      userId: viewer._id,
      action: "re_extraction",
      detail: `Mode: ${mode}`,
    });

    await ctx.runAction(internal.actions.policyExtraction.retryPolicyExtraction, {
      policyId: args.policyId,
      mode,
    });

    return { success: true };
  },
});

/**
 * Retry quote extraction via cl-pipelines.
 * Quotes are stored as policies with documentType="quote".
 * Thin wrapper — all logic lives in policyExtraction.ts.
 */
export const retryQuoteExtraction = action({
  args: {
    quoteId: v.id("policies"),
    mode: v.optional(v.union(v.literal("resume"), v.literal("full"))),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<{ error: string } | { success: boolean; resumed?: boolean }> => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) return { error: "Not authenticated" };

    const quote = await ctx.runQuery(api.policies.get, { id: args.quoteId });
    if (!quote) return { error: "Quote not found" };

    const mode = args.mode ?? "resume";

    await ctx.runMutation(internal.policyAuditLog.append, {
      policyId: args.quoteId,
      userId: viewer._id,
      action: "re_extraction",
      detail: `Mode: ${mode}`,
    });

    await ctx.runAction(internal.actions.policyExtraction.retryPolicyExtraction, {
      policyId: args.quoteId,
      mode,
    });

    return { success: true };
  },
});
