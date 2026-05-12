import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
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
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function categoryTerms(category: Doc<"insuranceRequirements">["category"], title: string, requirementText: string) {
  const custom = normalizeText(`${title} ${requirementText}`).split(/\s+/).filter((term) => term.length >= 4);
  const builtIn: Record<string, string[]> = {
    general_liability: ["general liability", "commercial general liability", "cgl", "liability"],
    auto: ["auto", "automobile", "business auto", "commercial auto", "vehicle"],
    workers_comp: ["workers compensation", "workers comp", "employers liability", "wc"],
    umbrella: ["umbrella", "excess liability", "excess"],
    professional: ["professional liability", "errors omissions", "e o", "e&o"],
    cyber: ["cyber", "privacy", "network security"],
    property: ["property", "inland marine", "equipment"],
    other: custom.slice(0, 8),
  };
  return [...builtIn[category], ...custom.slice(0, 4)].filter(Boolean);
}

function policySearchText(policy: Doc<"policies">) {
  return normalizeText([
    policy.policyType,
    ...(policy.policyTypes ?? []),
    policy.summary,
    policy.carrier,
    policy.security,
    policy.broker,
    policy.insuredName,
    ...(policy.coverages ?? []).map((coverage) => `${coverage.name} ${coverage.limit ?? ""} ${coverage.originalContent ?? ""}`),
  ].flat().filter(Boolean).join(" "));
}

function parseDate(value: string | undefined) {
  if (!value) return Number.NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.NaN;
}

function assessRequirement(requirement: Doc<"insuranceRequirements">, policies: Doc<"policies">[], now = Date.now()) {
  const terms = categoryTerms(requirement.category, requirement.title, requirement.requirementText);
  const candidates = policies
    .filter((policy) => !policy.deletedAt && !policy.dismissed && policy.documentType !== "quote")
    .map((policy) => ({ policy, text: policySearchText(policy), expiration: parseDate(policy.expirationDate) }))
    .filter(({ policy, text }) => {
      if (requirement.category === "other") {
        return terms.some((term) => text.includes(term));
      }
      return terms.some((term) => text.includes(normalizeText(term))) || normalizeText(policy.policyType).includes(requirement.category.replace("_", " "));
    })
    .sort((a, b) => (Number.isFinite(b.expiration) ? b.expiration : 0) - (Number.isFinite(a.expiration) ? a.expiration : 0));

  if (candidates.length === 0) {
    return {
      requirementId: requirement._id,
      status: "missing" as const,
      matchedPolicyIds: [] as Id<"policies">[],
      expiresAt: undefined,
      notes: "No active policy appears to match this requirement. Glass will re-check as vendors upload coverage.",
    };
  }

  const active = candidates.find(({ expiration }) => Number.isFinite(expiration) && expiration >= now);
  const best = active ?? candidates[0]!;
  const daysUntilExpiration = Number.isFinite(best.expiration)
    ? Math.ceil((best.expiration - now) / (24 * 60 * 60 * 1000))
    : undefined;
  const status = active
    ? daysUntilExpiration !== undefined && daysUntilExpiration <= 30
      ? "expiring_soon" as const
      : "met" as const
    : "expired" as const;

  return {
    requirementId: requirement._id,
    status,
    matchedPolicyIds: [best.policy._id],
    expiresAt: Number.isFinite(best.expiration) ? best.policy.expirationDate : undefined,
    daysUntilExpiration,
    notes: status === "met"
      ? `Matched ${best.policy.carrier} ${best.policy.policyNumber}.`
      : status === "expiring_soon"
        ? `Matched ${best.policy.carrier} ${best.policy.policyNumber}, but it expires in ${daysUntilExpiration} days.`
        : `Latest matching policy ${best.policy.carrier} ${best.policy.policyNumber} appears expired.`,
  };
}

async function requireOrgMember(ctx: QueryCtx | MutationCtx, orgId: Id<"organizations">) {
  const access = await getOrgAccess(ctx, orgId);
  if (access.accessType !== "member") throw new Error("Only organization members can manage compliance requirements");
  return access;
}

async function listRequirementsForOrg(ctx: QueryCtx, orgId: Id<"organizations">) {
  return await ctx.db
    .query("insuranceRequirements")
    .withIndex("by_orgId_status", (q) => q.eq("orgId", orgId).eq("status", "active"))
    .collect();
}

export const listRequirements = query({
  args: { orgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    let orgId = args.orgId;
    if (!orgId) {
      const membership = await ctx.db.query("orgMemberships").withIndex("by_userId", (q) => q.eq("userId", userId)).first();
      if (!membership) throw new Error("Organization required");
      orgId = membership.orgId;
    }
    await requireOrgMember(ctx, orgId);
    return await ctx.db
      .query("insuranceRequirements")
      .withIndex("by_orgId_status", (q) => q.eq("orgId", orgId).eq("status", "active"))
      .order("desc")
      .collect();
  },
});

