"use node";

/**
 * One-time migration: classify legacy insurance requirements with evidence-target semantics.
 *
 * Run dry in dev first:
 * npx convex run actions/backfillRequirementSemantics:backfill --args '{"orgId":"...","dryRun":true}'
 *
 * Then run without dryRun for the target deployment after inspecting the sample.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

export const backfill = internalAction({
  args: {
    orgId: v.optional(v.id("organizations")),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(
      internal.compliance.backfillRequirementSemanticsInternal,
      args,
    );
  },
});
