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
import type { Id } from "../_generated/dataModel";

type BackfillRequirementSemanticsResult = {
  scannedCount: number;
  changedCount: number;
  dryRun: boolean;
  changes: Array<{
    requirementId: Id<"insuranceRequirements">;
    title: string;
    appliesTo: "vendors" | "own_org" | "both";
    previous: {
      evaluationTarget?: string;
      semanticReviewStatus?: string;
    };
    next: {
      evaluationTarget:
        | "own_policy"
        | "connected_vendor_policy"
        | "subcontractor_policy"
        | "manual_control"
        | "not_policy_checkable";
      evaluationReason?: string;
      semanticReviewStatus:
        | "system_classified"
        | "needs_review"
        | "user_confirmed";
    };
  }>;
};

export const backfill = internalAction({
  args: {
    orgId: v.optional(v.id("organizations")),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BackfillRequirementSemanticsResult> => {
    return (await ctx.runMutation(
      internal.compliance.backfillRequirementSemanticsInternal,
      args,
    )) as BackfillRequirementSemanticsResult;
  },
});
