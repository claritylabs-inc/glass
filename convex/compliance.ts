import { v } from "convex/values";
import dayjs from "dayjs";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getOrgAccess, requireAuth } from "./lib/access";
import { notify } from "./lib/notify";

const requirementCategoryValidator = v.union(
  v.literal("general_liability"),
  v.literal("auto"),
  v.literal("workers_comp"),
  v.literal("umbrella"),
  v.literal("professional"),
  v.literal("cyber"),
  v.literal("property"),
  v.literal("other"),
);

const complianceStatusValidator = v.union(
  v.literal("met"),
  v.literal("missing"),
  v.literal("expiring_soon"),
  v.literal("expired"),
  v.literal("needs_review"),
);

const requirementSourceTypeValidator = v.union(
  v.literal("manual"),
  v.literal("bulk_import"),
  v.literal("lease_agreement"),
  v.literal("client_contract"),
  v.literal("vendor_requirements"),
  v.literal("other"),
);

const sourceDocumentTypeValidator = v.union(
  v.literal("lease_agreement"),
  v.literal("client_contract"),
  v.literal("vendor_requirements"),
  v.literal("other"),
);

const vendorComplianceMonitorCheckValidator = v.object({
  requirementId: v.id("insuranceRequirements"),
  requirementTitle: v.string(),
  status: complianceStatusValidator,
  matchedPolicyIds: v.array(v.id("policies")),
  expiresAt: v.optional(v.string()),
  daysUntilExpiration: v.optional(v.number()),
  notes: v.optional(v.string()),
});

const vendorComplianceMonitorRowValidator = v.object({
  relationshipId: v.id("connectedOrgRelationships"),
  vendorOrgId: v.id("organizations"),
  vendorName: v.string(),
  status: v.string(),
  requirementCount: v.number(),
  policyCount: v.number(),
  missingCount: v.number(),
  expiringSoonCount: v.number(),
  checks: v.array(vendorComplianceMonitorCheckValidator),
});

