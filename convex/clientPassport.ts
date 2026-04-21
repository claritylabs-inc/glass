import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { requireOrgAccess, getOrgAccess } from "./lib/orgAuth";
import {
  getRequiredSections,
  buildPassportFact,
  fieldToIntelligenceCategory,
} from "./lib/passportIntelligence";
import { resolveCompletionStatus } from "./lib/passportCompletion";

// ── Queries ───────────────────────────────────────────────────────────────────

/** Returns the passport record for the calling user's org (client) or for a
 *  connected client org (broker). Returns null if none exists yet. */
export const getFull = query({
  args: { clientOrgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return null;

    const targetOrgId = args.clientOrgId ?? access.orgId;

    // If accessing another org's passport, verify broker-client relationship
    if (targetOrgId !== access.orgId) {
      const link = await ctx.db
        .query("brokerClientAssignments")
        .withIndex("by_orgId_clientOrgId", (q) =>
          q.eq("orgId", access.orgId).eq("clientOrgId", targetOrgId)
        )
        .first();
      if (!link) throw new Error("No access to this client's passport");
    }

    const passport = await ctx.db
      .query("clientPassport")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", targetOrgId))
      .first();

    const provenance = await ctx.db
      .query("passportFieldProvenance")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", targetOrgId))
      .collect();

    const locations = await ctx.db
      .query("passportLocations")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", targetOrgId))
      .collect();

    const subsidiaries = await ctx.db
      .query("passportSubsidiaries")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", targetOrgId))
      .collect();

    const priorCarriers = await ctx.db
      .query("passportPriorCarriers")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", targetOrgId))
      .collect();

    const losses = await ctx.db
      .query("passportLosses")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", targetOrgId))
      .collect();

    const additionalInterests = await ctx.db
      .query("passportAdditionalInterests")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", targetOrgId))
      .collect();

    return {
      passport,
      provenance,
      locations,
      subsidiaries,
      priorCarriers,
      losses,
      additionalInterests,
    };
  },
});

export const getCompletionStatus = query({
  args: { clientOrgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const access = await requireOrgAccess(ctx);
    const targetOrgId = args.clientOrgId ?? access.orgId;

    const passport = await ctx.db
      .query("clientPassport")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", targetOrgId))
      .first();

    if (!passport) {
      return { core: false, requiredExtras: false, missingSections: [] };
    }

    // Determine which extended sections have at least one row
    const [carriers, losses, interests] = await Promise.all([
      ctx.db.query("passportPriorCarriers").withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", targetOrgId)).first(),
      ctx.db.query("passportLosses").withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", targetOrgId)).first(),
      ctx.db.query("passportAdditionalInterests").withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", targetOrgId)).first(),
    ]);

    const completedExtras: string[] = [];
    if (carriers) completedExtras.push("prior_carrier");
    if (losses) completedExtras.push("loss_history");
    if (interests) completedExtras.push("additional_interests");
    if (passport.desiredEffectiveDate || passport.desiredLinesOfBusiness?.length) {
      completedExtras.push("transaction_info");
    }

    // Get broker org to resolve requirements
    const clientOrg = await ctx.db.get(targetOrgId);
    // Try to find connected broker org via brokerClientAssignments
    const assignment = await ctx.db
      .query("brokerClientAssignments")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", targetOrgId))
      .first()
      .catch(() => null);
    const brokerOrg = assignment ? await ctx.db.get(assignment.orgId) : null;

    const required = getRequiredSections(
      clientOrg ?? ({} as any),
      brokerOrg ?? ({} as any)
    );

    return resolveCompletionStatus(
      { ...passport, _completedExtras: completedExtras },
      required
    );
  },
});

export const getRequiredSectionsQuery = query({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const clientOrg = await ctx.db.get(args.clientOrgId);
    if (!clientOrg) return [];
    const assignment = await ctx.db
      .query("brokerClientAssignments")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", args.clientOrgId))
      .first()
      .catch(() => null);
    const brokerOrg = assignment ? await ctx.db.get(assignment.orgId) : null;
    return getRequiredSections(clientOrg, brokerOrg ?? ({} as any));
  },
});

// ── Mutations ─────────────────────────────────────────────────────────────────

