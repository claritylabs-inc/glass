import { v } from "convex/values";
import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { requireOrgAccess, getOrgAccess } from "./lib/orgAuth";

export const list = query({
  args: {
    carrier: v.optional(v.string()),
    policyYear: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const { orgId } = access;
    const all = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    return all.filter(
      (p) =>
        p.extractionStatus === "complete" &&
        !p.deletedAt &&
        (!args.carrier || p.carrier === args.carrier) &&
        (!args.policyYear || p.policyYear === args.policyYear)
    );
  },
});

export const listPending = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const { orgId } = access;
    const all = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    const pending = all.filter(
      (p) =>
        !p.deletedAt &&
        (p.extractionStatus === "pending" ||
        p.extractionStatus === "extracting" ||
        p.extractionStatus === "error")
    );

    const enriched = await Promise.all(
      pending.map(async (p) => {
        let emailSubject: string | undefined;
        let emailFrom: string | undefined;
        if (p.emailId) {
          const email = await ctx.db.get(p.emailId);
          if (email) {
            emailSubject = email.subject;
            emailFrom = email.from;
          }
        }
        const { rawExtractionResponse, rawMetadataResponse, ...rest } = p;
        return {
          ...rest,
          emailSubject,
          emailFrom,
          hasRawResponse: !!rawExtractionResponse,
          hasRawMetadata: !!rawMetadataResponse,
        };
      })
    );

    return enriched;
  },
});

export const listExtractionLog = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const { orgId } = access;
    const all = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    const completed = all.filter(
      (p) =>
        !p.deletedAt &&
        (p.extractionStatus === "complete" || p.extractionStatus === "not_insurance")
    );

    const enriched = await Promise.all(
      completed.map(async (p) => {
        let emailSubject: string | undefined;
        let emailFrom: string | undefined;
        if (p.emailId) {
          const email = await ctx.db.get(p.emailId);
          if (email) {
            emailSubject = email.subject;
            emailFrom = email.from;
          }
        }
        const { rawExtractionResponse, rawMetadataResponse, ...rest } = p;
        return {
          ...rest,
          emailSubject,
          emailFrom,
          hasRawResponse: !!rawExtractionResponse,
          hasRawMetadata: !!rawMetadataResponse,
        };
      })
    );

    return enriched;
  },
});

export const get = query({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const policy = await ctx.db.get(args.id);
    if (!policy || policy.orgId !== orgId) return null;
    return {
      ...policy,
      hasRawResponse: !!policy.rawExtractionResponse,
      hasRawMetadata: !!policy.rawMetadataResponse,
    };
  },
});

export const getFileUrl = query({
  args: { fileId: v.id("_storage") },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx);
    return await ctx.storage.getUrl(args.fileId);
  },
});

export const emailIdsWithPolicies = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireOrgAccess(ctx);
    const all = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    const ids = new Set<string>();
    for (const p of all) {
      if (
        p.emailId &&
        p.extractionStatus !== "not_insurance" &&
        !p.deletedAt
      ) {
        ids.add(p.emailId);
      }
    }
    return [...ids];
  },
});

// All complete, non-deleted policies for an org (used by agent action)
export const listAllInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", args.orgId))
      .collect();
    return all.filter(
      (p) => p.extractionStatus === "complete" && !p.deletedAt
    );
  },
});

// Legacy: support userId-based lookup during transition
export const listAllInternalByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("policies")
      .withIndex("by_userId", (idx) => idx.eq("userId", args.userId as any))
      .collect();
    return all.filter(
      (p) => p.extractionStatus === "complete" && !p.deletedAt
    );
  },
});

// Internal version for scheduled actions (no auth context)
export const emailIdsWithPoliciesInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", args.orgId))
      .collect();
    const ids = new Set<string>();
    for (const p of all) {
      if (p.emailId && p.extractionStatus !== "not_insurance" && !p.deletedAt) {
        ids.add(p.emailId);
      }
    }
    return [...ids];
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return { totalPolicies: 0, activeConnections: 0, lastScanAt: null, pendingExtractions: 0, byType: {}, byCarrier: {}, byYear: {} };
    const { orgId } = access;
    const allPolicies = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    const connections = await ctx.db
      .query("emailConnections")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();

    const policies = allPolicies.filter((p) => p.extractionStatus === "complete" && !p.deletedAt);
    const pendingExtractions = allPolicies.filter(
      (p) =>
        !p.deletedAt &&
        (p.extractionStatus === "pending" ||
        p.extractionStatus === "extracting" ||
        p.extractionStatus === "error")
    ).length;

    const byType: Record<string, number> = {};
    const byCarrier: Record<string, number> = {};
    const byYear: Record<string, number> = {};

    for (const p of policies) {
      const types = p.policyTypes ?? ((p as any).policyType ? [(p as any).policyType] : ["other"]);
      for (const t of types) {
        byType[t] = (byType[t] || 0) + 1;
      }
      byCarrier[p.carrier] = (byCarrier[p.carrier] || 0) + 1;
      byYear[p.policyYear] = (byYear[p.policyYear] || 0) + 1;
    }

    const lastScan = connections.reduce<number | null>((latest, c) => {
      if (!c.lastScanAt) return latest;
      return latest ? Math.max(latest, c.lastScanAt) : c.lastScanAt;
    }, null);

    return {
      totalPolicies: policies.length,
      activeConnections: connections.length,
      lastScanAt: lastScan,
      pendingExtractions,
      byType,
      byCarrier,
      byYear,
    };
  },
});

// Shared validators for coverages and document structure
const coverageValidator = v.object({
  name: v.string(),
  limit: v.string(),
  deductible: v.optional(v.string()),
  pageNumber: v.optional(v.number()),
  sectionRef: v.optional(v.string()),
});

