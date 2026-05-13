import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getOrgAccess, requireAuth } from "./lib/access";

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
      policy.policyType,
      ...(policy.policyTypes ?? []),
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

function parseDate(value: string | undefined) {
  if (!value) return Number.NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.NaN;
}

function assessRequirement(
  requirement: Doc<"insuranceRequirements">,
  policies: Doc<"policies">[],
  now = Date.now(),
) {
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
      limitAmount: maxMatchingCoverageAmount(policy, terms),
    }))
    .filter(({ policy, text }) => {
      if (requirement.category === "other") {
        return terms.some((term) => text.includes(term));
      }
      return (
        terms.some((term) => text.includes(normalizeText(term))) ||
        normalizeText(policy.policyType).includes(
          requirement.category.replace("_", " "),
        )
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
      expiresAt: Number.isFinite(best.expiration)
        ? best.policy.expirationDate
        : undefined,
      daysUntilExpiration: Number.isFinite(best.expiration)
        ? Math.ceil((best.expiration - now) / (24 * 60 * 60 * 1000))
        : undefined,
      notes: `Matched ${best.policy.carrier} ${best.policy.policyNumber}, but the detected limit $${best.limitAmount.toLocaleString()} is below the required $${requiredLimitAmount.toLocaleString()}.`,
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
  const ownRequirements = await ctx.db
    .query("insuranceRequirements")
    .withIndex("by_orgId_status", (q) =>
      q.eq("orgId", orgId).eq("status", "active"),
    )
    .order("desc")
    .collect();
  const clientRequirements = await listClientRequirementsForVendor(ctx, orgId);
  return [
    ...ownRequirements.map((requirement) => ({
      ...requirement,
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
    appliesTo: v.optional(
      v.union(v.literal("vendors"), v.literal("own_org"), v.literal("both")),
    ),
    minimumRequired: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const access = await requireOrgMember(ctx, args.orgId);
    if (access.role !== "admin")
      throw new Error("Admin role required to update compliance requirements");
    const now = Date.now();
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
      updatedAt: Date.now(),
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
      const checks = requirements.map((requirement) =>
        assessRequirement(requirement, policies),
      );
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
        ...assessRequirement(requirement, policies),
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
    const now = Date.now();
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

export const createRequirementsInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    appliesTo: v.optional(
      v.union(v.literal("vendors"), v.literal("own_org"), v.literal("both")),
    ),
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
    const now = Date.now();
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
      const checks = requirements.map((requirement) => ({
        requirementTitle: requirement.title,
        ...assessRequirement(requirement, policies),
      }));
      rows.push({ vendorOrg, checks });
    }
    return rows;
  },
});