const corePatch = {
  // Applicant info
  legalName: v.optional(v.string()),
  dba: v.optional(v.string()),
  entityType: v.optional(v.string()),
  fein: v.optional(v.string()),
  website: v.optional(v.string()),
  primaryContactName: v.optional(v.string()),
  primaryContactTitle: v.optional(v.string()),
  primaryContactEmail: v.optional(v.string()),
  primaryContactPhone: v.optional(v.string()),
  mailingAddress: v.optional(v.object({
    street1: v.string(),
    street2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zip: v.optional(v.string()),
    country: v.optional(v.string()),
  })),
  // Nature of business
  businessDescription: v.optional(v.string()),
  naicsCode: v.optional(v.string()),
  sicCode: v.optional(v.string()),
  yearsInBusiness: v.optional(v.number()),
  yearEstablished: v.optional(v.number()),
  numberOfEmployees: v.optional(v.number()),
  annualRevenue: v.optional(v.string()),
  operationsSummary: v.optional(v.string()),
  // General info
  hasPriorBankruptcy: v.optional(v.boolean()),
  bankruptcyDetails: v.optional(v.string()),
  hasPriorCancellation: v.optional(v.boolean()),
  cancellationDetails: v.optional(v.string()),
  hasForeignOperations: v.optional(v.boolean()),
  foreignOperationsDetails: v.optional(v.string()),
  ownershipNotes: v.optional(v.string()),
  // Completion flag
  markCoreComplete: v.optional(v.boolean()),
};

export const upsertCore = mutation({
  args: { patch: v.object(corePatch) },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const now = Date.now();
    const { markCoreComplete, ...fields } = args.patch;

    const existing = await ctx.db
      .query("clientPassport")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", orgId))
      .first();

    const coreCompletedAt = markCoreComplete
      ? (existing?.coreCompletedAt ?? now)
      : existing?.coreCompletedAt;

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...fields,
        ...(coreCompletedAt !== undefined && { coreCompletedAt }),
        lastEditedAt: now,
        lastEditedBy: userId,
      });
    } else {
      await ctx.db.insert("clientPassport", {
        clientOrgId: orgId,
        ...fields,
        ...(coreCompletedAt !== undefined && { coreCompletedAt }),
        lastEditedAt: now,
        lastEditedBy: userId,
      });
    }

    // Fan out confirmed string fields to orgIntelligence
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null || typeof value === "object") continue;
      const content = buildPassportFact(key, value);
      const category = fieldToIntelligenceCategory(key);
      const existingIntel = await ctx.db
        .query("orgIntelligence")
        .withIndex("by_orgId_source", (q) =>
          q.eq("orgId", orgId).eq("source", "application")
        )
        .filter((q) => q.eq(q.field("sourceRef"), `passport:${key}`))
        .first();
      if (existingIntel) {
        await ctx.db.patch(existingIntel._id, {
          content,
          asOfDate: new Date(now).toISOString().split("T")[0],
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("orgIntelligence", {
          orgId,
          content,
          category: category as any,
          confidence: "confirmed",
          source: "application",
          sourceRef: `passport:${key}`,
          sourceLabel: "Client Passport",
          asOfDate: new Date(now).toISOString().split("T")[0],
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  },
});

export const upsertTransactionInfo = mutation({
  args: {
    patch: v.object({
      desiredEffectiveDate: v.optional(v.string()),
      desiredPolicyTerm: v.optional(v.string()),
      desiredLinesOfBusiness: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAccess(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("clientPassport")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", orgId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args.patch,
        lastEditedAt: now,
        lastEditedBy: userId,
      });
    } else {
      await ctx.db.insert("clientPassport", {
        clientOrgId: orgId,
        ...args.patch,
        lastEditedAt: now,
        lastEditedBy: userId,
      });
    }
  },
});

// ── Org requirement config mutations ─────────────────────────────────────────

export const setDefaultRequiredPassportSections = mutation({
  args: {
    brokerOrgId: v.id("organizations"),
    sections: v.array(v.union(
      v.literal("prior_carrier"),
      v.literal("loss_history"),
      v.literal("additional_interests"),
      v.literal("transaction_info"),
    )),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    if (orgId !== args.brokerOrgId) throw new Error("Can only update own org");
    await ctx.db.patch(args.brokerOrgId, {
      defaultRequiredPassportSections: args.sections,
    });
  },
});

export const setPassportRequirementOverrides = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    sections: v.array(v.union(
      v.literal("prior_carrier"),
      v.literal("loss_history"),
      v.literal("additional_interests"),
      v.literal("transaction_info"),
    )),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    // Broker must have access to this client
    const link = await ctx.db
      .query("brokerClientAssignments")
      .withIndex("by_orgId_clientOrgId", (q) =>
        q.eq("orgId", orgId).eq("clientOrgId", args.clientOrgId)
      )
      .first()
      .catch(() => null);
    if (!link) throw new Error("No access to this client org");
    await ctx.db.patch(args.clientOrgId, {
      passportRequirementOverrides: args.sections,
    });
  },
});

// ── Internal mutations ────────────────────────────────────────────────────────

export const upsertCoreInternal = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    patch: v.any(),
    actorUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("clientPassport")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", args.clientOrgId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args.patch,
        lastEditedAt: now,
        lastEditedBy: args.actorUserId,
      });
    } else {
      await ctx.db.insert("clientPassport", {
        clientOrgId: args.clientOrgId,
        ...args.patch,
        lastEditedAt: now,
        lastEditedBy: args.actorUserId,
      });
    }
  },
});
