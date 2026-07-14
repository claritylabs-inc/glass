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
import {
  assessRequirementCompliance,
  formatComplianceReasons,
  insuredNameMatches,
  policyReadableForCompliance,
  type ComplianceCheckResult,
} from "./lib/complianceCheck";
import {
  complianceCheckStatusValidator,
  isRequirementLimitKind,
  isRequirementProvision,
  requirementKindValidator,
  requirementProvisionValidator,
  requirementScopeValidator,
  requirementSourceTypeValidator,
} from "./lib/complianceTypes";
import {
  migrateLegacyComplianceRequirement,
  requirementNeedsLegacyShapeBackfill,
} from "./lib/complianceRequirementMigration";
import { isLobCode, lobLabel, policyLobCodes } from "./lib/linesOfBusiness";
import { notify } from "./lib/notify";

const sourceDocumentTypeValidator = v.union(
  v.literal("lease_agreement"),
  v.literal("client_contract"),
  v.literal("vendor_requirements"),
  v.literal("other"),
);

const coverageFormValidator = v.union(
  v.literal("occurrence"),
  v.literal("claims_made"),
);

const limitValidator = v.object({
  kind: v.string(),
  amount: v.number(),
  label: v.optional(v.string()),
});

const deductibleValidator = v.object({
  amount: v.number(),
  label: v.optional(v.string()),
});

const evidenceValidator = v.object({
  note: v.optional(v.string()),
  fileId: v.optional(v.id("_storage")),
  fileName: v.optional(v.string()),
  validUntil: v.optional(v.string()),
});

const complianceMonitorCheckValidator = v.object({
  requirementId: v.id("insuranceRequirements"),
  requirementTitle: v.string(),
  status: complianceCheckStatusValidator,
  reasons: v.optional(v.array(v.string())),
  matchedPolicyIds: v.array(v.id("policies")),
  matchedSummary: v.optional(v.string()),
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
  notMetCount: v.number(),
  missingCount: v.number(),
  expiringSoonCount: v.number(),
  unverifiedCount: v.number(),
  checks: v.array(complianceMonitorCheckValidator),
});

export type OwnComplianceEvent = {
  type: "own_compliance_gap" | "own_compliance_resolved";
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  orgId: Id<"organizations">;
  orgName: string;
  requirementIds: Id<"insuranceRequirements">[];
  issueLines: string[];
};

async function requireOrgMember(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
) {
  const access = await getOrgAccess(ctx, orgId);
  if (access.accessType !== "member") {
    throw new Error("Only organization members can manage compliance requirements");
  }
  return access;
}

async function requireAdminWriteActor(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
  errorMessage: string,
) {
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_orgId_userId", (q) =>
      q.eq("orgId", orgId).eq("userId", userId),
    )
    .first();
  if (membership?.role === "admin") return;

  const access = await requireOrgMember(ctx, orgId);
  if (access.userId === userId && access.role === "admin") return;
  throw new Error(errorMessage);
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function orgLegalNames(org: Doc<"organizations"> | null | undefined) {
  return [
    org?.name,
    ...(org?.relatedLegalEntities ?? []).map((entity) => entity.legalName),
  ].filter((name): name is string => Boolean(name?.trim()));
}

function sanitizeRequirementArgs(args: {
  kind: Doc<"insuranceRequirements">["kind"];
  scope: Doc<"insuranceRequirements">["scope"];
  title: string;
  requirementText: string;
  lineOfBusiness?: string;
  limits?: Array<{ kind: string; amount: number; label?: string }>;
  maxDeductible?: { amount: number; label?: string };
  coverageForm?: "occurrence" | "claims_made";
  retroactiveDateOnOrBefore?: string;
  provisions?: string[];
  requiredForms?: string[];
}) {
  if (args.kind !== "coverage") {
    throw new Error(
      "Only coverage requirements are supported. Carrier standards and administrative conditions are not tracked as compliance requirements.",
    );
  }
  const title = args.title.trim();
  const requirementText = args.requirementText.trim();
  if (!title || !requirementText) {
    throw new Error("Title and requirement text are required");
  }

  const lineOfBusiness = args.lineOfBusiness?.trim() || undefined;
  if (!lineOfBusiness || !isLobCode(lineOfBusiness)) {
    throw new Error("Coverage requirements need a valid ACORD line of business");
  }
  const limits = (args.limits ?? [])
    .filter((limit) => Number.isFinite(limit.amount) && limit.amount >= 0)
    .map((limit) => ({
      kind: isRequirementLimitKind(limit.kind) ? limit.kind : "other",
      amount: limit.amount,
      label: limit.label?.trim() || undefined,
    }));
  if (limits.length === 0 && !args.maxDeductible && !args.provisions?.length) {
    throw new Error("Coverage requirements need at least one limit, deductible, or provision");
  }

  return {
    kind: args.kind,
    scope: args.scope,
    title,
    requirementText,
    lineOfBusiness,
    limits,
    maxDeductible: args.maxDeductible
      ? {
        amount: args.maxDeductible.amount,
        label: args.maxDeductible.label?.trim() || undefined,
      }
      : undefined,
    coverageForm: args.coverageForm,
    retroactiveDateOnOrBefore:
      args.retroactiveDateOnOrBefore?.trim() || undefined,
    provisions: Array.from(
      new Set((args.provisions ?? []).filter(isRequirementProvision)),
    ),
    requiredForms: (args.requiredForms ?? [])
      .map((form) => form.trim())
      .filter(Boolean),
    // Clear any legacy non-coverage fields when updating an existing row.
    minAmBestRating: undefined,
    minAmBestFinancialSize: undefined,
    admittedRequired: undefined,
    conditionType: undefined,
    noticeDays: undefined,
  };
}

