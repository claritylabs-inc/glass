import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { toLobCodes } from "./lib/linesOfBusiness";

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
  continuationScheduled: boolean;
};

function emptyReport(dryRun: boolean): BackfillReport {
  return {
    dryRun,
    policies: {
      scannedCount: 0,
      changedCount: 0,
      unmappedValues: {},
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

export function policyLineBackfillDecision(policy: {
  policyTypes?: string[];
  linesOfBusiness?: string[];
}) {
  const existingLines = policy.linesOfBusiness?.filter((value) => typeof value === "string" && value.trim()) ?? [];
  const before = policy.policyTypes?.filter((value) => typeof value === "string" && value.trim()) ?? [];
  if (existingLines.length > 0) {
    return {
      before,
      after: toLobCodes(existingLines),
      unmappedValues: [],
      changed: false,
    };
  }
  const after = toLobCodes(before);
  return {
    before,
    after,
    unmappedValues: unmappedLegacyValues(before),
    changed: !sameStringArray(policy.linesOfBusiness, after),
  };
}

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
          .withIndex("organization", (q) => q.eq("orgId", args.orgId!))
          .paginate({ numItems: args.limit, cursor: args.cursor ?? null })
      : await ctx.db
          .query("policies")
          .paginate({ numItems: args.limit, cursor: args.cursor ?? null });

    report.policies.scannedCount = page.page.length;
    for (const policy of page.page) {
      const decision = policyLineBackfillDecision(
        policy as { linesOfBusiness?: string[]; policyTypes?: string[] },
      );
      for (const value of decision.unmappedValues) {
        report.policies.unmappedValues[value] = (report.policies.unmappedValues[value] ?? 0) + 1;
      }
      if (!decision.changed) continue;
      report.policies.changedCount += 1;
      if (report.policies.samples.length < 25) {
        report.policies.samples.push({
          policyId: policy._id,
          before: decision.before,
          after: decision.after,
        });
      }
      if (!dryRun) {
        await ctx.db.patch(policy._id, { linesOfBusiness: decision.after });
      }
    }

    if (!dryRun && !page.isDone) {
      await ctx.scheduler.runAfter(0, (internal as any).backfillLinesOfBusinessBatches.backfillPoliciesBatchInternal, {
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
