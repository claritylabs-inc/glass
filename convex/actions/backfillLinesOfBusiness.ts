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
import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { toLobCodes } from "../lib/linesOfBusiness";

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

function sameStringArray(left: readonly string[] | undefined, right: readonly string[]) {
  return Boolean(left) &&
    left!.length === right.length &&
    left!.every((value, index) => value === right[index]);
}

function unmappedLegacyValues(values: readonly string[]) {
  return values.filter((value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === "other" || normalized === "unknown" || normalized === "un") {
      return false;
    }
    const codes = toLobCodes([value]);
    return codes.length === 1 && codes[0] === "UN";
  });
}

function unique(values: readonly string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
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
        await ctx.runMutation((internal as any).actions.backfillLinesOfBusiness.backfillPoliciesBatchInternal, {
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
        await ctx.runMutation((internal as any).actions.backfillLinesOfBusiness.backfillDeliveryRulesBatchInternal, {
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

export const backfillPoliciesBatchInternal = internalMutation({
  args: {
    orgId: v.optional(v.id("organizations")),
    dryRun: v.boolean(),
    limit: v.number(),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<BackfillReport & { nextCursor: string | null; isDone: boolean }> => {
    const dryRun = args.dryRun;
    const report = emptyReport(dryRun);
    const page = args.orgId
      ? await ctx.db
          .query("policies")
          .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId!))
          .paginate({ numItems: args.limit, cursor: args.cursor ?? null })
      : await ctx.db
          .query("policies")
          .paginate({ numItems: args.limit, cursor: args.cursor ?? null });

    report.policies.scannedCount = page.page.length;
    for (const policy of page.page) {
      const before = policy.policyTypes ?? [];
      const after = toLobCodes(before);
      for (const value of unmappedLegacyValues(before)) {
        report.policies.unmappedValues[value] = (report.policies.unmappedValues[value] ?? 0) + 1;
      }
      if (sameStringArray(policy.linesOfBusiness, after)) continue;
      report.policies.changedCount += 1;
      if (report.policies.samples.length < 25) {
        report.policies.samples.push({ policyId: policy._id, before, after });
      }
      if (!dryRun) {
        await ctx.db.patch(policy._id, { linesOfBusiness: after });
      }
    }

    if (!dryRun && !page.isDone) {
      await ctx.scheduler.runAfter(0, (internal as any).actions.backfillLinesOfBusiness.backfillPoliciesBatchInternal, {
        orgId: args.orgId,
        dryRun,
        limit: args.limit,
        cursor: page.continueCursor,
      });
      report.continuationScheduled = true;
    }

    return {
      ...report,
      nextCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const backfillDeliveryRulesBatchInternal = internalMutation({
  args: {
    orgId: v.optional(v.id("organizations")),
    dryRun: v.boolean(),
    limit: v.number(),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<BackfillReport & { nextCursor: string | null; isDone: boolean }> => {
    const dryRun = args.dryRun;
    const report = emptyReport(dryRun);
    const page = await ctx.db
      .query("policyDeliveryRules")
      .paginate({ numItems: args.limit, cursor: args.cursor ?? null });

    const brokerIdsForOrg = new Set<string>();
    if (args.orgId) {
      const org = await ctx.db.get(args.orgId);
      const brokerOrgId = org && "brokerOrgId" in org ? org.brokerOrgId : undefined;
      if (brokerOrgId) brokerIdsForOrg.add(String(brokerOrgId));
      brokerIdsForOrg.add(String(args.orgId));
    }

    for (const rule of page.page) {
      if (args.orgId && !brokerIdsForOrg.has(String(rule.brokerOrgId)) && String(rule.clientOrgId) !== String(args.orgId)) {
        continue;
      }
      report.deliveryRules.scannedCount += 1;
      if (rule.filters.linesOfBusiness?.length) continue;
      const after = unique([
        ...(rule.filters.productLines ?? []),
        ...(rule.filters.policyTypes ?? []),
      ]);
      if (after.length === 0) continue;
      report.deliveryRules.changedCount += 1;
      if (report.deliveryRules.samples.length < 25) {
        report.deliveryRules.samples.push({
          ruleId: rule._id,
          before: {
            productLines: rule.filters.productLines,
            policyTypes: rule.filters.policyTypes,
          },
          after,
        });
      }
      if (!dryRun) {
        await ctx.db.patch(rule._id, {
          filters: {
            ...rule.filters,
            linesOfBusiness: after,
          },
        });
      }
    }

    if (!dryRun && !page.isDone) {
      await ctx.scheduler.runAfter(0, (internal as any).actions.backfillLinesOfBusiness.backfillDeliveryRulesBatchInternal, {
        orgId: args.orgId,
        dryRun,
        limit: args.limit,
        cursor: page.continueCursor,
      });
      report.continuationScheduled = true;
    }

    return {
      ...report,
      nextCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});
