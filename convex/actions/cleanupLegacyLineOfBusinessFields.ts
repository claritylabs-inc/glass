"use node";

/**
 * One-time cleanup after every target environment has been backfilled and
 * deployed with required linesOfBusiness: remove legacy LOB fields.
 *
 * Dry run first:
 * npx convex run actions/cleanupLegacyLineOfBusinessFields:cleanup '{"dryRun":true}'
 */

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";

type CleanupReport = {
  dryRun: boolean;
  policies: {
    scannedCount: number;
    changedCount: number;
    samples: Array<{
      policyId: Id<"policies">;
      removedPolicyTypes: string[];
    }>;
  };
  deliveryRules: {
    scannedCount: number;
    changedCount: number;
    samples: Array<{
      ruleId: Id<"policyDeliveryRules">;
      removed: {
        productLines?: string[];
        policyTypes?: string[];
      };
    }>;
  };
  continuationScheduled: boolean;
};

function emptyReport(dryRun: boolean): CleanupReport {
  return {
    dryRun,
    policies: {
      scannedCount: 0,
      changedCount: 0,
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

function mergeReports(left: CleanupReport, right: CleanupReport): CleanupReport {
  return {
    dryRun: left.dryRun,
    policies: {
      scannedCount: left.policies.scannedCount + right.policies.scannedCount,
      changedCount: left.policies.changedCount + right.policies.changedCount,
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

export const cleanup = internalAction({
  args: {
    orgId: v.optional(v.id("organizations")),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CleanupReport> => {
    const dryRun = args.dryRun ?? false;
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 200);
    let report = emptyReport(dryRun);
    let policyCursor: string | null = null;
    let ruleCursor: string | null = null;

    do {
      const batch: CleanupReport & { nextCursor?: string | null; isDone?: boolean } =
        await ctx.runMutation((internal as any).cleanupLegacyLineOfBusinessFieldsBatches.cleanupPoliciesBatchInternal, {
          orgId: args.orgId,
          dryRun,
          limit,
          cursor: policyCursor,
        });
      report = mergeReports(report, batch);
      policyCursor = dryRun && !batch.isDone ? (batch.nextCursor ?? null) : null;
    } while (dryRun && policyCursor);

    do {
      const batch: CleanupReport & { nextCursor?: string | null; isDone?: boolean } =
        await ctx.runMutation((internal as any).cleanupLegacyLineOfBusinessFieldsBatches.cleanupDeliveryRulesBatchInternal, {
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