function normalizeText(value: string | undefined | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseMoneyAmount(
  value: string | undefined | null,
): number | undefined {
  const text = value ?? "";
  const match = text.match(
    /(?:\$\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*(m|mm|million|k|thousand)?\b|([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*(m|mm|million|k|thousand)\b|([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?)\b)/i,
  );
  if (!match) return undefined;
  const baseText = match[1] ?? match[3] ?? match[5];
  const base = Number.parseFloat(baseText.replace(/,/g, ""));
  if (!Number.isFinite(base)) return undefined;
  const suffix = (match[2] ?? match[4])?.toLowerCase();
  if (suffix === "m" || suffix === "mm" || suffix === "million") {
    return Math.round(base * 1_000_000);
  }
  if (suffix === "k" || suffix === "thousand") {
    return Math.round(base * 1_000);
  }
  return Math.round(base);
}

function firstMoneyText(value: string | undefined | null): string | undefined {
  return value
    ?.match(
      /(?:\$\s*[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?\s*(?:m|mm|million|k|thousand)?\b|[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?\s*(?:m|mm|million|k|thousand)\b|[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?\b)/i,
    )?.[0]
    ?.trim();
}

function normalizeRequirementCoverage(args: {
  title: string;
  requirementText: string;
  name?: string;
  coverageCode?: string;
  limit?: string;
  limitAmount?: number;
  limitType?: string;
  limitValueType?: string;
  deductible?: string;
  deductibleAmount?: number;
  deductibleType?: string;
  deductibleValueType?: string;
  originalContent?: string;
}) {
  const limit =
    args.limit?.trim() ||
    firstMoneyText(`${args.title}\n${args.requirementText}`);
  return {
    name: args.name?.trim() || args.title,
    coverageCode: args.coverageCode?.trim() || undefined,
    limit,
    limitAmount:
      parseMoneyAmount(limit) ??
      args.limitAmount ??
      parseMoneyAmount(args.requirementText),
    limitType: args.limitType?.trim() || undefined,
    limitValueType: args.limitValueType?.trim() || undefined,
    deductible: args.deductible?.trim() || undefined,
    deductibleAmount:
      parseMoneyAmount(args.deductible) ?? args.deductibleAmount,
    deductibleType: args.deductibleType?.trim() || undefined,
    deductibleValueType: args.deductibleValueType?.trim() || undefined,
    originalContent: args.originalContent?.trim() || args.requirementText,
  };
}

function categoryTerms(
  category: Doc<"insuranceRequirements">["category"],
  title: string,
  requirementText: string,
) {
  const custom = normalizeText(`${title} ${requirementText}`)
    .split(/\s+/)
    .filter((term) => term.length >= 4);
  const builtIn: Record<string, string[]> = {
    general_liability: [
      "general liability",
      "commercial general liability",
      "cgl",
      "liability",
    ],
    auto: ["auto", "automobile", "business auto", "commercial auto", "vehicle"],
    workers_comp: [
      "workers compensation",
      "workers comp",
      "employers liability",
      "wc",
    ],
    umbrella: ["umbrella", "excess liability", "excess"],
    professional: ["professional liability", "errors omissions", "e o", "e&o"],
    cyber: ["cyber", "privacy", "network security"],
    property: ["property", "inland marine", "equipment"],
    other: custom.slice(0, 8),
  };
  return [...builtIn[category], ...custom.slice(0, 4)].filter(Boolean);
}

function policySearchText(policy: Doc<"policies">) {
  return normalizeText(
    [
      ...policy.policyTypes,
      policy.summary,
      policy.carrier,
      policy.security,
      policy.broker,
      policy.insuredName,
      ...(policy.coverages ?? []).map(
        (coverage) =>
          `${coverage.name} ${coverage.limit ?? ""} ${coverage.originalContent ?? ""}`,
      ),
    ]
      .flat()
      .filter(Boolean)
      .join(" "),
  );
}

function maxMatchingCoverageAmount(
  policy: Doc<"policies">,
  terms: string[],
): number | undefined {
  let maxAmount: number | undefined;
  for (const coverage of policy.coverages ?? []) {
    const coverageText = normalizeText(
      [
        coverage.name,
        coverage.coverageCode,
        coverage.limit,
        coverage.limitType,
        coverage.originalContent,
      ]
        .filter(Boolean)
        .join(" "),
    );
    const matches = terms.some((term) =>
      coverageText.includes(normalizeText(term)),
    );
    if (!matches && terms.length > 0) continue;
    const amount =
      coverage.limitAmount ??
      parseMoneyAmount(coverage.limit) ??
      parseMoneyAmount(coverage.originalContent);
    if (amount === undefined) continue;
    maxAmount = maxAmount === undefined ? amount : Math.max(maxAmount, amount);
  }
  return maxAmount;
}

function bestMatchingCoverage(
  policy: Doc<"policies">,
  terms: string[],
) {
  let best:
    | {
        name?: string;
        limit?: string;
        limitAmount?: number;
      }
    | undefined;
  for (const coverage of policy.coverages ?? []) {
    const coverageText = normalizeText(
      [
        coverage.name,
        coverage.coverageCode,
        coverage.limit,
        coverage.limitType,
        coverage.originalContent,
      ]
        .filter(Boolean)
        .join(" "),
    );
    const matches = terms.some((term) =>
      coverageText.includes(normalizeText(term)),
    );
    if (!matches && terms.length > 0) continue;
    const amount =
      coverage.limitAmount ??
      parseMoneyAmount(coverage.limit) ??
      parseMoneyAmount(coverage.originalContent);
    if (!best || (amount ?? 0) > (best.limitAmount ?? 0)) {
      best = {
        name: coverage.name,
        limit: coverage.limit,
        limitAmount: amount,
      };
    }
  }
  return best;
}

function parseDate(value: string | undefined) {
  if (!value) return Number.NaN;
  const time = dayjs(value).valueOf();
  return Number.isFinite(time) ? time : Number.NaN;
}

const INSURED_NAME_STOPWORDS = new Set([
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "company",
  "co",
  "the",
]);

function significantNameTokens(value: string | undefined | null) {
  return normalizeText(value)
    .split(/\s+/)
    .filter(
      (token) => token.length >= 3 && !INSURED_NAME_STOPWORDS.has(token),
    );
}

function insuredNameMatches(
  actual: string | undefined | null,
  expected: string | undefined | null,
) {
  const actualText = normalizeText(actual);
  const expectedText = normalizeText(expected);
  if (!expectedText) return true;
  if (!actualText) return false;
  if (actualText.includes(expectedText) || expectedText.includes(actualText)) {
    return true;
  }
  const expectedTokens = significantNameTokens(expected);
  if (expectedTokens.length === 0) return true;
  const actualTokens = new Set(significantNameTokens(actual));
  const matched = expectedTokens.filter((token) => actualTokens.has(token));
  return matched.length / expectedTokens.length >= 0.7;
}

function orgLegalNames(org: Doc<"organizations"> | null | undefined) {
  return [
    org?.name,
    ...(org?.relatedLegalEntities ?? []).map((entity) => entity.legalName),
  ].filter((name): name is string => Boolean(name?.trim()));
}

function insuredNameMatchesAny(
  actual: string | undefined | null,
  expectedNames: string[],
) {
  if (expectedNames.length === 0) return true;
  return expectedNames.some((expectedName) =>
    insuredNameMatches(actual, expectedName),
  );
}

function matchedPolicySummary(
  candidate:
    | {
        policy: Doc<"policies">;
        expiration: number;
        limitAmount?: number;
        coverage?: {
          name?: string;
          limit?: string;
          limitAmount?: number;
        };
      }
    | undefined,
  expectedInsuredName?: string,
) {
  if (!candidate) return undefined;
  return {
    _id: candidate.policy._id,
    carrier: candidate.policy.carrier,
    policyNumber: candidate.policy.policyNumber,
    insuredName: candidate.policy.insuredName,
    expectedInsuredName,
    expirationDate: candidate.policy.expirationDate,
    coverageName: candidate.coverage?.name,
    coverageLimit: candidate.coverage?.limit,
    detectedLimitAmount: candidate.limitAmount,
  };
}

function assessRequirement(
  requirement: Doc<"insuranceRequirements">,
  policies: Doc<"policies">[],
  now = dayjs().valueOf(),
  expectedInsuredName?: string,
  expectedInsuredNames?: string[],
) {
  const insuredNames = expectedInsuredNames?.length
    ? expectedInsuredNames
    : expectedInsuredName
      ? [expectedInsuredName]
      : [];
  const terms = categoryTerms(
    requirement.category,
    requirement.title,
    requirement.requirementText,
  );
  const candidates = policies
    .filter(
      (policy) =>
        !policy.deletedAt &&
        !policy.dismissed &&
        policy.documentType !== "quote",
    )
    .map((policy) => ({
      policy,
      text: policySearchText(policy),
      expiration: parseDate(policy.expirationDate),
      coverage: bestMatchingCoverage(policy, terms),
      limitAmount: maxMatchingCoverageAmount(policy, terms),
    }))
    .filter(({ policy, text }) => {
      if (requirement.category === "other") {
        return terms.some((term) => text.includes(term));
      }
      return (
        terms.some((term) => text.includes(normalizeText(term))) ||
        policy.policyTypes.some((policyType) => normalizeText(policyType).includes(
          requirement.category.replace("_", " "),
        ))
      );
    })
    .sort(
      (a, b) =>
        (Number.isFinite(b.expiration) ? b.expiration : 0) -
        (Number.isFinite(a.expiration) ? a.expiration : 0),
    );

  if (candidates.length === 0) {
    return {
      requirementId: requirement._id,
      status: "missing" as const,
      matchedPolicyIds: [] as Id<"policies">[],
      expiresAt: undefined,
      matchedPolicy: undefined,
      notes:
        "No active policy appears to match this requirement. Glass will re-check as vendors upload coverage.",
    };
  }

  const active = candidates.find(
    ({ expiration }) => Number.isFinite(expiration) && expiration >= now,
  );
  const best = active ?? candidates[0]!;
  const requiredLimitAmount = requirement.limitAmount;
  if (
    active &&
    requiredLimitAmount !== undefined &&
    best.limitAmount === undefined
  ) {
    return {
      requirementId: requirement._id,
      status: "missing" as const,
      matchedPolicyIds: [best.policy._id],
      matchedPolicy: matchedPolicySummary(best, expectedInsuredName),
      expiresAt: Number.isFinite(best.expiration)
        ? best.policy.expirationDate
        : undefined,
      daysUntilExpiration: Number.isFinite(best.expiration)
        ? Math.ceil((best.expiration - now) / (24 * 60 * 60 * 1000))
        : undefined,
      notes: `Matched ${best.policy.carrier} ${best.policy.policyNumber}, but Glass could not verify the required $${requiredLimitAmount.toLocaleString()} limit from structured coverage data.`,
    };
  }
  if (
    active &&
    requiredLimitAmount !== undefined &&
    best.limitAmount !== undefined &&
    best.limitAmount < requiredLimitAmount
  ) {
    return {
      requirementId: requirement._id,
      status: "missing" as const,
      matchedPolicyIds: [best.policy._id],
      matchedPolicy: matchedPolicySummary(best, expectedInsuredName),
      expiresAt: Number.isFinite(best.expiration)
        ? best.policy.expirationDate
        : undefined,
      daysUntilExpiration: Number.isFinite(best.expiration)
        ? Math.ceil((best.expiration - now) / (24 * 60 * 60 * 1000))
        : undefined,
      notes: `Matched ${best.policy.carrier} ${best.policy.policyNumber}, but the detected limit $${best.limitAmount.toLocaleString()} is below the required $${requiredLimitAmount.toLocaleString()}.`,
    };
  }
  if (
    active &&
    !insuredNameMatchesAny(best.policy.insuredName, insuredNames)
  ) {
    return {
      requirementId: requirement._id,
      status: "missing" as const,
      matchedPolicyIds: [best.policy._id],
      matchedPolicy: matchedPolicySummary(best, expectedInsuredName),
      expiresAt: Number.isFinite(best.expiration)
        ? best.policy.expirationDate
        : undefined,
      daysUntilExpiration: Number.isFinite(best.expiration)
        ? Math.ceil((best.expiration - now) / (24 * 60 * 60 * 1000))
        : undefined,
      notes: best.policy.insuredName
        ? `Matched ${best.policy.carrier} ${best.policy.policyNumber}, but the insured name is ${best.policy.insuredName}; expected one of ${insuredNames.join(", ")}.`
        : `Matched ${best.policy.carrier} ${best.policy.policyNumber}, but Glass could not verify the named insured as one of ${insuredNames.join(", ")}.`,
    };
  }
  const daysUntilExpiration = Number.isFinite(best.expiration)
    ? Math.ceil((best.expiration - now) / (24 * 60 * 60 * 1000))
    : undefined;
  const status = active
    ? daysUntilExpiration !== undefined && daysUntilExpiration <= 30
      ? ("expiring_soon" as const)
      : ("met" as const)
    : ("expired" as const);

  return {
    requirementId: requirement._id,
    status,
    matchedPolicyIds: [best.policy._id],
    matchedPolicy: matchedPolicySummary(best, expectedInsuredName),
    expiresAt: Number.isFinite(best.expiration)
      ? best.policy.expirationDate
      : undefined,
    daysUntilExpiration,
    notes:
      status === "met"
        ? `Matched ${best.policy.carrier} ${best.policy.policyNumber}.`
        : status === "expiring_soon"
          ? `Matched ${best.policy.carrier} ${best.policy.policyNumber}, but it expires in ${daysUntilExpiration} days.`
          : `Latest matching policy ${best.policy.carrier} ${best.policy.policyNumber} appears expired.`,
  };
}

function manualReviewForRequirement(requirement: Doc<"insuranceRequirements">) {
  const review = requirement.manualComplianceReview;
  if (!review || review.checkedAt < requirement.updatedAt) return undefined;
  return {
    requirementId: requirement._id,
    status: review.status,
    matchedPolicyIds: review.matchedPolicyIds,
    matchedPolicy: undefined,
    expiresAt: review.expiresAt,
    daysUntilExpiration: review.daysUntilExpiration,
    notes: review.notes
      ? `LLM compliance check: ${review.notes}`
      : "LLM compliance check completed.",
    checkedAt: review.checkedAt,
    checkedBy: "agent" as const,
  };
}

function assessRequirementWithManualReview(
  requirement: Doc<"insuranceRequirements">,
  policies: Doc<"policies">[],
  now = dayjs().valueOf(),
  expectedInsuredName?: string,
  expectedInsuredNames?: string[],
) {
  return (
    manualReviewForRequirement(requirement) ??
    assessRequirement(
      requirement,
      policies,
      now,
      expectedInsuredName,
      expectedInsuredNames,
    )
  );
}

async function requireOrgMember(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
) {
  const access = await getOrgAccess(ctx, orgId);
  if (access.accessType !== "member")
    throw new Error(
      "Only organization members can manage compliance requirements",
    );
  return access;
}

async function listRequirementsForOrg(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
) {
  return await ctx.db
    .query("insuranceRequirements")
    .withIndex("by_orgId_status", (q) =>
      q.eq("orgId", orgId).eq("status", "active"),
    )
    .collect();
}

function vendorScopedRequirements(
  requirements: Doc<"insuranceRequirements">[],
) {
  return requirements.filter(
    (requirement) =>
      requirement.appliesTo === "vendors" || requirement.appliesTo === "both",
  );
}

async function listClientRequirementsForVendor(
  ctx: QueryCtx,
  vendorOrgId: Id<"organizations">,
  vendorPolicies: Doc<"policies">[],
  vendorName?: string,
  vendorLegalNames?: string[],
) {
  const relationships = await ctx.db
    .query("connectedOrgRelationships")
    .withIndex("by_vendorOrgId_status", (q) =>
      q.eq("vendorOrgId", vendorOrgId).eq("status", "active"),
    )
    .collect();
  const rows = [];
  for (const rel of relationships) {
    const clientOrg = await ctx.db.get(rel.clientOrgId);
    const requirements = vendorScopedRequirements(
      await listRequirementsForOrg(ctx, rel.clientOrgId),
    );
    for (const requirement of requirements) {
      rows.push({
        ...requirement,
        appliesTo: "own_org" as const,
        complianceCheck: assessRequirement(
          requirement,
          vendorPolicies,
          dayjs().valueOf(),
          vendorName,
          vendorLegalNames,
        ),
        canArchive: false,
        clientRequirementSource: {
          relationshipId: rel._id,
          clientOrg: clientOrg
            ? {
                _id: clientOrg._id,
                name: clientOrg.name,
                website: clientOrg.website,
              }
            : null,
        },
      });
    }
  }
  return rows;
}

async function listRequirementsVisibleToOrg(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
) {
  const [ownRequirements, orgPolicies] = await Promise.all([
    ctx.db
      .query("insuranceRequirements")
      .withIndex("by_orgId_status", (q) =>
        q.eq("orgId", orgId).eq("status", "active"),
      )
      .order("desc")
      .collect(),
    ctx.db
      .query("policies")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect(),
  ]);
  const org = await ctx.db.get(orgId);
  const clientRequirements = await listClientRequirementsForVendor(
    ctx,
    orgId,
    orgPolicies,
    org?.name,
    orgLegalNames(org),
  );
  return [
    ...ownRequirements.map((requirement) => ({
      ...requirement,
      complianceCheck:
        requirement.appliesTo === "own_org" || requirement.appliesTo === "both"
          ? assessRequirementWithManualReview(
              requirement,
              orgPolicies,
              dayjs().valueOf(),
              org?.name,
              orgLegalNames(org),
            )
          : undefined,
      canArchive: true,
    })),
    ...clientRequirements,
  ].sort((a, b) => b.updatedAt - a.updatedAt);
}

export const listRequirements = query({
  args: { orgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    let orgId = args.orgId;
    if (!orgId) {
      const membership = await ctx.db
        .query("orgMemberships")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .first();
      if (!membership) throw new Error("Organization required");
      orgId = membership.orgId;
    }
    await requireOrgMember(ctx, orgId);
    return await listRequirementsVisibleToOrg(ctx, orgId);
  },
});

export const upsertRequirement = mutation({
  args: {
    orgId: v.id("organizations"),
    requirementId: v.optional(v.id("insuranceRequirements")),
    title: v.string(),
    category: requirementCategoryValidator,
    requirementText: v.string(),
    name: v.optional(v.string()),
    coverageCode: v.optional(v.string()),
    limit: v.optional(v.string()),
    limitAmount: v.optional(v.number()),
    limitType: v.optional(v.string()),
    limitValueType: v.optional(v.string()),
    deductible: v.optional(v.string()),
    deductibleAmount: v.optional(v.number()),
    deductibleType: v.optional(v.string()),
    deductibleValueType: v.optional(v.string()),
    originalContent: v.optional(v.string()),
    sourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    sourceDocumentName: v.optional(v.string()),
    sourceType: v.optional(requirementSourceTypeValidator),
    sourceExcerpt: v.optional(v.string()),
    sourcePageStart: v.optional(v.number()),
    sourcePageEnd: v.optional(v.number()),
    appliesTo: v.optional(
      v.union(v.literal("vendors"), v.literal("own_org"), v.literal("both")),
    ),
    minimumRequired: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const access = await requireOrgMember(ctx, args.orgId);
    if (access.role !== "admin")
      throw new Error("Admin role required to update compliance requirements");
    const now = dayjs().valueOf();
    const trimmedTitle = args.title.trim();
    const trimmedText = args.requirementText.trim();
    if (!trimmedTitle || !trimmedText)
      throw new Error("Title and requirement text are required");
    const coverage = normalizeRequirementCoverage({
      title: trimmedTitle,
      requirementText: trimmedText,
      name: args.name,
      coverageCode: args.coverageCode,
      limit: args.limit,
      limitAmount: args.limitAmount,
      limitType: args.limitType,
      limitValueType: args.limitValueType,
      deductible: args.deductible,
      deductibleAmount: args.deductibleAmount,
      deductibleType: args.deductibleType,
      deductibleValueType: args.deductibleValueType,
      originalContent: args.originalContent,
    });
    if (args.requirementId) {
      const existing = await ctx.db.get(args.requirementId);
      if (!existing || existing.orgId !== args.orgId)
        throw new Error("Requirement not found");
      await ctx.db.patch(args.requirementId, {
        title: trimmedTitle,
        category: args.category,
        requirementText: trimmedText,
        ...coverage,
        sourceDocumentId: args.sourceDocumentId ?? existing.sourceDocumentId,
        sourceDocumentName:
          args.sourceDocumentName?.trim() || existing.sourceDocumentName,
        sourceType: args.sourceType ?? existing.sourceType ?? "manual",
        sourceExcerpt: args.sourceExcerpt?.trim() || existing.sourceExcerpt,
        sourcePageStart: args.sourcePageStart ?? existing.sourcePageStart,
        sourcePageEnd: args.sourcePageEnd ?? existing.sourcePageEnd,
        appliesTo: args.appliesTo ?? existing.appliesTo ?? "vendors",
        minimumRequired:
          args.minimumRequired ?? existing.minimumRequired ?? true,
        updatedByUserId: access.userId,
        updatedAt: now,
      });
      return args.requirementId;
    }
    return await ctx.db.insert("insuranceRequirements", {
      orgId: args.orgId,
      title: trimmedTitle,
      category: args.category,
      requirementText: trimmedText,
      ...coverage,
      sourceDocumentId: args.sourceDocumentId,
      sourceDocumentName: args.sourceDocumentName?.trim() || undefined,
      sourceType: args.sourceType ?? "manual",
      sourceExcerpt: args.sourceExcerpt?.trim() || undefined,
      sourcePageStart: args.sourcePageStart,
      sourcePageEnd: args.sourcePageEnd,
      appliesTo: args.appliesTo ?? "vendors",
      minimumRequired: args.minimumRequired ?? true,
      status: "active",
      createdByUserId: access.userId,
      updatedByUserId: access.userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const archiveRequirement = mutation({
  args: {
    orgId: v.id("organizations"),
    requirementId: v.id("insuranceRequirements"),
  },
  handler: async (ctx, args) => {
    const access = await requireOrgMember(ctx, args.orgId);
    if (access.role !== "admin")
      throw new Error("Admin role required to archive compliance requirements");
    const existing = await ctx.db.get(args.requirementId);
    if (!existing || existing.orgId !== args.orgId)
      throw new Error("Requirement not found");
    await ctx.db.patch(args.requirementId, {
      status: "archived",
      updatedByUserId: access.userId,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const generateRequirementImportUploadUrl = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await requireOrgMember(ctx, args.orgId);
    if (access.role !== "admin")
      throw new Error("Admin role required to import compliance requirements");
    return await ctx.storage.generateUploadUrl();
  },
});

export const listVendorCompliance = query({
  args: { clientOrgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    let clientOrgId = args.clientOrgId;
    if (!clientOrgId) {
      const membership = await ctx.db
        .query("orgMemberships")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .first();
      if (!membership) throw new Error("Organization required");
      clientOrgId = membership.orgId;
    }
    await requireOrgMember(ctx, clientOrgId);
    const requirements = vendorScopedRequirements(
      await listRequirementsForOrg(ctx, clientOrgId),
    );
    const relationships = await ctx.db
      .query("connectedOrgRelationships")
      .withIndex("by_clientOrgId_status", (q) =>
        q.eq("clientOrgId", clientOrgId).eq("status", "active"),
      )
      .collect();
    const rows = [];
    for (const rel of relationships) {
      const vendorOrg = await ctx.db.get(rel.vendorOrgId);
      const policies = await ctx.db
        .query("policies")
        .withIndex("by_orgId", (q) => q.eq("orgId", rel.vendorOrgId))
        .collect();
      const policyCount = policies.filter(
        (policy) =>
          !policy.deletedAt &&
          !policy.dismissed &&
          policy.documentType !== "quote",
      ).length;
      const checks = requirements.map((requirement) => ({
        requirement,
        ...assessRequirement(
          requirement,
          policies,
          dayjs().valueOf(),
          vendorOrg?.name,
          orgLegalNames(vendorOrg),
        ),
      }));
      const missing = checks.filter(
        (check) => check.status === "missing" || check.status === "expired",
      ).length;
      const expiringSoon = checks.filter(
        (check) => check.status === "expiring_soon",
      ).length;
      rows.push({
        relationshipId: rel._id,
        vendorOrg: vendorOrg
          ? {
              _id: vendorOrg._id,
              name: vendorOrg.name,
              website: vendorOrg.website,
            }
          : null,
        status:
          missing > 0
            ? "non_compliant"
            : expiringSoon > 0
              ? "attention"
              : requirements.length === 0
                ? "no_requirements"
                : "compliant",
        requirementCount: requirements.length,
        policyCount,
        metCount: checks.filter((check) => check.status === "met").length,
        missingCount: missing,
        expiringSoonCount: expiringSoon,
        checks,
      });
    }
    return rows;
  },
});

export const getVendorChecklist = query({
  args: {
    vendorOrgId: v.optional(v.id("organizations")),
    clientOrgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    let vendorOrgId = args.vendorOrgId;
    if (!vendorOrgId) {
      const membership = await ctx.db
        .query("orgMemberships")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .first();
      if (!membership) throw new Error("Organization required");
      vendorOrgId = membership.orgId;
    }
    await requireOrgMember(ctx, vendorOrgId);
    const relationships = args.clientOrgId
      ? await ctx.db
          .query("connectedOrgRelationships")
          .withIndex("by_clientOrgId_vendorOrgId", (q) =>
            q
              .eq("clientOrgId", args.clientOrgId!)
              .eq("vendorOrgId", vendorOrgId),
          )
          .collect()
      : await ctx.db
          .query("connectedOrgRelationships")
          .withIndex("by_vendorOrgId_status", (q) =>
            q.eq("vendorOrgId", vendorOrgId).eq("status", "active"),
          )
          .collect();
    const policies = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (q) => q.eq("orgId", vendorOrgId))
      .collect();
    const vendorOrg = await ctx.db.get(vendorOrgId);
    const rows = [];
    for (const rel of relationships.filter(
      (relationship) => relationship.status === "active",
    )) {
      const clientOrg = await ctx.db.get(rel.clientOrgId);
      const requirements = vendorScopedRequirements(
        await listRequirementsForOrg(ctx, rel.clientOrgId),
      );
      const checks = requirements.map((requirement) => ({
        requirement,
        ...assessRequirement(
          requirement,
          policies,
          dayjs().valueOf(),
          vendorOrg?.name,
          orgLegalNames(vendorOrg),
        ),
      }));
      rows.push({
        clientOrg: clientOrg
          ? {
              _id: clientOrg._id,
              name: clientOrg.name,
              website: clientOrg.website,
            }
          : null,
        checks,
      });
    }
    return rows;
  },
});

export const listRequirementsInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) =>
    await listRequirementsVisibleToOrg(ctx, args.orgId),
});

export const getManualComplianceReviewContextInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    requirementId: v.id("insuranceRequirements"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", args.orgId).eq("userId", args.userId),
      )
      .first();
    if (!membership) throw new Error("Organization access required");

    const requirement = await ctx.db.get(args.requirementId);
    if (
      !requirement ||
      requirement.orgId !== args.orgId ||
      requirement.status !== "active"
    ) {
      throw new Error("Requirement not found");
    }
    if (
      requirement.appliesTo !== "own_org" &&
      requirement.appliesTo !== "both"
    ) {
      throw new Error("This requirement is not checked against your organization");
    }

    const [org, policies] = await Promise.all([
      ctx.db.get(args.orgId),
      ctx.db
        .query("policies")
        .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
        .collect(),
    ]);
    const activePolicies = policies.filter(
      (policy) =>
        !policy.deletedAt &&
        !policy.dismissed &&
        policy.documentType !== "quote",
    );

    return {
      org: org
        ? {
            _id: org._id,
            name: org.name,
            relatedLegalEntities: org.relatedLegalEntities ?? [],
          }
        : null,
      requirement: {
        _id: requirement._id,
        title: requirement.title,
        category: requirement.category,
        requirementText: requirement.requirementText,
        limit: requirement.limit,
        limitAmount: requirement.limitAmount,
        deductible: requirement.deductible,
        deductibleAmount: requirement.deductibleAmount,
        sourceExcerpt: requirement.sourceExcerpt,
      },
      deterministicCheck: assessRequirement(
        requirement,
        activePolicies,
        dayjs().valueOf(),
        org?.name,
        orgLegalNames(org),
      ),
      policies: activePolicies.map((policy) => ({
        _id: policy._id,
        carrier: policy.carrier,
        policyNumber: policy.policyNumber,
        insuredName: policy.insuredName,
        effectiveDate: policy.effectiveDate,
        expirationDate: policy.expirationDate,
        policyTypes: policy.policyTypes,
        summary: policy.summary,
        coverages: (policy.coverages ?? []).map((coverage) => ({
          name: coverage.name,
          coverageCode: coverage.coverageCode,
          limit: coverage.limit,
          limitAmount: coverage.limitAmount,
          limitType: coverage.limitType,
          deductible: coverage.deductible,
          deductibleAmount: coverage.deductibleAmount,
          deductibleType: coverage.deductibleType,
          formNumber: coverage.formNumber,
          pageNumber: coverage.pageNumber,
          sectionRef: coverage.sectionRef,
          originalContent: coverage.originalContent,
        })),
      })),
    };
  },
});

export const saveManualComplianceReviewInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    requirementId: v.id("insuranceRequirements"),
    userId: v.id("users"),
    status: complianceStatusValidator,
    matchedPolicyIds: v.array(v.id("policies")),
    expiresAt: v.optional(v.string()),
    daysUntilExpiration: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", args.orgId).eq("userId", args.userId),
      )
      .first();
    if (!membership) throw new Error("Organization access required");
    const requirement = await ctx.db.get(args.requirementId);
    if (!requirement || requirement.orgId !== args.orgId) {
      throw new Error("Requirement not found");
    }
    await ctx.db.patch(args.requirementId, {
      manualComplianceReview: {
        status: args.status,
        matchedPolicyIds: args.matchedPolicyIds,
        expiresAt: args.expiresAt,
        daysUntilExpiration: args.daysUntilExpiration,
        notes: args.notes?.trim() || undefined,
        checkedAt: dayjs().valueOf(),
        checkedByUserId: args.userId,
      },
    });
  },
});

export const upsertRequirementInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    title: v.string(),
    category: requirementCategoryValidator,
    requirementText: v.string(),
    name: v.optional(v.string()),
    coverageCode: v.optional(v.string()),
    limit: v.optional(v.string()),
    limitAmount: v.optional(v.number()),
    limitType: v.optional(v.string()),
    limitValueType: v.optional(v.string()),
    deductible: v.optional(v.string()),
    deductibleAmount: v.optional(v.number()),
    deductibleType: v.optional(v.string()),
    deductibleValueType: v.optional(v.string()),
    originalContent: v.optional(v.string()),
    sourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    sourceDocumentName: v.optional(v.string()),
    sourceType: v.optional(requirementSourceTypeValidator),
    sourceExcerpt: v.optional(v.string()),
    sourcePageStart: v.optional(v.number()),
    sourcePageEnd: v.optional(v.number()),
    appliesTo: v.optional(
      v.union(v.literal("vendors"), v.literal("own_org"), v.literal("both")),
    ),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", args.orgId).eq("userId", args.userId),
      )
      .first();
    if (membership?.role !== "admin") throw new Error("Admin role required");
    const now = dayjs().valueOf();
    return await ctx.db.insert("insuranceRequirements", {
      orgId: args.orgId,
      title: args.title.trim(),
      category: args.category,
      requirementText: args.requirementText.trim(),
      ...normalizeRequirementCoverage({
        title: args.title.trim(),
        requirementText: args.requirementText.trim(),
        name: args.name,
        coverageCode: args.coverageCode,
        limit: args.limit,
        limitAmount: args.limitAmount,
        limitType: args.limitType,
        limitValueType: args.limitValueType,
        deductible: args.deductible,
        deductibleAmount: args.deductibleAmount,
        deductibleType: args.deductibleType,
        deductibleValueType: args.deductibleValueType,
        originalContent: args.originalContent,
      }),
      sourceDocumentId: args.sourceDocumentId,
      sourceDocumentName: args.sourceDocumentName?.trim() || undefined,
      sourceType: args.sourceType ?? "manual",
      sourceExcerpt: args.sourceExcerpt?.trim() || undefined,
      sourcePageStart: args.sourcePageStart,
      sourcePageEnd: args.sourcePageEnd,
      appliesTo: args.appliesTo ?? "vendors",
      minimumRequired: true,
      status: "active",
      createdByUserId: args.userId,
      updatedByUserId: args.userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getRequirementImportContextInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await requireOrgMember(ctx, args.orgId);
    if (access.role !== "admin")
      throw new Error("Admin role required to import compliance requirements");
    const existing = await listRequirementsForOrg(ctx, args.orgId);
    return {
      userId: access.userId,
      existingRequirements: existing.map((requirement) => ({
        title: requirement.title,
        category: requirement.category,
        requirementText: requirement.requirementText,
        name: requirement.name,
        coverageCode: requirement.coverageCode,
        limit: requirement.limit,
        limitAmount: requirement.limitAmount,
        limitType: requirement.limitType,
        limitValueType: requirement.limitValueType,
        deductible: requirement.deductible,
        deductibleAmount: requirement.deductibleAmount,
        deductibleType: requirement.deductibleType,
        deductibleValueType: requirement.deductibleValueType,
        originalContent: requirement.originalContent,
      })),
    };
  },
});

export const getRequirementImportContextForUserInternal = internalQuery({
  args: { orgId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", args.orgId).eq("userId", args.userId),
      )
      .first();
    if (membership?.role !== "admin")
      throw new Error("Admin role required to import compliance requirements");
    const existing = await listRequirementsForOrg(ctx, args.orgId);
    return {
      userId: args.userId,
      existingRequirements: existing.map((requirement) => ({
        title: requirement.title,
        category: requirement.category,
        requirementText: requirement.requirementText,
        name: requirement.name,
        coverageCode: requirement.coverageCode,
        limit: requirement.limit,
        limitAmount: requirement.limitAmount,
        limitType: requirement.limitType,
        limitValueType: requirement.limitValueType,
        deductible: requirement.deductible,
        deductibleAmount: requirement.deductibleAmount,
        deductibleType: requirement.deductibleType,
        deductibleValueType: requirement.deductibleValueType,
        originalContent: requirement.originalContent,
      })),
    };
  },
});

export const createRequirementSourceDocumentInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    sourceType: sourceDocumentTypeValidator,
    title: v.string(),
    sourceTextExcerpt: v.optional(v.string()),
    parserBackend: v.optional(
      v.union(
        v.literal("docling"),
        v.literal("pdfjs"),
        v.literal("mammoth"),
        v.literal("plain_text"),
      ),
    ),
    parserVersion: v.optional(v.string()),
    parsedAt: v.optional(v.number()),
    parsingMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", args.orgId).eq("userId", args.userId),
      )
      .first();
    if (membership?.role !== "admin") throw new Error("Admin role required");
    const now = dayjs().valueOf();
    return await ctx.db.insert("requirementSourceDocuments", {
      orgId: args.orgId,
      fileId: args.fileId,
      fileName: args.fileName,
      contentType: args.contentType,
      sourceType: args.sourceType,
      title: args.title.trim() || args.fileName || "Requirement source",
      sourceTextExcerpt: args.sourceTextExcerpt?.trim() || undefined,
      parserBackend: args.parserBackend,
      parserVersion: args.parserVersion,
      parsedAt: args.parsedAt,
      parsingMs: args.parsingMs,
      status: "complete",
      createdByUserId: args.userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const createRequirementsInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    appliesTo: v.optional(
      v.union(v.literal("vendors"), v.literal("own_org"), v.literal("both")),
    ),
    sourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    sourceDocumentName: v.optional(v.string()),
    sourceType: v.optional(requirementSourceTypeValidator),
    requirements: v.array(
      v.object({
        title: v.string(),
        category: requirementCategoryValidator,
        requirementText: v.string(),
        name: v.optional(v.string()),
        coverageCode: v.optional(v.string()),
        limit: v.optional(v.string()),
        limitAmount: v.optional(v.number()),
        limitType: v.optional(v.string()),
        limitValueType: v.optional(v.string()),
        deductible: v.optional(v.string()),
        deductibleAmount: v.optional(v.number()),
        deductibleType: v.optional(v.string()),
        deductibleValueType: v.optional(v.string()),
        originalContent: v.optional(v.string()),
        sourceExcerpt: v.optional(v.string()),
        sourcePageStart: v.optional(v.number()),
        sourcePageEnd: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", args.orgId).eq("userId", args.userId),
      )
      .first();
    if (membership?.role !== "admin") throw new Error("Admin role required");
    const existing = await listRequirementsForOrg(ctx, args.orgId);
    const seen = new Set(
      existing.map((requirement) =>
        normalizeText(`${requirement.title} ${requirement.requirementText}`),
      ),
    );
    const now = dayjs().valueOf();
    const ids: Id<"insuranceRequirements">[] = [];
    for (const requirement of args.requirements) {
      const title = requirement.title.trim();
      const requirementText = requirement.requirementText.trim();
      if (!title || !requirementText) continue;
      const key = normalizeText(`${title} ${requirementText}`);
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push(
        await ctx.db.insert("insuranceRequirements", {
          orgId: args.orgId,
          title,
          category: requirement.category,
          requirementText,
          ...normalizeRequirementCoverage({
            title,
            requirementText,
            name: requirement.name,
            coverageCode: requirement.coverageCode,
            limit: requirement.limit,
            limitAmount: requirement.limitAmount,
            limitType: requirement.limitType,
            limitValueType: requirement.limitValueType,
            deductible: requirement.deductible,
            deductibleAmount: requirement.deductibleAmount,
            deductibleType: requirement.deductibleType,
            deductibleValueType: requirement.deductibleValueType,
            originalContent: requirement.originalContent,
          }),
          sourceDocumentId: args.sourceDocumentId,
          sourceDocumentName: args.sourceDocumentName?.trim() || undefined,
          sourceType: args.sourceType ?? "bulk_import",
          sourceExcerpt:
            requirement.sourceExcerpt?.trim() ||
            requirement.originalContent?.trim() ||
            requirementText,
          sourcePageStart: requirement.sourcePageStart,
          sourcePageEnd: requirement.sourcePageEnd,
          appliesTo: args.appliesTo ?? "vendors",
          minimumRequired: true,
          status: "active",
          createdByUserId: args.userId,
          updatedByUserId: args.userId,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    return ids;
  },
});

export const listVendorComplianceInternal = internalQuery({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const requirements = vendorScopedRequirements(
      await listRequirementsForOrg(ctx, args.clientOrgId),
    );
    const relationships = await ctx.db
      .query("connectedOrgRelationships")
      .withIndex("by_clientOrgId_status", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("status", "active"),
      )
      .collect();
    const rows = [];
    for (const rel of relationships) {
      const vendorOrg = await ctx.db.get(rel.vendorOrgId);
      const policies = await ctx.db
        .query("policies")
        .withIndex("by_orgId", (q) => q.eq("orgId", rel.vendorOrgId))
        .collect();
      const policyCount = policies.filter(
        (policy) =>
          !policy.deletedAt &&
          !policy.dismissed &&
          policy.documentType !== "quote",
      ).length;
      const checks = requirements.map((requirement) => ({
        requirement,
        ...assessRequirement(
          requirement,
          policies,
          dayjs().valueOf(),
          vendorOrg?.name,
          orgLegalNames(vendorOrg),
        ),
      }));
      const missing = checks.filter(
        (check) => check.status === "missing" || check.status === "expired",
      ).length;
      const expiringSoon = checks.filter(
        (check) => check.status === "expiring_soon",
      ).length;
      rows.push({
        relationshipId: rel._id,
        vendorOrg: vendorOrg
          ? {
              _id: vendorOrg._id,
              name: vendorOrg.name,
              website: vendorOrg.website,
            }
          : null,
        status:
          missing > 0
            ? "non_compliant"
            : expiringSoon > 0
              ? "attention"
              : requirements.length === 0
                ? "no_requirements"
                : "compliant",
        requirementCount: requirements.length,
        policyCount,
        metCount: checks.filter((check) => check.status === "met").length,
        missingCount: missing,
        expiringSoonCount: expiringSoon,
        checks,
      });
    }
    return rows;
  },
});

export const listClientOrgIdsWithActiveVendorsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const relationships = await ctx.db
      .query("connectedOrgRelationships")
      .collect();
    return [
      ...new Set(
        relationships
          .filter((relationship) => relationship.status === "active")
          .map((relationship) => relationship.clientOrgId),
      ),
    ];
  },
});

export const getConnectedVendorContactInternal = internalQuery({
  args: {
    clientOrgId: v.id("organizations"),
    vendorOrgId: v.id("organizations"),
    relationshipId: v.id("connectedOrgRelationships"),
  },
  handler: async (ctx, args) => {
    const invitations = await ctx.db
      .query("connectedOrgInvitations")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", args.clientOrgId))
      .collect();
    const invitation = invitations
      .filter(
        (invitation) =>
          invitation.relationshipId === args.relationshipId ||
          invitation.vendorOrgId === args.vendorOrgId,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];

    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.vendorOrgId))
      .collect();
    const vendorUsers = (
      await Promise.all(
        memberships.map((membership) => ctx.db.get(membership.userId)),
      )
    ).filter(Boolean);

    return {
      vendorEmail: invitation?.vendorEmail ?? vendorUsers.find((user) => user?.email)?.email,
      vendorUserEmails: vendorUsers
        .map((user) => user?.email)
        .filter((email): email is string => Boolean(email)),
    };
  },
});

