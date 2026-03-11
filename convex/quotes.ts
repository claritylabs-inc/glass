import { v } from "convex/values";
import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { requireOrgAccess, getOrgAccess } from "./lib/orgAuth";

const coverageValidator = v.object({
  name: v.string(),
  proposedLimit: v.string(),
  proposedDeductible: v.optional(v.string()),
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
});

const metadataSourceValidator = v.object({
  carrierPage: v.optional(v.number()),
  quoteNumberPage: v.optional(v.number()),
  premiumPage: v.optional(v.number()),
  effectiveDatePage: v.optional(v.number()),
});

export const list = query({
  args: {
    carrier: v.optional(v.string()),
    quoteYear: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const { orgId } = access;
    const all = await ctx.db
      .query("quotes")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    return all.filter(
      (q) =>
        q.extractionStatus === "complete" &&
        !q.deletedAt &&
        (!args.carrier || q.carrier === args.carrier) &&
        (!args.quoteYear || q.quoteYear === args.quoteYear)
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
      .query("quotes")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    const pending = all.filter(
      (q) =>
        !q.deletedAt &&
        (q.extractionStatus === "pending" ||
        q.extractionStatus === "extracting" ||
        q.extractionStatus === "error")
    );

    const enriched = await Promise.all(
      pending.map(async (q) => {
        let emailSubject: string | undefined;
        let emailFrom: string | undefined;
        if (q.emailId) {
          const email = await ctx.db.get(q.emailId);
          if (email) {
            emailSubject = email.subject;
            emailFrom = email.from;
          }
        }
        const { rawExtractionResponse, rawMetadataResponse, ...rest } = q;
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
      .query("quotes")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    const completed = all.filter(
      (q) =>
        !q.deletedAt &&
        (q.extractionStatus === "complete" || q.extractionStatus === "not_insurance")
    );

    const enriched = await Promise.all(
      completed.map(async (q) => {
        let emailSubject: string | undefined;
        let emailFrom: string | undefined;
        if (q.emailId) {
          const email = await ctx.db.get(q.emailId);
          if (email) {
            emailSubject = email.subject;
            emailFrom = email.from;
          }
        }
        const { rawExtractionResponse, rawMetadataResponse, ...rest } = q;
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
  args: { id: v.id("quotes") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote || quote.orgId !== orgId) return null;
    return {
      ...quote,
      hasRawResponse: !!quote.rawExtractionResponse,
      hasRawMetadata: !!quote.rawMetadataResponse,
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

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return { totalQuotes: 0, pendingExtractions: 0, byType: {}, byCarrier: {}, byYear: {} };
    const { orgId } = access;
    const allQuotes = await ctx.db
      .query("quotes")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();

    const quotes = allQuotes.filter((q) => q.extractionStatus === "complete" && !q.deletedAt);
    const pendingExtractions = allQuotes.filter(
      (q) =>
        !q.deletedAt &&
        (q.extractionStatus === "pending" ||
        q.extractionStatus === "extracting" ||
        q.extractionStatus === "error")
    ).length;

    const byType: Record<string, number> = {};
    const byCarrier: Record<string, number> = {};
    const byYear: Record<string, number> = {};

    for (const q of quotes) {
      const types = q.policyTypes ?? ["other"];
      for (const t of types) {
        byType[t] = (byType[t] || 0) + 1;
      }
      byCarrier[q.carrier] = (byCarrier[q.carrier] || 0) + 1;
      byYear[q.quoteYear] = (byYear[q.quoteYear] || 0) + 1;
    }

    return {
      totalQuotes: quotes.length,
      pendingExtractions,
      byType,
      byCarrier,
      byYear,
    };
  },
});

// All complete, non-deleted quotes for an org (used by agent action)
export const listAllInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("quotes")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", args.orgId))
      .collect();
    return all.filter(
      (q) => q.extractionStatus === "complete" && !q.deletedAt
    );
  },
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
    quoteNumber: v.string(),
    policyTypes: v.optional(v.array(v.string())),
    quoteYear: v.number(),
    proposedEffectiveDate: v.optional(v.string()),
    proposedExpirationDate: v.optional(v.string()),
    quoteExpirationDate: v.optional(v.string()),
    isRenewal: v.boolean(),
    coverages: v.array(coverageValidator),
    premium: v.optional(v.string()),
    premiumBreakdown: v.optional(v.array(v.object({ line: v.string(), amount: v.string() }))),
    insuredName: v.string(),
    summary: v.optional(v.string()),
    subjectivities: v.optional(v.array(v.object({
      description: v.string(),
      category: v.optional(v.string()),
      pageNumber: v.optional(v.number()),
    }))),
    underwritingConditions: v.optional(v.array(v.object({
      description: v.string(),
      pageNumber: v.optional(v.number()),
    }))),
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
    return await ctx.db.insert("quotes", args);
  },
});

export const updateExtraction = mutation({
  args: {
    id: v.id("quotes"),
    carrier: v.optional(v.string()),
    security: v.optional(v.string()),
    underwriter: v.optional(v.string()),
    mga: v.optional(v.string()),
    broker: v.optional(v.string()),
    quoteNumber: v.optional(v.string()),
    policyTypes: v.optional(v.array(v.string())),
    quoteYear: v.optional(v.number()),
    proposedEffectiveDate: v.optional(v.string()),
    proposedExpirationDate: v.optional(v.string()),
    quoteExpirationDate: v.optional(v.string()),
    isRenewal: v.optional(v.boolean()),
    coverages: v.optional(v.array(coverageValidator)),
    premium: v.optional(v.string()),
    premiumBreakdown: v.optional(v.array(v.object({ line: v.string(), amount: v.string() }))),
    insuredName: v.optional(v.string()),
    summary: v.optional(v.string()),
    subjectivities: v.optional(v.array(v.object({
      description: v.string(),
      category: v.optional(v.string()),
      pageNumber: v.optional(v.number()),
    }))),
    underwritingConditions: v.optional(v.array(v.object({
      description: v.string(),
      pageNumber: v.optional(v.number()),
    }))),
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
    id: v.id("quotes"),
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote || quote.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.id, { extractionStatus: "not_insurance" as const });
    await ctx.db.insert("policyAuditLog", {
      quoteId: args.id,
      userId,
      orgId,
      action: "dismissed",
    });
  },
});

export const softDelete = mutation({
  args: { id: v.id("quotes") },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote || quote.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
    await ctx.db.insert("policyAuditLog", {
      quoteId: args.id,
      userId,
      orgId,
      action: "deleted",
    });
  },
});

export const restore = mutation({
  args: { id: v.id("quotes") },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote || quote.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.id, { deletedAt: undefined });
    await ctx.db.insert("policyAuditLog", {
      quoteId: args.id,
      userId,
      orgId,
      action: "restored",
    });
  },
});

export const appendExtractionLog = internalMutation({
  args: {
    id: v.id("quotes"),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const quote = await ctx.db.get(args.id);
    if (!quote) return;
    const log = quote.extractionLog ?? [];
    log.push({ timestamp: Date.now(), message: args.message });
    await ctx.db.patch(args.id, { extractionLog: log });
  },
});

export const clearExtractionLog = internalMutation({
  args: { id: v.id("quotes") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { extractionLog: [] });
  },
});
