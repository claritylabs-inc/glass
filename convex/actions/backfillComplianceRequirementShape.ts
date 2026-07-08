"use node";

/**
 * One-time migration for the compliance requirements redesign.
 *
 * Dry run:
 * npx convex run actions/backfillComplianceRequirementShape:backfill --deployment staging --args '{"dryRun":true}'
 *
 * Live run:
 * npx convex run actions/backfillComplianceRequirementShape:backfill --deployment staging --args '{"dryRun":false}'
 */

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

type BackfillComplianceRequirementShapeReport = {
  dryRun: boolean;
  scannedCount: number;
  changedCount: number;
  remainingCount: number;
  samples: Array<{
    requirementId: Id<"insuranceRequirements">;
    title: string;
    previous: {
      category?: string;
      appliesTo?: string;
      evaluationTarget?: string;
      limit?: string;
      limitAmount?: number;
    };
    next: {
      kind: string;
      scope: string;
      lineOfBusiness?: string;
      limits?: Array<{ kind: string; amount: number; label?: string }>;
      conditionType?: string;
      minAmBestRating?: string;
    };
  }>;
};

export const backfill = internalAction({
  args: {
    orgId: v.optional(v.id("organizations")),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BackfillComplianceRequirementShapeReport> =>
    await ctx.runMutation(
      (internal as any).compliance.backfillComplianceRequirementShapeInternal,
      args,
    ),
});