export const recordVendorComplianceRunInternal = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    rows: v.array(vendorComplianceMonitorRowValidator),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.nowMs ?? dayjs().valueOf();
    const reminderWindowMs = 7 * 24 * 60 * 60 * 1000;
    const clientOrg = await ctx.db.get(args.clientOrgId);
    const events: Array<{
      type:
        | "vendor_compliance_met"
        | "vendor_compliance_gap"
        | "vendor_policy_expiring"
        | "vendor_policy_expired";
      title: string;
      body: string;
      severity: "info" | "warning" | "critical";
      clientOrgId: Id<"organizations">;
      clientName: string;
      vendorOrgId: Id<"organizations">;
      vendorName: string;
      relationshipId: Id<"connectedOrgRelationships">;
      issueLines: string[];
    }> = [];

    for (const row of args.rows) {
      const previousSnapshots = await ctx.db
        .query("vendorComplianceChecks")
        .withIndex("by_relationshipId", (q) =>
          q.eq("relationshipId", row.relationshipId),
        )
        .collect();
      const latestByRequirement = new Map<
        Id<"insuranceRequirements">,
        Doc<"vendorComplianceChecks">
      >();
      for (const snapshot of previousSnapshots) {
        const current = latestByRequirement.get(snapshot.requirementId);
        if (!current || snapshot.checkedAt > current.checkedAt) {
          latestByRequirement.set(snapshot.requirementId, snapshot);
        }
      }

      const issueChecks = row.checks.filter(
        (check) => check.status !== "met",
      );
      const alertableIssueChecks = issueChecks.filter((check) => {
        const latest = latestByRequirement.get(check.requirementId);
        return (
          !latest ||
          latest.status !== check.status ||
          now - latest.checkedAt >= reminderWindowMs
        );
      });
      const previousHadIssue = [...latestByRequirement.values()].some(
        (snapshot) => snapshot.status !== "met",
      );
      const currentIsCompliant =
        row.requirementCount > 0 &&
        row.checks.length > 0 &&
        row.checks.every((check) => check.status === "met");

      for (const check of row.checks) {
        await ctx.db.insert("vendorComplianceChecks", {
          clientOrgId: args.clientOrgId,
          vendorOrgId: row.vendorOrgId,
          relationshipId: row.relationshipId,
          requirementId: check.requirementId,
          status: check.status,
          matchedPolicyIds: check.matchedPolicyIds,
          expiresAt: check.expiresAt,
          checkedAt: now,
          checkedBy: "system",
          notes: check.notes,
        });
      }

      if (currentIsCompliant && previousHadIssue) {
        events.push({
          type: "vendor_compliance_met",
          title: `${row.vendorName} is now vendor compliant`,
          body: `${row.vendorName} now meets all ${row.requirementCount} vendor requirements for ${clientOrg?.name ?? "your organization"}.`,
          severity: "info",
          clientOrgId: args.clientOrgId,
          clientName: clientOrg?.name ?? "your organization",
          vendorOrgId: row.vendorOrgId,
          vendorName: row.vendorName,
          relationshipId: row.relationshipId,
          issueLines: [],
        });
        continue;
      }

      if (alertableIssueChecks.length === 0) continue;

      const hasExpired = alertableIssueChecks.some(
        (check) => check.status === "expired",
      );
      const hasGap = alertableIssueChecks.some(
        (check) => check.status === "missing" || check.status === "needs_review",
      );
      const type = hasExpired
        ? "vendor_policy_expired"
        : hasGap
          ? "vendor_compliance_gap"
          : "vendor_policy_expiring";
      const severity = hasExpired ? "critical" : "warning";
      const issueLines = alertableIssueChecks.map((check) => {
        const status =
          check.status === "expiring_soon" && check.daysUntilExpiration !== undefined
            ? `expires in ${check.daysUntilExpiration} days`
            : check.status.replace(/_/g, " ");
        return `${check.requirementTitle}: ${status}${check.notes ? ` - ${check.notes}` : ""}`;
      });
      const issueCount = alertableIssueChecks.length;
      const noun = issueCount === 1 ? "requirement needs" : "requirements need";
      const title =
        row.policyCount === 0
          ? `${row.vendorName} is waiting on policies`
          : type === "vendor_policy_expired"
            ? `${row.vendorName} has expired vendor coverage`
            : type === "vendor_policy_expiring"
              ? `${row.vendorName} has vendor coverage expiring soon`
              : `${row.vendorName} is missing vendor requirements`;
      const body = `${issueCount} vendor ${noun} attention for ${row.vendorName}: ${issueLines
        .slice(0, 3)
        .join("; ")}${issueLines.length > 3 ? `; +${issueLines.length - 3} more` : ""}`;

      events.push({
        type,
        title,
        body,
        severity,
        clientOrgId: args.clientOrgId,
        clientName: clientOrg?.name ?? "your organization",
        vendorOrgId: row.vendorOrgId,
        vendorName: row.vendorName,
        relationshipId: row.relationshipId,
        issueLines,
      });
    }

    return events;
  },
});

export const notifyVendorComplianceEventInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    vendorOrgId: v.id("organizations"),
    relationshipId: v.id("connectedOrgRelationships"),
    type: v.union(
      v.literal("vendor_compliance_met"),
      v.literal("vendor_compliance_gap"),
      v.literal("vendor_policy_expiring"),
      v.literal("vendor_policy_expired"),
    ),
    title: v.string(),
    body: v.string(),
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("critical"),
    ),
    actionType: v.string(),
    actionPayload: v.any(),
    sourceRef: v.optional(v.any()),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await notify(ctx, {
      orgId: args.orgId,
      type: args.type,
      title: args.title,
      body: args.body,
      severity: args.severity,
      relatedOrgId: args.vendorOrgId,
      actionType: args.actionType,
      actionPayload: args.actionPayload,
      sourceRef: args.sourceRef,
      coalesceKeyParts: [
        args.type,
        String(args.orgId),
        String(args.relationshipId),
      ],
      nowMs: args.nowMs,
    });
  },
});
