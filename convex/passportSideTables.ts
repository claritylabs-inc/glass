import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { requireOrgAccess, getOrgAccess } from "./lib/orgAuth";

const addressArg = v.object({
  street1: v.string(),
  street2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  zip: v.optional(v.string()),
  country: v.optional(v.string()),
});

// ── Locations ─────────────────────────────────────────────────────────────────

export const addLocation = mutation({
  args: {
    address: addressArg,
    description: v.optional(v.string()),
    occupancy: v.optional(v.string()),
    squareFootage: v.optional(v.number()),
    yearBuilt: v.optional(v.number()),
    constructionType: v.optional(v.string()),
    protectionClass: v.optional(v.string()),
    sprinklered: v.optional(v.boolean()),
    alarmType: v.optional(v.string()),
    buildingValue: v.optional(v.string()),
    contentsValue: v.optional(v.string()),
    businessIncomeValue: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const existing = await ctx.db
      .query("passportLocations")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", orgId))
      .collect();
    const number = existing.length + 1;
    return await ctx.db.insert("passportLocations", {
      clientOrgId: orgId,
      number,
      ...args,
    });
  },
});

export const updateLocation = mutation({
  args: {
    locationId: v.id("passportLocations"),
    patch: v.object({
      address: v.optional(addressArg),
      description: v.optional(v.string()),
      occupancy: v.optional(v.string()),
      squareFootage: v.optional(v.number()),
      yearBuilt: v.optional(v.number()),
      constructionType: v.optional(v.string()),
      protectionClass: v.optional(v.string()),
      sprinklered: v.optional(v.boolean()),
      alarmType: v.optional(v.string()),
      buildingValue: v.optional(v.string()),
      contentsValue: v.optional(v.string()),
      businessIncomeValue: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const row = await ctx.db.get(args.locationId);
    if (!row || row.clientOrgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.locationId, args.patch);
  },
});

export const removeLocation = mutation({
  args: { locationId: v.id("passportLocations") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const row = await ctx.db.get(args.locationId);
    if (!row || row.clientOrgId !== orgId) throw new Error("Not found");
    await ctx.db.delete(args.locationId);
  },
});

// ── Subsidiaries ──────────────────────────────────────────────────────────────

export const addSubsidiary = mutation({
  args: {
    name: v.string(),
    ownershipPct: v.optional(v.number()),
    entityType: v.optional(v.string()),
    description: v.optional(v.string()),
    naicsCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    return await ctx.db.insert("passportSubsidiaries", { clientOrgId: orgId, ...args });
  },
});

export const updateSubsidiary = mutation({
  args: {
    subsidiaryId: v.id("passportSubsidiaries"),
    patch: v.object({
      name: v.optional(v.string()),
      ownershipPct: v.optional(v.number()),
      entityType: v.optional(v.string()),
      description: v.optional(v.string()),
      naicsCode: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const row = await ctx.db.get(args.subsidiaryId);
    if (!row || row.clientOrgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.subsidiaryId, args.patch);
  },
});

export const removeSubsidiary = mutation({
  args: { subsidiaryId: v.id("passportSubsidiaries") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const row = await ctx.db.get(args.subsidiaryId);
    if (!row || row.clientOrgId !== orgId) throw new Error("Not found");
    await ctx.db.delete(args.subsidiaryId);
  },
});

// ── Prior Carriers ────────────────────────────────────────────────────────────

export const addPriorCarrier = mutation({
  args: {
    lineOfBusiness: v.optional(v.string()),
    carrierName: v.optional(v.string()),
    policyNumber: v.optional(v.string()),
    effectiveDate: v.optional(v.string()),
    expirationDate: v.optional(v.string()),
    premium: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    return await ctx.db.insert("passportPriorCarriers", { clientOrgId: orgId, ...args });
  },
});

export const updatePriorCarrier = mutation({
  args: {
    carrierId: v.id("passportPriorCarriers"),
    patch: v.object({
      lineOfBusiness: v.optional(v.string()),
      carrierName: v.optional(v.string()),
      policyNumber: v.optional(v.string()),
      effectiveDate: v.optional(v.string()),
      expirationDate: v.optional(v.string()),
      premium: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const row = await ctx.db.get(args.carrierId);
    if (!row || row.clientOrgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.carrierId, args.patch);
  },
});

export const removePriorCarrier = mutation({
  args: { carrierId: v.id("passportPriorCarriers") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const row = await ctx.db.get(args.carrierId);
    if (!row || row.clientOrgId !== orgId) throw new Error("Not found");
    await ctx.db.delete(args.carrierId);
  },
});

// ── Losses ────────────────────────────────────────────────────────────────────

export const addLoss = mutation({
  args: {
    dateOfLoss: v.optional(v.string()),
    lineOfBusiness: v.optional(v.string()),
    claimNumber: v.optional(v.string()),
    description: v.optional(v.string()),
    amountPaid: v.optional(v.string()),
    amountReserved: v.optional(v.string()),
    status: v.optional(v.union(v.literal("open"), v.literal("closed"))),
    sourceDocumentId: v.optional(v.id("orgDocuments")),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    return await ctx.db.insert("passportLosses", {
      clientOrgId: orgId,
      confidence: "confirmed",
      ...args,
    });
  },
});

export const updateLoss = mutation({
  args: {
    lossId: v.id("passportLosses"),
    patch: v.object({
      dateOfLoss: v.optional(v.string()),
      lineOfBusiness: v.optional(v.string()),
      claimNumber: v.optional(v.string()),
      description: v.optional(v.string()),
      amountPaid: v.optional(v.string()),
      amountReserved: v.optional(v.string()),
      status: v.optional(v.union(v.literal("open"), v.literal("closed"))),
      confidence: v.optional(v.union(v.literal("confirmed"), v.literal("suggested"))),
    }),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const row = await ctx.db.get(args.lossId);
    if (!row || row.clientOrgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.lossId, args.patch);
  },
});

export const removeLoss = mutation({
  args: { lossId: v.id("passportLosses") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const row = await ctx.db.get(args.lossId);
    if (!row || row.clientOrgId !== orgId) throw new Error("Not found");
    await ctx.db.delete(args.lossId);
  },
});

/** Called by mapLossRunToPassportLosses action after extraction */
export const bulkFromExtraction = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    sourceDocumentId: v.id("orgDocuments"),
    losses: v.array(v.object({
      dateOfLoss: v.optional(v.string()),
      lineOfBusiness: v.optional(v.string()),
      claimNumber: v.optional(v.string()),
      description: v.optional(v.string()),
      amountPaid: v.optional(v.string()),
      amountReserved: v.optional(v.string()),
      status: v.optional(v.union(v.literal("open"), v.literal("closed"))),
    })),
  },
  handler: async (ctx, args) => {
    for (const loss of args.losses) {
      await ctx.db.insert("passportLosses", {
        clientOrgId: args.clientOrgId,
        sourceDocumentId: args.sourceDocumentId,
        confidence: "suggested",
        ...loss,
      });
    }
  },
});

/** Promote all suggested losses from a given document to confirmed */
export const bulkAcceptLosses = mutation({
  args: { sourceDocumentId: v.id("orgDocuments") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const rows = await ctx.db
      .query("passportLosses")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", orgId))
      .collect();
    const toAccept = rows.filter(
      (r) => r.sourceDocumentId === args.sourceDocumentId && r.confidence === "suggested"
    );
    for (const row of toAccept) {
      await ctx.db.patch(row._id, { confidence: "confirmed" });
    }
  },
});

// ── Additional Interests ──────────────────────────────────────────────────────

export const addAdditionalInterest = mutation({
  args: {
    name: v.string(),
    role: v.union(
      v.literal("mortgagee"),
      v.literal("loss_payee"),
      v.literal("additional_insured"),
    ),
    address: v.optional(addressArg),
    relationship: v.optional(v.string()),
    scope: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    return await ctx.db.insert("passportAdditionalInterests", { clientOrgId: orgId, ...args });
  },
});

export const updateAdditionalInterest = mutation({
  args: {
    interestId: v.id("passportAdditionalInterests"),
    patch: v.object({
      name: v.optional(v.string()),
      role: v.optional(v.union(
        v.literal("mortgagee"),
        v.literal("loss_payee"),
        v.literal("additional_insured"),
      )),
      address: v.optional(addressArg),
      relationship: v.optional(v.string()),
      scope: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const row = await ctx.db.get(args.interestId);
    if (!row || row.clientOrgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(args.interestId, args.patch);
  },
});

export const removeAdditionalInterest = mutation({
  args: { interestId: v.id("passportAdditionalInterests") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const row = await ctx.db.get(args.interestId);
    if (!row || row.clientOrgId !== orgId) throw new Error("Not found");
    await ctx.db.delete(args.interestId);
  },
});

// ── Field Provenance ──────────────────────────────────────────────────────────

export const acceptSuggestion = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    fieldPath: v.string(),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireOrgAccess(ctx);
    if (orgId !== args.clientOrgId) throw new Error("Can only accept own suggestions");
    const prov = await ctx.db
      .query("passportFieldProvenance")
      .withIndex("by_clientOrgId_fieldPath", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("fieldPath", args.fieldPath)
      )
      .first();
    if (!prov) return;
    if (prov.confidence !== "suggested") return;
    await ctx.db.patch(prov._id, {
      confidence: "confirmed",
      suggestedValue: undefined,
      setAt: Date.now(),
      setByUserId: userId,
    });
  },
});

export const dismissSuggestion = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    fieldPath: v.string(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    if (orgId !== args.clientOrgId) throw new Error("Can only dismiss own suggestions");
    const prov = await ctx.db
      .query("passportFieldProvenance")
      .withIndex("by_clientOrgId_fieldPath", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("fieldPath", args.fieldPath)
      )
      .first();
    if (prov) await ctx.db.delete(prov._id);
  },
});

// ── Upsert Provenance (internal) ──────────────────────────────────────────────

export const upsertProvenance = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    fieldPath: v.string(),
    source: v.union(
      v.literal("manual"),
      v.literal("invite"),
      v.literal("website"),
      v.literal("document"),
      v.literal("integration"),
      v.literal("broker"),
    ),
    confidence: v.union(v.literal("confirmed"), v.literal("suggested")),
    sourceRef: v.optional(v.string()),
    sourceLabel: v.optional(v.string()),
    suggestedValue: v.optional(v.any()),
    setAt: v.number(),
    setByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("passportFieldProvenance")
      .withIndex("by_clientOrgId_fieldPath", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("fieldPath", args.fieldPath)
      )
      .first();
    if (existing) {
      // Don't overwrite confirmed with suggested
      if (existing.confidence === "confirmed" && args.confidence === "suggested") return;
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("passportFieldProvenance", { ...args });
    }
  },
});
