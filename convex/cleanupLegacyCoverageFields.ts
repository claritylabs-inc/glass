import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation } from "./_generated/server";

const coverageKeys = new Set([
  "name",
  "endorsementNumber",
  "coverageCode",
  "formEditionDate",
  "limit",
  "limitAmount",
  "limitType",
  "limitValueType",
  "limits",
  "deductible",
  "deductibleAmount",
  "deductibleType",
  "deductibleValueType",
  "formNumber",
  "sir",
  "sublimit",
  "coinsurance",
  "valuation",
  "territory",
  "trigger",
  "retroactiveDate",
  "included",
  "coveragePremium",
  "premium",
  "pageNumber",
  "resolvedFromPage",
  "sectionRef",
  "originalContent",
  "resolvedOriginalContent",
  "recordId",
  "documentNodeId",
  "sourceSpanIds",
  "sourceTextHash",
  "extractionReviewStatus",
  "extractionReviewReason",
  "reviewSourceSpanIds",
]);

const coverageLimitKeys = new Set([
  "label",
  "value",
  "amount",
  "appliesTo",
  "kind",
  "sourceNodeIds",
  "sourceSpanIds",
]);

function stripUnknownKeys(value: unknown, allowedKeys: Set<string>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value, changed: false };
  }

  const next: Record<string, unknown> = {};
  let changed = false;
  for (const [key, field] of Object.entries(value)) {
    if (!allowedKeys.has(key)) {
      changed = true;
      continue;
    }
    next[key] = field;
  }
  return { value: next, changed };
}

function cleanCoverage(value: unknown) {
  const stripped = stripUnknownKeys(value, coverageKeys);
  if (!stripped.value || typeof stripped.value !== "object" || Array.isArray(stripped.value)) {
    return stripped;
  }

  const coverage = stripped.value as Record<string, unknown>;
  if (!Array.isArray(coverage.limits)) return stripped;

  let limitsChanged = false;
  const limits = coverage.limits.map((limit) => {
    const cleaned = stripUnknownKeys(limit, coverageLimitKeys);
    limitsChanged = limitsChanged || cleaned.changed;
    return cleaned.value;
  });

  return {
    value: { ...coverage, limits },
    changed: stripped.changed || limitsChanged,
  };
}

function cleanOperationalProfile(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value, changed: false };
  }

  const profile = value as Record<string, unknown>;
  if (!Array.isArray(profile.coverages)) return { value, changed: false };

  let changed = false;
  const coverages = profile.coverages.map((coverage) => {
    const cleaned = cleanCoverage(coverage);
    changed = changed || cleaned.changed;
    return cleaned.value;
  });

  return { value: { ...profile, coverages }, changed };
}

export const cleanupLegacyCoverageFields = mutation({
  args: {
    dryRun: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("policies").paginate(args.paginationOpts);
    let updated = 0;

    for (const policy of page.page) {
      const coverages = Array.isArray(policy.coverages)
        ? policy.coverages.map((coverage) => cleanCoverage(coverage))
        : [];
      const nextCoverages = coverages.map((coverage) => coverage.value);
      const coveragesChanged = coverages.some((coverage) => coverage.changed);
      const profile = cleanOperationalProfile(policy.operationalProfile);

      if (!coveragesChanged && !profile.changed) continue;
      updated += 1;
      if (args.dryRun) continue;

      await ctx.db.patch(policy._id, {
        ...(coveragesChanged ? { coverages: nextCoverages as typeof policy.coverages } : {}),
        ...(profile.changed ? { operationalProfile: profile.value } : {}),
      });
    }

    return {
      scanned: page.page.length,
      updated,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
