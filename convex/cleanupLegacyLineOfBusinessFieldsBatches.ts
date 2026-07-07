import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

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

type LegacyPolicyDocument = {
  policyTypes?: string[];
};

type LegacyPolicyDeliveryFilters = {
  productLines?: string[];
  policyTypes?: string[];
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

export const cleanupPoliciesBatchInternal = internalMutation({
  args: {
    orgId: v.optional(v.id("organizations")),
    dryRun: v.boolean(),
    limit: v.number(),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<CleanupReport & { nextCursor: string | null; isDone: boolean }> => {
    const report = emptyReport(args.dryRun);
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
      const policyTypes = (policy as LegacyPolicyDocument).policyTypes ?? [];
      if (policyTypes.length === 0) continue;
      report.policies.changedCount += 1;
      if (report.policies.samples.length < 25) {
        report.policies.samples.push({
          policyId: policy._id,
          removedPolicyTypes: policyTypes,
        });
      }
      if (!args.dryRun) {
        await ctx.db.patch(policy._id, { policyTypes: undefined } as any);
      }
    }

    if (!args.dryRun && !page.isDone) {
      await ctx.scheduler.runAfter(0, (internal as any).cleanupLegacyLineOfBusinessFieldsBatches.cleanupPoliciesBatchInternal, {
        orgId: args.orgId,
        dryRun: args.dryRun,
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

export const cleanupDeliveryRulesBatchInternal = internalMutation({
  args: {
    orgId: v.optional(v.id("organizations")),
    dryRun: v.boolean(),
    limit: v.number(),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<CleanupReport & { nextCursor: string | null; isDone: boolean }> => {
    const report = emptyReport(args.dryRun);
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
      const filters = rule.filters as typeof rule.filters & LegacyPolicyDeliveryFilters;
      const removed = {
        productLines: filters.productLines,
        policyTypes: filters.policyTypes,
      };
      if (!removed.productLines?.length && !removed.policyTypes?.length) continue;
      report.deliveryRules.changedCount += 1;
      if (report.deliveryRules.samples.length < 25) {
        report.deliveryRules.samples.push({ ruleId: rule._id, removed });
      }
      if (!args.dryRun) {
        const nextFilters = { ...filters };
        delete nextFilters.productLines;
        delete nextFilters.policyTypes;
        await ctx.db.patch(rule._id, { filters: nextFilters });
      }
    }

    if (!args.dryRun && !page.isDone) {
      await ctx.scheduler.runAfter(0, (internal as any).cleanupLegacyLineOfBusinessFieldsBatches.cleanupDeliveryRulesBatchInternal, {
        orgId: args.orgId,
        dryRun: args.dryRun,
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