const documentValidator = v.object({
  sections: v.array(v.object({
    title: v.string(),
    sectionNumber: v.optional(v.string()),
    pageStart: v.number(),
    pageEnd: v.optional(v.number()),
    type: v.string(),
    coverageType: v.optional(v.string()),
    content: v.string(),
    subsections: v.optional(v.array(v.object({
      title: v.string(),
      sectionNumber: v.optional(v.string()),
      pageNumber: v.optional(v.number()),
      content: v.string(),
    }))),
  })),
  regulatoryContext: v.optional(v.object({
    content: v.string(),
    pageNumber: v.optional(v.number()),
    jurisdiction: v.optional(v.string()),
    regulatoryBody: v.optional(v.string()),
    governingLaw: v.optional(v.string()),
    details: v.optional(v.array(v.object({
      label: v.string(),
      value: v.string(),
    }))),
  })),
  complaintContact: v.optional(v.object({
    content: v.string(),
    pageNumber: v.optional(v.number()),
    contacts: v.optional(v.array(v.object({
      name: v.optional(v.string()),
      type: v.optional(v.string()),
      phone: v.optional(v.string()),
      fax: v.optional(v.string()),
      email: v.optional(v.string()),
      title: v.optional(v.string()),
      address: v.optional(v.string()),
    }))),
  })),
  costsAndFees: v.optional(v.object({
    content: v.string(),
    pageNumber: v.optional(v.number()),
    fees: v.optional(v.array(v.object({
      name: v.string(),
      amount: v.optional(v.string()),
      description: v.optional(v.string()),
      type: v.optional(v.string()),
    }))),
  })),
  claimsContact: v.optional(v.object({
    content: v.string(),
    pageNumber: v.optional(v.number()),
    contacts: v.optional(v.array(v.object({
      name: v.optional(v.string()),
      phone: v.optional(v.string()),
      fax: v.optional(v.string()),
      email: v.optional(v.string()),
      address: v.optional(v.string()),
      hours: v.optional(v.string()),
    }))),
    processSteps: v.optional(v.array(v.string())),
    reportingTimeLimit: v.optional(v.string()),
  })),
});

const metadataSourceValidator = v.object({
  carrierPage: v.optional(v.number()),
  policyNumberPage: v.optional(v.number()),
  premiumPage: v.optional(v.number()),
  effectiveDatePage: v.optional(v.number()),
});

export const insert = mutation({
  args: {
    userId: v.optional(v.id("users")),
    orgId: v.optional(v.id("organizations")),
    emailId: v.optional(v.id("emails")),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    carrier: v.string(),
    security: v.optional(v.string()),
    underwriter: v.optional(v.string()),
    mga: v.optional(v.string()),
    broker: v.optional(v.string()),
    policyNumber: v.string(),
    policyTypes: v.array(v.string()),
    documentType: v.union(v.literal("policy"), v.literal("quote")),
    policyYear: v.number(),
    effectiveDate: v.string(),
    expirationDate: v.string(),
    isRenewal: v.boolean(),
    coverages: v.array(coverageValidator),
    premium: v.optional(v.string()),
    insuredName: v.string(),
    summary: v.optional(v.string()),
    metadataSource: v.optional(metadataSourceValidator),
    document: v.optional(documentValidator),
    extractionStatus: v.union(
      v.literal("pending"),
      v.literal("extracting"),
      v.literal("complete"),
      v.literal("error"),
      v.literal("not_insurance")
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("policies", args);
  },
});

export const updateExtraction = mutation({
  args: {
    id: v.id("policies"),
    carrier: v.optional(v.string()),
    security: v.optional(v.string()),
    underwriter: v.optional(v.string()),
    mga: v.optional(v.string()),
    broker: v.optional(v.string()),
    policyNumber: v.optional(v.string()),
    policyTypes: v.optional(v.array(v.string())),
    documentType: v.optional(v.union(v.literal("policy"), v.literal("quote"))),
    policyYear: v.optional(v.number()),
    effectiveDate: v.optional(v.string()),
    expirationDate: v.optional(v.string()),
    isRenewal: v.optional(v.boolean()),
    coverages: v.optional(v.array(coverageValidator)),
    premium: v.optional(v.string()),
    insuredName: v.optional(v.string()),
    summary: v.optional(v.string()),
    metadataSource: v.optional(metadataSourceValidator),
    document: v.optional(documentValidator),
    extractionStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("extracting"),
        v.literal("complete"),
        v.literal("error"),
        v.literal("not_insurance")
      )
    ),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    extractionError: v.optional(v.string()),
    rawExtractionResponse: v.optional(v.string()),
    rawMetadataResponse: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOrgAccess(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const dismiss = mutation({
  args: {
    id: v.id("policies"),
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const policy = await ctx.db.get(args.id);
    if (!policy || policy.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.id, { extractionStatus: "not_insurance" as const });
    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId,
      orgId,
      action: "dismissed",
    });
  },
});

export const softDelete = mutation({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const policy = await ctx.db.get(args.id);
    if (!policy || policy.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId,
      orgId,
      action: "deleted",
    });
  },
});

export const appendExtractionLog = internalMutation({
  args: {
    id: v.id("policies"),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.id);
    if (!policy) return;
    const log = policy.extractionLog ?? [];
    log.push({ timestamp: Date.now(), message: args.message });
    await ctx.db.patch(args.id, { extractionLog: log });
  },
});

export const clearExtractionLog = internalMutation({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { extractionLog: [] });
  },
});

export const restore = mutation({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const policy = await ctx.db.get(args.id);
    if (!policy || policy.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.id, { deletedAt: undefined });
    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId,
      orgId,
      action: "restored",
    });
  },
});
