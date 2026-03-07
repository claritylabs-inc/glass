import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {
    policyType: v.optional(v.string()),
    carrier: v.optional(v.string()),
    policyYear: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let q;
    if (args.policyType) {
      q = ctx.db
        .query("policies")
        .withIndex("by_policyType", (idx) =>
          idx.eq("policyType", args.policyType as any)
        );
    } else if (args.carrier) {
      q = ctx.db
        .query("policies")
        .withIndex("by_carrier", (idx) => idx.eq("carrier", args.carrier!));
    } else if (args.policyYear) {
      q = ctx.db
        .query("policies")
        .withIndex("by_policyYear", (idx) =>
          idx.eq("policyYear", args.policyYear!)
        );
    } else {
      q = ctx.db.query("policies");
    }
    const all = await q.collect();
    return all.filter((p) => p.extractionStatus === "complete");
  },
});

export const listPending = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("policies").collect();
    const pending = all.filter(
      (p) =>
        p.extractionStatus === "pending" ||
        p.extractionStatus === "extracting" ||
        p.extractionStatus === "error"
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
        return { ...p, emailSubject, emailFrom };
      })
    );

    return enriched;
  },
});

export const get = query({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const allPolicies = await ctx.db.query("policies").collect();
    const connections = await ctx.db.query("emailConnections").collect();

    const policies = allPolicies.filter((p) => p.extractionStatus === "complete");
    const pendingExtractions = allPolicies.filter(
      (p) =>
        p.extractionStatus === "pending" ||
        p.extractionStatus === "extracting" ||
        p.extractionStatus === "error"
    ).length;

    const byType: Record<string, number> = {};
    const byCarrier: Record<string, number> = {};
    const byYear: Record<string, number> = {};

    for (const p of policies) {
      byType[p.policyType] = (byType[p.policyType] || 0) + 1;
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

export const insert = mutation({
  args: {
    emailId: v.optional(v.id("emails")),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    carrier: v.string(),
    policyNumber: v.string(),
    policyType: v.union(
      v.literal("general_liability"),
      v.literal("workers_comp"),
      v.literal("commercial_auto"),
      v.literal("property"),
      v.literal("umbrella"),
      v.literal("professional_liability"),
      v.literal("cyber"),
      v.literal("epli"),
      v.literal("directors_officers"),
      v.literal("other")
    ),
    policyYear: v.number(),
    effectiveDate: v.string(),
    expirationDate: v.string(),
    isRenewal: v.boolean(),
    coverages: v.array(
      v.object({
        name: v.string(),
        limit: v.string(),
        deductible: v.optional(v.string()),
      })
    ),
    premium: v.optional(v.string()),
    insuredName: v.string(),
    summary: v.optional(v.string()),
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
    policyNumber: v.optional(v.string()),
    policyType: v.optional(
      v.union(
        v.literal("general_liability"),
        v.literal("workers_comp"),
        v.literal("commercial_auto"),
        v.literal("property"),
        v.literal("umbrella"),
        v.literal("professional_liability"),
        v.literal("cyber"),
        v.literal("epli"),
        v.literal("directors_officers"),
        v.literal("other")
      )
    ),
    policyYear: v.optional(v.number()),
    effectiveDate: v.optional(v.string()),
    expirationDate: v.optional(v.string()),
    isRenewal: v.optional(v.boolean()),
    coverages: v.optional(
      v.array(
        v.object({
          name: v.string(),
          limit: v.string(),
          deductible: v.optional(v.string()),
        })
      )
    ),
    premium: v.optional(v.string()),
    insuredName: v.optional(v.string()),
    summary: v.optional(v.string()),
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
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const dismiss = mutation({
  args: {
    id: v.id("policies"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { extractionStatus: "not_insurance" as const });
  },
});