export const upsertRequirement = mutation({
  args: {
    orgId: v.id("organizations"),
    requirementId: v.optional(v.id("insuranceRequirements")),
    title: v.string(),
    category: requirementCategoryValidator,
    requirementText: v.string(),
    appliesTo: v.optional(v.union(v.literal("vendors"), v.literal("own_org"), v.literal("both"))),
    minimumRequired: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const access = await requireOrgMember(ctx, args.orgId);
    if (access.role !== "admin") throw new Error("Admin role required to update compliance requirements");
    const now = Date.now();
    const trimmedTitle = args.title.trim();
    const trimmedText = args.requirementText.trim();
    if (!trimmedTitle || !trimmedText) throw new Error("Title and requirement text are required");
    if (args.requirementId) {
      const existing = await ctx.db.get(args.requirementId);
      if (!existing || existing.orgId !== args.orgId) throw new Error("Requirement not found");
      await ctx.db.patch(args.requirementId, {
        title: trimmedTitle,
        category: args.category,
        requirementText: trimmedText,
        appliesTo: args.appliesTo ?? existing.appliesTo ?? "vendors",
        minimumRequired: args.minimumRequired ?? existing.minimumRequired ?? true,
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
  args: { orgId: v.id("organizations"), requirementId: v.id("insuranceRequirements") },
  handler: async (ctx, args) => {
    const access = await requireOrgMember(ctx, args.orgId);
    if (access.role !== "admin") throw new Error("Admin role required to archive compliance requirements");
    const existing = await ctx.db.get(args.requirementId);
    if (!existing || existing.orgId !== args.orgId) throw new Error("Requirement not found");
    await ctx.db.patch(args.requirementId, { status: "archived", updatedByUserId: access.userId, updatedAt: Date.now() });
  },
});

export const listVendorCompliance = query({
  args: { clientOrgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    let clientOrgId = args.clientOrgId;
    if (!clientOrgId) {
      const membership = await ctx.db.query("orgMemberships").withIndex("by_userId", (q) => q.eq("userId", userId)).first();
      if (!membership) throw new Error("Organization required");
      clientOrgId = membership.orgId;
    }
    await requireOrgMember(ctx, clientOrgId);
    const requirements = await listRequirementsForOrg(ctx, clientOrgId);
    const relationships = await ctx.db
      .query("connectedOrgRelationships")
      .withIndex("by_clientOrgId_status", (q) => q.eq("clientOrgId", clientOrgId).eq("status", "active"))
      .collect();
    const rows = [];
    for (const rel of relationships) {
      const vendorOrg = await ctx.db.get(rel.vendorOrgId);
      const policies = await ctx.db.query("policies").withIndex("by_orgId", (q) => q.eq("orgId", rel.vendorOrgId)).collect();
      const checks = requirements.map((requirement) => assessRequirement(requirement, policies));
      const missing = checks.filter((check) => check.status === "missing" || check.status === "expired").length;
      const expiringSoon = checks.filter((check) => check.status === "expiring_soon").length;
      rows.push({
        relationshipId: rel._id,
        vendorOrg: vendorOrg ? { _id: vendorOrg._id, name: vendorOrg.name, website: vendorOrg.website } : null,
        status: missing > 0 ? "non_compliant" : expiringSoon > 0 ? "attention" : requirements.length === 0 ? "no_requirements" : "compliant",
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
  args: { vendorOrgId: v.optional(v.id("organizations")), clientOrgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    let vendorOrgId = args.vendorOrgId;
    if (!vendorOrgId) {
      const membership = await ctx.db.query("orgMemberships").withIndex("by_userId", (q) => q.eq("userId", userId)).first();
      if (!membership) throw new Error("Organization required");
      vendorOrgId = membership.orgId;
    }
    await requireOrgMember(ctx, vendorOrgId);
    const relationships = args.clientOrgId
      ? await ctx.db.query("connectedOrgRelationships").withIndex("by_clientOrgId_vendorOrgId", (q) => q.eq("clientOrgId", args.clientOrgId!).eq("vendorOrgId", vendorOrgId)).collect()
      : await ctx.db.query("connectedOrgRelationships").withIndex("by_vendorOrgId_status", (q) => q.eq("vendorOrgId", vendorOrgId).eq("status", "active")).collect();
    const policies = await ctx.db.query("policies").withIndex("by_orgId", (q) => q.eq("orgId", vendorOrgId)).collect();
    const rows = [];
    for (const rel of relationships.filter((relationship) => relationship.status === "active")) {
      const clientOrg = await ctx.db.get(rel.clientOrgId);
      const requirements = await listRequirementsForOrg(ctx, rel.clientOrgId);
      const checks = requirements.map((requirement) => ({ requirement, ...assessRequirement(requirement, policies) }));
      rows.push({ clientOrg: clientOrg ? { _id: clientOrg._id, name: clientOrg.name, website: clientOrg.website } : null, checks });
    }
    return rows;
  },
});

export const listRequirementsInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => listRequirementsForOrg(ctx, args.orgId),
});

export const upsertRequirementInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    title: v.string(),
    category: requirementCategoryValidator,
    requirementText: v.string(),
    appliesTo: v.optional(v.union(v.literal("vendors"), v.literal("own_org"), v.literal("both"))),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db.query("orgMemberships").withIndex("by_orgId_userId", (q) => q.eq("orgId", args.orgId).eq("userId", args.userId)).first();
    if (membership?.role !== "admin") throw new Error("Admin role required");
    const now = Date.now();
    return await ctx.db.insert("insuranceRequirements", {
      orgId: args.orgId,
      title: args.title.trim(),
      category: args.category,
      requirementText: args.requirementText.trim(),
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

export const listVendorComplianceInternal = internalQuery({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const requirements = await listRequirementsForOrg(ctx, args.clientOrgId);
    const relationships = await ctx.db.query("connectedOrgRelationships").withIndex("by_clientOrgId_status", (q) => q.eq("clientOrgId", args.clientOrgId).eq("status", "active")).collect();
    const rows = [];
    for (const rel of relationships) {
      const vendorOrg = await ctx.db.get(rel.vendorOrgId);
      const policies = await ctx.db.query("policies").withIndex("by_orgId", (q) => q.eq("orgId", rel.vendorOrgId)).collect();
      const checks = requirements.map((requirement) => ({ requirementTitle: requirement.title, ...assessRequirement(requirement, policies) }));
      rows.push({ vendorOrg, checks });
    }
    return rows;
  },
});