async function listRequirementsForOrg(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
) {
  const rows = await ctx.db
    .query("insuranceRequirements")
    .withIndex("by_orgId_status", (q) =>
      q.eq("orgId", orgId).eq("status", "active"),
    )
    .collect();
  return rows.filter((row) => row.kind === "coverage");
}

function requirementsForVendor(
  _relationship: Doc<"connectedOrgRelationships"> | null | undefined,
  requirements: Doc<"insuranceRequirements">[],
) {
  return requirements.filter((requirement) => requirement.scope === "vendors");
}

async function listPoliciesForOrg(ctx: QueryCtx, orgId: Id<"organizations">) {
  return await ctx.db
    .query("policies")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();
}

async function latestChecksForSubject(
  ctx: QueryCtx,
  requirementId: Id<"insuranceRequirements">,
  subjectOrgId: Id<"organizations">,
) {
  return await ctx.db
    .query("complianceChecks")
    .withIndex("by_requirementId_subjectOrgId", (q) =>
      q.eq("requirementId", requirementId).eq("subjectOrgId", subjectOrgId),
    )
    .collect();
}

function resultNotes(result: ComplianceCheckResult) {
  if (result.matchedSummary) return result.matchedSummary;
  return result.reasons.length ? formatComplianceReasons(result.reasons) : undefined;
}

async function assessForSubject(
  ctx: QueryCtx,
  requirement: Doc<"insuranceRequirements">,
  policies: Doc<"policies">[],
  subjectOrgId: Id<"organizations">,
  subjectOrg: Doc<"organizations"> | null,
  options?: {
    relationshipId?: Id<"connectedOrgRelationships">;
    includePreviewPolicies?: boolean;
  },
) {
  const checks = await latestChecksForSubject(ctx, requirement._id, subjectOrgId);
  const result = assessRequirementCompliance(requirement, policies, {
    expectedInsuredName: subjectOrg?.name,
    expectedInsuredNames: orgLegalNames(subjectOrg),
    includePreviewPolicies: options?.includePreviewPolicies,
    existingChecks: checks,
  });
  return {
    ...result,
    relationshipId: options?.relationshipId,
    notes: resultNotes(result),
  };
}

