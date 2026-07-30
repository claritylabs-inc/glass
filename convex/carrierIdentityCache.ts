import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { normalizeCarrierIdentityName } from "./lib/carrierIdentityEnrichment";
import {
  applyCarrierIdentityEnrichment,
  readCarrierIdentity,
} from "./lib/carrierIdentity";

const PENDING_LEASE_MINUTES = 10;

function normalizedPolicyCarrierNames(policy: Doc<"policies">) {
  const identity = readCarrierIdentity(policy.carrierIdentity);
  return (identity
    ? [
        identity.sourceName,
        identity.displayName,
        identity.operatingName,
        ...identity.legalEntities.map((entity) => entity.name),
      ]
    : [
        policy.carrier,
        policy.insurer?.legalName,
        policy.carrierLegalName,
        policy.security,
      ])
    .filter((name): name is string => typeof name === "string")
    .map(normalizeCarrierIdentityName);
}

export const getByNormalizedNameInternal = internalQuery({
  args: { normalizedName: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("carrierBrands")
      .withIndex("by_normalizedName", (query) =>
        query.eq("normalizedName", args.normalizedName),
      )
      .first();
  },
});

export const markPolicyPendingInternal = internalMutation({
  args: {
    policyId: v.id("policies"),
    attemptedAt: v.number(),
    allowReady: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    const pendingIsFresh =
      policy?.carrierIdentityEnrichmentStatus === "pending" &&
      policy.carrierIdentityEnrichmentAttemptedAt !== undefined &&
      dayjs(args.attemptedAt).diff(
        dayjs(policy.carrierIdentityEnrichmentAttemptedAt),
        "minute",
      ) < PENDING_LEASE_MINUTES;
    if (
      !policy ||
      (policy.carrierIdentityEnrichmentStatus === "ready" &&
        !args.allowReady) ||
      pendingIsFresh
    ) {
      return 0;
    }
    const attempts = (policy.carrierIdentityEnrichmentAttempts ?? 0) + 1;
    await ctx.db.patch(args.policyId, {
      carrierIdentityEnrichmentStatus: "pending",
      carrierIdentityEnrichmentAttempts: attempts,
      carrierIdentityEnrichmentAttemptedAt: args.attemptedAt,
    });
    return attempts;
  },
});

export const markPolicyFailedInternal = internalMutation({
  args: {
    policyId: v.id("policies"),
    normalizedName: v.optional(v.string()),
    attemptedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy) return { status: "not_found" as const };
    if (policy.carrierIdentityEnrichmentStatus === "ready") {
      return { status: "ready" as const };
    }
    if (
      args.normalizedName &&
      !normalizedPolicyCarrierNames(policy).includes(args.normalizedName)
    ) {
      if (
        args.attemptedAt === undefined ||
        policy.carrierIdentityEnrichmentAttemptedAt === args.attemptedAt
      ) {
        await ctx.db.patch(args.policyId, {
          carrierIdentityEnrichmentStatus: undefined,
          carrierIdentityEnrichmentAttempts: undefined,
          carrierIdentityEnrichmentAttemptedAt: undefined,
        });
      }
      return { status: "identity_changed" as const };
    }
    if (
      args.attemptedAt !== undefined &&
      (policy.carrierIdentityEnrichmentStatus !== "pending" ||
        policy.carrierIdentityEnrichmentAttemptedAt !== args.attemptedAt)
    ) {
      return { status: "superseded" as const };
    }
    await ctx.db.patch(args.policyId, {
      carrierIdentityEnrichmentStatus: "failed",
    });
    return { status: "failed" as const };
  },
});

export const upsertInternal = internalMutation({
  args: {
    normalizedName: v.string(),
    carrierName: v.string(),
    publicName: v.optional(v.string()),
    nameRelationship: v.optional(
      v.union(
        v.literal("same_legal_entity"),
        v.literal("trading_name"),
        v.literal("parent_brand"),
        v.literal("group_brand"),
      ),
    ),
    website: v.string(),
    websiteTitle: v.optional(v.string()),
    iconStorageId: v.optional(v.id("_storage")),
    accentColor: v.string(),
    confidence: v.union(
      v.literal("high"),
      v.literal("medium"),
      v.literal("low"),
    ),
    sourceUrls: v.array(v.string()),
    enrichmentVersion: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("carrierBrands")
      .withIndex("by_normalizedName", (query) =>
        query.eq("normalizedName", args.normalizedName),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        publicName: args.publicName,
        nameRelationship: args.nameRelationship,
        websiteTitle: args.websiteTitle,
        iconStorageId: args.iconStorageId,
      });
      return existing._id;
    }
    return await ctx.db.insert("carrierBrands", args);
  },
});

export const applyToPolicyInternal = internalMutation({
  args: {
    policyId: v.id("policies"),
    cacheEntryId: v.id("carrierBrands"),
    normalizedName: v.string(),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy) return { applied: false, identityChanged: false };
    const cacheEntry = await ctx.db.get(args.cacheEntryId);
    if (!cacheEntry) return { applied: false, identityChanged: false };
    const identity = readCarrierIdentity(policy.carrierIdentity);
    const currentNames = normalizedPolicyCarrierNames(policy);
    if (!currentNames.includes(args.normalizedName)) {
      await ctx.db.patch(args.policyId, {
        carrierIdentityEnrichmentStatus: undefined,
        carrierIdentityEnrichmentAttempts: undefined,
        carrierIdentityEnrichmentAttemptedAt: undefined,
      });
      return { applied: false, identityChanged: true };
    }
    if (!identity) return { applied: false, identityChanged: false };

    const carrierIdentity = applyCarrierIdentityEnrichment(identity, {
      publicName: cacheEntry.publicName,
      nameRelationship: cacheEntry.nameRelationship,
      website: cacheEntry.website,
      websiteTitle: cacheEntry.websiteTitle,
      iconStorageId: cacheEntry.iconStorageId,
      accentColor: cacheEntry.accentColor,
      confidence: cacheEntry.confidence,
      sourceUrls: cacheEntry.sourceUrls,
      enrichmentVersion: cacheEntry.enrichmentVersion ?? 0,
      updatedAt: cacheEntry.updatedAt,
    });
    await ctx.db.patch(args.policyId, {
      carrier: carrierIdentity.displayName,
      carrierIdentity,
      carrierIdentityEnrichmentStatus: "ready",
      carrierIdentityEnrichmentAttempts: undefined,
      carrierIdentityEnrichmentAttemptedAt: undefined,
      carrierBrandId: undefined,
      carrierBrandStatus: undefined,
      carrierBrandAttempts: undefined,
      carrierBrandAttemptedAt: undefined,
    });
    return { applied: true, identityChanged: false };
  },
});
