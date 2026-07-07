"use node";

/**
 * One-time migration: populate ACORD line-of-business fields from legacy policy
 * type fields.
 *
 * Dry run first:
 * npx convex run actions/backfillLinesOfBusiness:backfill --args '{"dryRun":true}'
 *
 * Review unmappedValues, then run without dryRun in the target deployment.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

type BackfillReport = {
  dryRun: boolean;
  policies: {
    scannedCount: number;
    changedCount: number;
    unmappedValues: Record<string, number>;
    samples: Array<{
      policyId: Id<"policies">;
      before: string[];
      after: string[];
    }>;
  };
  deliveryRules: {
    scannedCount: number;
    changedCount: number;
    samples: Array<{
      ruleId: Id<"policyDeliveryRules">;
      before: {
        productLines?: string[];
        policyTypes?: string[];
      };
      after: string[];
    }>;
  };
  continuationScheduled: boolean;
};

function mergeReports(left: BackfillReport, right: BackfillReport): BackfillReport {
  const unmappedValues = { ...left.policies.unmappedValues };
  for (const [value, count] of Object.entries(right.policies.unmappedValues)) {
    unmappedValues[value] = (unmappedValues[value] ?? 0) + count;
  }
  return {
    dryRun: left.dryRun,
    policies: {
      scannedCount: left.policies.scannedCount + right.policies.scannedCount,
      changedCount: left.policies.changedCount + right.policies.changedCount,
      unmappedValues,
      samples: [...left.policies.samples, ...right.policies.samples].slice(0, 25),
    },
    deliveryRules: {
      scannedCount: left.deliveryRules.scannedCount + right.deliveryRules.scannedCount,
      changedCount: left.deliveryRules.changedCount + right.deliveryRules.changedCount,
      samples: [...left.deliveryRules.samples, ...right.deliveryRules.samples].slice(0, 25),
    },
    continuationScheduled: left.continuationScheduled || right.continuationScheduled,
  };
}

function emptyReport(dryRun: boolean): BackfillReport {
  return {
    dryRun,
    policies: {
      scannedCount: 0,
      changedCount: 0,
      unmappedValues: {},
      samples: [],
    },
    deliveryRules: {
      scannedCount: 0,
      changedCount: 0,
      samples: [],
    },
    continuationScheduled: false,
  };
}

export const backfill = internalAction({
  args: {
    orgId: v.optional(v.id("organizations")),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BackfillReport> => {
    const dryRun = args.dryRun ?? false;
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 200);
    let report = emptyReport(dryRun);
    let policyCursor: string | null = null;
    let ruleCursor: string | null = null;

    do {
      const batch: BackfillReport & { nextCursor?: string | null; isDone?: boolean } =
        await ctx.runMutation((internal as any).backfillLinesOfBusinessBatches.backfillPoliciesBatchInternal, {
          orgId: args.orgId,
          dryRun,
          limit,
          cursor: policyCursor,
        });
      report = mergeReports(report, batch);
      policyCursor = dryRun && !batch.isDone ? (batch.nextCursor ?? null) : null;
    } while (dryRun && policyCursor);

    do {
      const batch: BackfillReport & { nextCursor?: string | null; isDone?: boolean } =
        await ctx.runMutation((internal as any).backfillLinesOfBusinessBatches.backfillDeliveryRulesBatchInternal, {
          orgId: args.orgId,
          dryRun,
          limit,
          cursor: ruleCursor,
        });
      report = mergeReports(report, batch);
      ruleCursor = dryRun && !batch.isDone ? (batch.nextCursor ?? null) : null;
    } while (dryRun && ruleCursor);

    return report;
  },
});