async function listClientRequirementsForVendor(
  ctx: QueryCtx,
  vendorOrgId: Id<"organizations">,
  vendorPolicies: Doc<"policies">[],
  vendorOrg: Doc<"organizations"> | null,
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
    const requirements = requirementsForVendor(
      rel,
      await listRequirementsForOrg(ctx, rel.clientOrgId),
    );
    for (const requirement of requirements) {
      rows.push({
        ...requirement,
        complianceCheck: await assessForSubject(
          ctx,
          requirement,
          vendorPolicies,
          vendorOrgId,
          vendorOrg,
          { relationshipId: rel._id },
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
  const [ownRequirementRows, orgPolicies, org] = await Promise.all([
    ctx.db
      .query("insuranceRequirements")
      .withIndex("by_orgId_status", (q) =>
        q.eq("orgId", orgId).eq("status", "active"),
      )
      .order("desc")
      .collect(),
    listPoliciesForOrg(ctx, orgId),
    ctx.db.get(orgId),
  ]);
  const ownRequirements = ownRequirementRows.filter(
    (row) => row.kind === "coverage",
  );
  const clientRequirements = await listClientRequirementsForVendor(
    ctx,
    orgId,
    orgPolicies,
    org,
  );
  const ownRows = [];
  for (const requirement of ownRequirements) {
    ownRows.push({
      ...requirement,
      complianceCheck:
        requirement.scope === "own_org"
          ? await assessForSubject(ctx, requirement, orgPolicies, orgId, org)
          : undefined,
      canArchive: true,
    });
  }
  return [...ownRows, ...clientRequirements].sort((a, b) => b.updatedAt - a.updatedAt);
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

export const listRequirementSources = query({
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
    const [sources, requirements] = await Promise.all([
      ctx.db
        .query("requirementSourceDocuments")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect(),
      listRequirementsForOrg(ctx, orgId),
    ]);
    const countsBySourceId = new Map<Id<"requirementSourceDocuments">, number>();
    for (const requirement of requirements) {
      if (!requirement.sourceDocumentId) continue;
      countsBySourceId.set(
        requirement.sourceDocumentId,
        (countsBySourceId.get(requirement.sourceDocumentId) ?? 0) + 1,
      );
    }
    return sources
      .filter((source) => !source.archivedAt)
      .map((source) => ({
        ...source,
        requirementCount: countsBySourceId.get(source._id) ?? 0,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const upsertRequirement = mutation({
  args: {
    orgId: v.id("organizations"),
    requirementId: v.optional(v.id("insuranceRequirements")),
    kind: requirementKindValidator,
    scope: requirementScopeValidator,
    title: v.string(),
    requirementText: v.string(),
    lineOfBusiness: v.optional(v.string()),
    limits: v.optional(v.array(limitValidator)),
    maxDeductible: v.optional(deductibleValidator),
    coverageForm: v.optional(coverageFormValidator),
    retroactiveDateOnOrBefore: v.optional(v.string()),
    provisions: v.optional(v.array(requirementProvisionValidator)),
    requiredForms: v.optional(v.array(v.string())),
    sourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    sourceDocumentName: v.optional(v.string()),
    sourceType: v.optional(requirementSourceTypeValidator),
    sourceExcerpt: v.optional(v.string()),
    sourcePageStart: v.optional(v.number()),
    sourcePageEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await requireOrgMember(ctx, args.orgId);
    if (access.role !== "admin") {
      throw new Error("Admin role required to update compliance requirements");
    }
    const now = dayjs().valueOf();
    const sanitized = sanitizeRequirementArgs(args);
    const patch = {
      ...sanitized,
      sourceDocumentId: args.sourceDocumentId,
      sourceDocumentName: args.sourceDocumentName?.trim() || undefined,
      sourceType: args.sourceType ?? "manual",
      sourceExcerpt: args.sourceExcerpt?.trim() || undefined,
      sourcePageStart: args.sourcePageStart,
      sourcePageEnd: args.sourcePageEnd,
      updatedByUserId: access.userId,
      updatedAt: now,
    };
    if (args.requirementId) {
      const existing = await ctx.db.get(args.requirementId);
      if (!existing || existing.orgId !== args.orgId) {
        throw new Error("Requirement not found");
      }
      await ctx.db.patch(args.requirementId, patch);
      return args.requirementId;
    }
    return await ctx.db.insert("insuranceRequirements", {
      orgId: args.orgId,
      ...patch,
      status: "active",
      createdByUserId: access.userId,
      createdAt: now,
    });
  },
});

export const updateRequirementSource = mutation({
  args: {
    orgId: v.id("organizations"),
    sourceDocumentId: v.id("requirementSourceDocuments"),
    title: v.optional(v.string()),
    sourceType: v.optional(sourceDocumentTypeValidator),
  },
  handler: async (ctx, args) => {
    const access = await requireOrgMember(ctx, args.orgId);
    if (access.role !== "admin") {
      throw new Error("Admin role required to update requirement sources");
    }
    const source = await ctx.db.get(args.sourceDocumentId);
    if (!source || source.orgId !== args.orgId || source.archivedAt) {
      throw new Error("Requirement source not found");
    }
    const title = args.title?.trim();
    if (args.title !== undefined && !title) throw new Error("Source name is required");
    if (title === undefined && args.sourceType === undefined) {
      throw new Error("No source updates provided");
    }
    const now = dayjs().valueOf();
    const sourcePatch: Partial<Doc<"requirementSourceDocuments">> = {
      updatedAt: now,
    };
    if (title !== undefined) sourcePatch.title = title;
    if (args.sourceType !== undefined) sourcePatch.sourceType = args.sourceType;
    await ctx.db.patch(args.sourceDocumentId, sourcePatch);
    const requirements = await ctx.db
      .query("insuranceRequirements")
      .withIndex("by_orgId_status", (q) =>
        q.eq("orgId", args.orgId).eq("status", "active"),
      )
      .collect();
    for (const requirement of requirements) {
      if (requirement.sourceDocumentId !== args.sourceDocumentId) continue;
      const requirementPatch: Partial<Doc<"insuranceRequirements">> = {
        updatedByUserId: access.userId,
        updatedAt: now,
      };
      if (title !== undefined) requirementPatch.sourceDocumentName = title;
      if (args.sourceType !== undefined) requirementPatch.sourceType = args.sourceType;
      await ctx.db.patch(requirement._id, requirementPatch);
    }
  },
});

export const archiveRequirementSources = mutation({
  args: {
    orgId: v.id("organizations"),
    sourceDocumentIds: v.array(v.id("requirementSourceDocuments")),
  },
  handler: async (ctx, args) => {
    const access = await requireOrgMember(ctx, args.orgId);
    if (access.role !== "admin") {
      throw new Error("Admin role required to archive requirement sources");
    }
    const sourceDocumentIds = Array.from(new Set(args.sourceDocumentIds));
    if (sourceDocumentIds.length === 0) {
      throw new Error("Select at least one requirement source");
    }
    const now = dayjs().valueOf();
    let archivedSourceCount = 0;
    for (const sourceDocumentId of sourceDocumentIds) {
      const source = await ctx.db.get(sourceDocumentId);
      if (!source || source.orgId !== args.orgId || source.archivedAt) continue;
      await ctx.db.patch(sourceDocumentId, {
        archivedAt: now,
        archivedByUserId: access.userId,
        updatedAt: now,
      });
      archivedSourceCount += 1;
    }
    const selected = new Set(sourceDocumentIds);
    const requirements = await ctx.db
      .query("insuranceRequirements")
      .withIndex("by_orgId_status", (q) =>
        q.eq("orgId", args.orgId).eq("status", "active"),
      )
      .collect();
    let archivedRequirementCount = 0;
    for (const requirement of requirements) {
      if (!requirement.sourceDocumentId || !selected.has(requirement.sourceDocumentId)) continue;
      await ctx.db.patch(requirement._id, {
        status: "archived",
        updatedByUserId: access.userId,
        updatedAt: now,
      });
      archivedRequirementCount += 1;
    }
    return { archivedSourceCount, archivedRequirementCount };
  },
});

export const archiveRequirement = mutation({
  args: {
    orgId: v.id("organizations"),
    requirementId: v.id("insuranceRequirements"),
  },
  handler: async (ctx, args) => {
    const access = await requireOrgMember(ctx, args.orgId);
    if (access.role !== "admin") {
      throw new Error("Admin role required to archive compliance requirements");
    }
    const existing = await ctx.db.get(args.requirementId);
    if (!existing || existing.orgId !== args.orgId) {
      throw new Error("Requirement not found");
    }
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
    if (access.role !== "admin") {
      throw new Error("Admin role required to import compliance requirements");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

export const generateEvidenceUploadUrl = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await requireOrgMember(ctx, args.orgId);
    if (access.role !== "admin") {
      throw new Error("Admin role required to verify requirements");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

export const verifyRequirement = mutation({
  args: {
    orgId: v.id("organizations"),
    requirementId: v.id("insuranceRequirements"),
    subjectOrgId: v.optional(v.id("organizations")),
    relationshipId: v.optional(v.id("connectedOrgRelationships")),
    status: v.optional(complianceCheckStatusValidator),
    evidence: v.optional(evidenceValidator),
  },
  handler: async (ctx, args) => {
    const access = await requireOrgMember(ctx, args.orgId);
    if (access.role !== "admin") {
      throw new Error("Admin role required to verify requirements");
    }
    const requirement = await ctx.db.get(args.requirementId);
    if (!requirement || requirement.orgId !== args.orgId) {
      throw new Error("Requirement not found");
    }
    const now = dayjs().valueOf();
    return await ctx.db.insert("complianceChecks", {
      orgId: args.orgId,
      requirementId: args.requirementId,
      subjectOrgId: args.subjectOrgId ?? args.orgId,
      relationshipId: args.relationshipId,
      status: args.status ?? "met",
      reasons: [],
      matchedPolicyIds: [],
      matchedSummary: "Verified manually.",
      evidence: args.evidence
        ? {
          note: args.evidence.note?.trim() || undefined,
          fileId: args.evidence.fileId,
          fileName: args.evidence.fileName?.trim() || undefined,
          validUntil: args.evidence.validUntil?.trim() || undefined,
        }
        : undefined,
      checkedAt: now,
      checkedBy: "user",
      checkedByUserId: access.userId,
    });
  },
});

async function vendorComplianceRows(
  ctx: QueryCtx,
  clientOrgId: Id<"organizations">,
  includePreviewPolicies = true,
) {
  const clientRequirements = await listRequirementsForOrg(ctx, clientOrgId);
  const relationships = await ctx.db
    .query("connectedOrgRelationships")
    .withIndex("by_clientOrgId_status", (q) =>
      q.eq("clientOrgId", clientOrgId).eq("status", "active"),
    )
    .collect();
  const rows = [];
  for (const rel of relationships) {
    const vendorOrg = await ctx.db.get(rel.vendorOrgId);
    const requirements = requirementsForVendor(rel, clientRequirements);
    const policies = await listPoliciesForOrg(ctx, rel.vendorOrgId);
    const policyCount = policies.filter((policy) =>
      policyReadableForCompliance(policy, includePreviewPolicies),
    ).length;
    const checks = [];
    for (const requirement of requirements) {
      const check = await assessForSubject(ctx, requirement, policies, rel.vendorOrgId, vendorOrg, {
        relationshipId: rel._id,
        includePreviewPolicies,
      });
      checks.push({
        requirement,
        ...check,
      });
    }
    const notMetCount = checks.filter(
      (check) => check.status === "not_met" || check.status === "expired",
    ).length;
    const expiringSoonCount = checks.filter(
      (check) => check.status === "expiring_soon",
    ).length;
    const unverifiedCount = checks.filter(
      (check) => check.status === "unverified",
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
      vendorOrgId: rel.vendorOrgId,
      vendorName: vendorOrg?.name ?? "Unknown vendor",
      status:
        notMetCount > 0
          ? "non_compliant"
          : expiringSoonCount > 0 || unverifiedCount > 0
            ? "attention"
            : requirements.length === 0
              ? "no_requirements"
              : "compliant",
      requirementCount: requirements.length,
      policyCount,
      metCount: checks.filter((check) => check.status === "met").length,
      notMetCount,
      missingCount: notMetCount,
      expiringSoonCount,
      unverifiedCount,
      checks,
    });
  }
  return rows;
}

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
    return await vendorComplianceRows(ctx, clientOrgId, true);
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
          q.eq("clientOrgId", args.clientOrgId!).eq("vendorOrgId", vendorOrgId),
        )
        .collect()
      : await ctx.db
        .query("connectedOrgRelationships")
        .withIndex("by_vendorOrgId_status", (q) =>
          q.eq("vendorOrgId", vendorOrgId).eq("status", "active"),
        )
        .collect();
    const [policies, vendorOrg] = await Promise.all([
      listPoliciesForOrg(ctx, vendorOrgId),
      ctx.db.get(vendorOrgId),
    ]);
    const rows = [];
    for (const rel of relationships.filter((relationship) => relationship.status === "active")) {
      const clientOrg = await ctx.db.get(rel.clientOrgId);
      const requirements = requirementsForVendor(
        rel,
        await listRequirementsForOrg(ctx, rel.clientOrgId),
      );
      const checks = [];
      for (const requirement of requirements) {
        checks.push({
          requirement,
          ...(await assessForSubject(ctx, requirement, policies, vendorOrgId, vendorOrg, {
            relationshipId: rel._id,
          })),
        });
      }
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
  handler: async (ctx, args) => await listRequirementsVisibleToOrg(ctx, args.orgId),
});

export type OwnComplianceAssessment = Awaited<
  ReturnType<typeof assessForSubject>
> & { title: string };

export const assessOwnRequirementsInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    requirementIds: v.optional(v.array(v.id("insuranceRequirements"))),
    includePreviewPolicies: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<OwnComplianceAssessment[]> => {
    const [requirements, policies, org] = await Promise.all([
      listRequirementsForOrg(ctx, args.orgId),
      listPoliciesForOrg(ctx, args.orgId),
      ctx.db.get(args.orgId),
    ]);
    const requestedIds = args.requirementIds
      ? new Set(args.requirementIds)
      : null;
    const ownRequirements = requirements.filter(
      (requirement) =>
        requirement.scope === "own_org" &&
        (!requestedIds || requestedIds.has(requirement._id)),
    );

    return await Promise.all(
      ownRequirements.map(async (requirement) => ({
        title: requirement.title,
        ...(await assessForSubject(
          ctx,
          requirement,
          policies,
          args.orgId,
          org,
          { includePreviewPolicies: args.includePreviewPolicies },
        )),
      })),
    );
  },
});

export const listOrgIdsWithActiveOwnRequirementsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const requirements = await ctx.db
      .query("insuranceRequirements")
      .withIndex("by_status_scope", (query) =>
        query.eq("status", "active").eq("scope", "own_org"),
      )
      .collect();
    return [
      ...new Set<Id<"organizations">>(
        requirements
          .filter((requirement) => requirement.kind === "coverage")
          .map((requirement) => requirement.orgId),
      ),
    ];
  },
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
    if (requirement.scope !== "own_org" || requirement.kind !== "coverage") {
      throw new Error("Only own coverage requirements can be deeply rechecked");
    }
    const [org, policies] = await Promise.all([
      ctx.db.get(args.orgId),
      listPoliciesForOrg(ctx, args.orgId),
    ]);
    const activePolicies = policies.filter((policy) =>
      policyReadableForCompliance(policy, true),
    );
    return {
      org: org
        ? {
          _id: org._id,
          name: org.name,
          relatedLegalEntities: org.relatedLegalEntities ?? [],
        }
        : null,
      requirement,
      deterministicCheck: assessRequirementCompliance(requirement, activePolicies, {
        expectedInsuredName: org?.name,
        expectedInsuredNames: orgLegalNames(org),
      }),
      policies: activePolicies.map((policy) => ({
        _id: policy._id,
        carrier: policy.carrier || policy.security,
        policyNumber: policy.policyNumber,
        insuredName: policy.insuredName,
        effectiveDate: policy.effectiveDate,
        expirationDate: policy.expirationDate,
        linesOfBusiness: policyLobCodes(policy),
        policyTypes: policyLobCodes(policy),
        summary: policy.summary,
        formInventory: policy.formInventory,
        operationalProfile: policy.operationalProfile,
        coverages: (policy.coverages ?? []).map((coverage) => ({
          name: coverage.name,
          lineOfBusiness: coverage.lineOfBusiness,
          coverageCode: coverage.coverageCode,
          limit: coverage.limit,
          limitAmount: coverage.limitAmount,
          limitType: coverage.limitType,
          limits: coverage.limits,
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
    status: complianceCheckStatusValidator,
    matchedPolicyIds: v.array(v.id("policies")),
    expiresAt: v.optional(v.string()),
    daysUntilExpiration: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdminWriteActor(ctx, args.orgId, args.userId, "Admin role required");
    const requirement = await ctx.db.get(args.requirementId);
    if (!requirement || requirement.orgId !== args.orgId) {
      throw new Error("Requirement not found");
    }
    return await ctx.db.insert("complianceChecks", {
      orgId: args.orgId,
      requirementId: args.requirementId,
      subjectOrgId: args.orgId,
      status: args.status,
      reasons: args.status === "met" ? [] : ["agent_review"],
      matchedPolicyIds: args.matchedPolicyIds,
      matchedSummary: args.notes?.trim() || undefined,
      expiresAt: args.expiresAt,
      checkedAt: dayjs().valueOf(),
      checkedBy: "agent",
      checkedByUserId: args.userId,
    });
  },
});

export const upsertRequirementInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    kind: requirementKindValidator,
    scope: requirementScopeValidator,
    title: v.string(),
    requirementText: v.string(),
    lineOfBusiness: v.optional(v.string()),
    limits: v.optional(v.array(limitValidator)),
    maxDeductible: v.optional(deductibleValidator),
    coverageForm: v.optional(coverageFormValidator),
    retroactiveDateOnOrBefore: v.optional(v.string()),
    provisions: v.optional(v.array(requirementProvisionValidator)),
    requiredForms: v.optional(v.array(v.string())),
    sourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    sourceDocumentName: v.optional(v.string()),
    sourceType: v.optional(requirementSourceTypeValidator),
    sourceExcerpt: v.optional(v.string()),
    sourcePageStart: v.optional(v.number()),
    sourcePageEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdminWriteActor(ctx, args.orgId, args.userId, "Admin role required");
    const now = dayjs().valueOf();
    const sanitized = sanitizeRequirementArgs(args);
    return await ctx.db.insert("insuranceRequirements", {
      orgId: args.orgId,
      ...sanitized,
      sourceDocumentId: args.sourceDocumentId,
      sourceDocumentName: args.sourceDocumentName?.trim() || undefined,
      sourceType: args.sourceType ?? "manual",
      sourceExcerpt: args.sourceExcerpt?.trim() || undefined,
      sourcePageStart: args.sourcePageStart,
      sourcePageEnd: args.sourcePageEnd,
      status: "active",
      createdByUserId: args.userId,
      updatedByUserId: args.userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getRequirementImportContextInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const access = args.userId
      ? null
      : await requireOrgMember(ctx, args.orgId);
    if (args.userId) {
      const membership = await ctx.db
        .query("orgMemberships")
        .withIndex("by_orgId_userId", (q) =>
          q.eq("orgId", args.orgId).eq("userId", args.userId!),
        )
        .first();
      if (membership?.role !== "admin") {
        throw new Error("Admin role required to import compliance requirements");
      }
    } else if (access?.role !== "admin") {
      throw new Error("Admin role required to import compliance requirements");
    }
    const existing = await listRequirementsForOrg(ctx, args.orgId);
    return {
      userId: args.userId ?? access!.userId,
      existingRequirements: existing.map((requirement) => ({
        kind: requirement.kind ?? "coverage",
        scope: requirement.scope ?? "vendors",
        title: requirement.title,
        requirementText: requirement.requirementText,
        lineOfBusiness: requirement.lineOfBusiness,
        conditionType: requirement.conditionType,
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
    if (membership?.role !== "admin") {
      throw new Error("Admin role required to import compliance requirements");
    }
    const existing = await listRequirementsForOrg(ctx, args.orgId);
    return {
      userId: args.userId,
      existingRequirements: existing.map((requirement) => ({
        kind: requirement.kind ?? "coverage",
        scope: requirement.scope ?? "vendors",
        title: requirement.title,
        requirementText: requirement.requirementText,
        lineOfBusiness: requirement.lineOfBusiness,
        conditionType: requirement.conditionType,
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
        v.literal("liteparse"),
        v.literal("pdfjs"),
        v.literal("mammoth"),
        v.literal("plain_text"),
      ),
    ),
    parsedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdminWriteActor(ctx, args.orgId, args.userId, "Admin role required");
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
      parsedAt: args.parsedAt,
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
    scope: v.optional(requirementScopeValidator),
    sourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    sourceDocumentName: v.optional(v.string()),
    sourceType: v.optional(requirementSourceTypeValidator),
    requirements: v.array(
      v.object({
        kind: requirementKindValidator,
        scope: v.optional(requirementScopeValidator),
        title: v.string(),
        requirementText: v.string(),
        lineOfBusiness: v.optional(v.string()),
        limits: v.optional(v.array(limitValidator)),
        maxDeductible: v.optional(deductibleValidator),
        coverageForm: v.optional(coverageFormValidator),
        retroactiveDateOnOrBefore: v.optional(v.string()),
        provisions: v.optional(v.array(v.string())),
        requiredForms: v.optional(v.array(v.string())),
        sourceExcerpt: v.optional(v.string()),
        sourcePageStart: v.optional(v.number()),
        sourcePageEnd: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdminWriteActor(ctx, args.orgId, args.userId, "Admin role required");
    const existing = await listRequirementsForOrg(ctx, args.orgId);
    const seen = new Set(
      existing.map((requirement) =>
        normalizeText(
          `${requirement.kind} ${requirement.lineOfBusiness ?? requirement.conditionType ?? ""} ${requirement.title}`,
        ),
      ),
    );
    const now = dayjs().valueOf();
    const ids: Id<"insuranceRequirements">[] = [];
    for (const requirement of args.requirements) {
      const scope = requirement.scope ?? args.scope ?? "vendors";
      const sanitized = sanitizeRequirementArgs({ ...requirement, scope });
      const key = normalizeText(
        `${sanitized.kind} ${sanitized.lineOfBusiness ?? sanitized.conditionType ?? ""} ${sanitized.title}`,
      );
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push(
        await ctx.db.insert("insuranceRequirements", {
          orgId: args.orgId,
          ...sanitized,
          sourceDocumentId: args.sourceDocumentId,
          sourceDocumentName: args.sourceDocumentName?.trim() || undefined,
          sourceType: args.sourceType ?? "bulk_import",
          sourceExcerpt:
            requirement.sourceExcerpt?.trim() || sanitized.requirementText,
          sourcePageStart: requirement.sourcePageStart,
          sourcePageEnd: requirement.sourcePageEnd,
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
  args: {
    clientOrgId: v.id("organizations"),
    includePreviewPolicies: v.optional(v.boolean()),
  },
  handler: async (ctx, args) =>
    await vendorComplianceRows(
      ctx,
      args.clientOrgId,
      args.includePreviewPolicies !== false,
    ),
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
        (row) =>
          row.relationshipId === args.relationshipId ||
          row.vendorOrgId === args.vendorOrgId,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.vendorOrgId))
      .collect();
    const vendorUsers = (
      await Promise.all(memberships.map((membership) => ctx.db.get(membership.userId)))
    ).filter(Boolean);
    return {
      vendorEmail:
        invitation?.vendorEmail ??
        vendorUsers.find((user) => user?.email)?.email,
      vendorUserEmails: vendorUsers
        .map((user) => user?.email)
        .filter((email): email is string => Boolean(email)),
    };
  },
});

const OWN_COMPLIANCE_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;

function isOwnComplianceIssue(status: Doc<"complianceChecks">["status"]) {
  return (
    status === "not_met" ||
    status === "expiring_soon" ||
    status === "expired"
  );
}

function ownComplianceIssueLine(
  check: {
    requirementTitle: string;
    status: Doc<"complianceChecks">["status"];
    daysUntilExpiration?: number;
    notes?: string;
  },
) {
  const status =
    check.status === "expiring_soon" &&
    check.daysUntilExpiration !== undefined
      ? `expires in ${check.daysUntilExpiration} days`
      : check.status.replaceAll("_", " ");
  return `${check.requirementTitle}: ${status}${check.notes ? ` - ${check.notes}` : ""}`;
}

function ownComplianceCheckChanged(
  previous: Doc<"complianceChecks">,
  check: {
    status: Doc<"complianceChecks">["status"];
    reasons?: string[];
    matchedPolicyIds: Id<"policies">[];
    matchedSummary?: string;
    notes?: string;
    expiresAt?: string;
  },
) {
  const previousPolicyIds = previous.matchedPolicyIds
    .map(String)
    .sort()
    .join("|");
  const nextPolicyIds = check.matchedPolicyIds.map(String).sort().join("|");
  return (
    previous.status !== check.status ||
    (previous.reasons ?? []).join("|") !== (check.reasons ?? []).join("|") ||
    previousPolicyIds !== nextPolicyIds ||
    previous.matchedSummary !== (check.matchedSummary ?? check.notes) ||
    previous.expiresAt !== check.expiresAt
  );
}

export const recordOwnComplianceRunInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    checks: v.array(complianceMonitorCheckValidator),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<OwnComplianceEvent[]> => {
    const now = args.nowMs ?? dayjs().valueOf();
    const org = await ctx.db.get(args.orgId);
    const previousByRequirement = new Map<
      Id<"insuranceRequirements">,
      Doc<"complianceChecks"> | null
    >();

    for (const check of args.checks) {
      const latest = await ctx.db
        .query("complianceChecks")
        .withIndex(
          "by_requirementId_subjectOrgId_checkedBy_checkedAt",
          (query) =>
            query
              .eq("requirementId", check.requirementId)
              .eq("subjectOrgId", args.orgId)
              .eq("checkedBy", "system"),
        )
        .order("desc")
        .first();
      previousByRequirement.set(check.requirementId, latest ?? null);
    }

    const currentIssues = args.checks.filter((check) =>
      isOwnComplianceIssue(check.status),
    );
    const emitGap = currentIssues.some((check) => {
      const previous = previousByRequirement.get(check.requirementId);
      return (
        !previous ||
        previous.status !== check.status ||
        previous.alertedAt === undefined ||
        now - previous.alertedAt >= OWN_COMPLIANCE_REMINDER_MS
      );
    });
    const resolvedChecks = args.checks.filter((check) => {
      const previous = previousByRequirement.get(check.requirementId);
      return (
        check.status === "met" &&
        Boolean(previous && isOwnComplianceIssue(previous.status))
      );
    });
    const emitResolved = currentIssues.length === 0 && resolvedChecks.length > 0;
    const resolvedRequirementIds = new Set(
      resolvedChecks.map((check) => check.requirementId),
    );

    for (const check of args.checks) {
      const previous = previousByRequirement.get(check.requirementId);
      const issueIncludedInAlert = emitGap && isOwnComplianceIssue(check.status);
      const resolvedIncludedInAlert =
        emitResolved && resolvedRequirementIds.has(check.requirementId);
      if (
        previous &&
        !ownComplianceCheckChanged(previous, check) &&
        !issueIncludedInAlert &&
        !resolvedIncludedInAlert
      ) {
        continue;
      }
      let alertedAt =
        previous?.status === check.status ? previous.alertedAt : undefined;
      if (issueIncludedInAlert || resolvedIncludedInAlert) alertedAt = now;
      await ctx.db.insert("complianceChecks", {
        orgId: args.orgId,
        requirementId: check.requirementId,
        subjectOrgId: args.orgId,
        status: check.status,
        reasons: check.reasons,
        matchedPolicyIds: check.matchedPolicyIds,
        matchedSummary: check.matchedSummary ?? check.notes,
        expiresAt: check.expiresAt,
        checkedAt: now,
        alertedAt,
        checkedBy: "system",
      });
    }

    const orgName = org?.name ?? "Your organization";
    if (emitGap) {
      const issueLines = currentIssues.map(ownComplianceIssueLine);
      const hasExpired = currentIssues.some((check) => check.status === "expired");
      const issueCount = currentIssues.length;
      return [{
        type: "own_compliance_gap",
        title: hasExpired
          ? "Your insurance has expired coverage"
          : "Your insurance has compliance gaps",
        body: `${issueCount} ${issueCount === 1 ? "requirement needs" : "requirements need"} attention for ${orgName}: ${issueLines.slice(0, 3).join("; ")}${issueLines.length > 3 ? `; +${issueLines.length - 3} more` : ""}`,
        severity: hasExpired ? "critical" : "warning",
        orgId: args.orgId,
        orgName,
        requirementIds: currentIssues.map((check) => check.requirementId),
        issueLines,
      }];
    }

    if (emitResolved) {
      const resolvedTitles = resolvedChecks.map((check) => check.requirementTitle);
      return [{
        type: "own_compliance_resolved",
        title: "Your insurance requirements are now met",
        body: `${orgName} now meets all ${args.checks.length} active insurance requirements in Glass.`,
        severity: "info",
        orgId: args.orgId,
        orgName,
        requirementIds: resolvedChecks.map((check) => check.requirementId),
        issueLines: resolvedTitles,
      }];
    }

    return [];
  },
});

export const notifyOwnComplianceEventInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    type: v.union(
      v.literal("own_compliance_gap"),
      v.literal("own_compliance_resolved"),
    ),
    title: v.string(),
    body: v.string(),
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("critical"),
    ),
    threadId: v.id("threads"),
    requirementIds: v.array(v.id("insuranceRequirements")),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    await notify(ctx, {
      orgId: args.orgId,
      type: args.type,
      title: args.title,
      body: args.body,
      severity: args.severity,
      actionType: "view_thread",
      actionPayload: { threadId: args.threadId },
      sourceRef: {
        threadId: args.threadId,
        requirementIds: args.requirementIds,
      },
      coalesceKeyParts: [args.type, String(args.orgId)],
      nowMs: args.nowMs,
    }),
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
        .query("complianceChecks")
        .withIndex("by_relationshipId", (q) =>
          q.eq("relationshipId", row.relationshipId),
        )
        .collect();
      const latestByRequirement = new Map<
        Id<"insuranceRequirements">,
        Doc<"complianceChecks">
      >();
      for (const snapshot of previousSnapshots) {
        const current = latestByRequirement.get(snapshot.requirementId);
        if (!current || snapshot.checkedAt > current.checkedAt) {
          latestByRequirement.set(snapshot.requirementId, snapshot);
        }
      }
      const issueChecks = row.checks.filter(
        (check) =>
          check.status === "not_met" ||
          check.status === "expired" ||
          check.status === "expiring_soon",
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
        (snapshot) =>
          snapshot.status === "not_met" ||
          snapshot.status === "expired" ||
          snapshot.status === "expiring_soon",
      );
      const currentIsCompliant =
        row.requirementCount > 0 &&
        row.checks.length > 0 &&
        row.checks.every((check) => check.status === "met");

      for (const check of row.checks) {
        await ctx.db.insert("complianceChecks", {
          orgId: args.clientOrgId,
          requirementId: check.requirementId,
          subjectOrgId: row.vendorOrgId,
          relationshipId: row.relationshipId,
          status: check.status,
          reasons: check.reasons,
          matchedPolicyIds: check.matchedPolicyIds,
          matchedSummary: check.matchedSummary ?? check.notes,
          expiresAt: check.expiresAt,
          checkedAt: now,
          checkedBy: "system",
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
        (check) => check.status === "not_met",
      );
      const type = hasExpired
        ? "vendor_policy_expired"
        : hasGap
          ? "vendor_compliance_gap"
          : "vendor_policy_expiring";
      const severity = hasExpired ? "critical" : "warning";
      const issueLines = alertableIssueChecks.map((check) => {
        const status =
          check.status === "expiring_soon" &&
          check.daysUntilExpiration !== undefined
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
  handler: async (ctx, args) =>
    await notify(ctx, {
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
    }),
});

export const backfillComplianceRequirementShapeInternal = internalMutation({
  args: {
    orgId: v.optional(v.id("organizations")),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("insuranceRequirements").collect();
    const dryRun = args.dryRun !== false;
    const maxRows = args.limit ?? 100;
    let scannedCount = 0;
    let changedCount = 0;
    const samples: Array<{
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
    }> = [];

    for (const row of rows) {
      if (args.orgId && row.orgId !== args.orgId) continue;
      scannedCount += 1;
      if (!requirementNeedsLegacyShapeBackfill(row)) continue;
      if (changedCount >= maxRows) continue;

      const previous = row as any;
      const next = migrateLegacyComplianceRequirement(previous);
      changedCount += 1;
      if (samples.length < 25) {
        samples.push({
          requirementId: row._id,
          title: next.title,
          previous: {
            category: previous.category,
            appliesTo: previous.appliesTo,
            evaluationTarget: previous.evaluationTarget,
            limit: previous.limit,
            limitAmount: previous.limitAmount,
          },
          next: {
            kind: next.kind,
            scope: next.scope,
            lineOfBusiness: next.lineOfBusiness,
            limits: next.limits,
            conditionType: next.conditionType,
            minAmBestRating: next.minAmBestRating,
          },
        });
      }
      if (!dryRun) {
        await ctx.db.replace(row._id, next);
      }
    }

    return {
      dryRun,
      scannedCount,
      changedCount,
      remainingCount:
        rows.filter((row) =>
          (!args.orgId || row.orgId === args.orgId) &&
          requirementNeedsLegacyShapeBackfill(row),
        ).length - (dryRun ? 0 : changedCount),
      samples,
    };
  },
});

export const archiveNonCoverageRequirementsInternal = internalMutation({
  args: {
    orgId: v.optional(v.id("organizations")),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun !== false;
    const maxRows = args.limit ?? 200;
    const rows = await ctx.db.query("insuranceRequirements").collect();
    const now = dayjs().valueOf();
    let scannedCount = 0;
    let archivedCount = 0;
    const samples: Array<{
      requirementId: Id<"insuranceRequirements">;
      title: string;
      kind: string;
    }> = [];
    for (const row of rows) {
      if (args.orgId && row.orgId !== args.orgId) continue;
      if (row.status !== "active") continue;
      scannedCount += 1;
      if (row.kind === "coverage") continue;
      if (archivedCount >= maxRows) continue;
      archivedCount += 1;
      if (samples.length < 25) {
        samples.push({
          requirementId: row._id,
          title: row.title,
          kind: row.kind ?? "legacy",
        });
      }
      if (!dryRun) {
        await ctx.db.patch(row._id, { status: "archived", updatedAt: now });
      }
    }
    return { dryRun, scannedCount, archivedCount, samples };
  },
});

export const wipeComplianceDataInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    let deletedRequirements = 0;
    for (const row of await ctx.db.query("insuranceRequirements").collect()) {
      await ctx.db.delete(row._id);
      deletedRequirements += 1;
    }
    let deletedSourceDocuments = 0;
    for (const row of await ctx.db.query("requirementSourceDocuments").collect()) {
      await ctx.db.delete(row._id);
      deletedSourceDocuments += 1;
    }
    let deletedChecks = 0;
    for (const row of await ctx.db.query("complianceChecks").collect()) {
      await ctx.db.delete(row._id);
      deletedChecks += 1;
    }
    return { deletedRequirements, deletedSourceDocuments, deletedChecks };
  },
});

export function policyMatchesAnyInsuredName(
  policy: Doc<"policies">,
  expectedNames: string[],
) {
  if (expectedNames.length === 0) return true;
  return expectedNames.some((expectedName) =>
    insuredNameMatches(policy.insuredName, expectedName),
  );
}

export function lineOfBusinessLabel(value?: string) {
  return value ? lobLabel(value) : "Coverage";
}
