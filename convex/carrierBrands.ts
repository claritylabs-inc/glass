import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { normalizeCarrierBrandName } from "./lib/carrierBrand";

const PENDING_LEASE_MINUTES = 10;

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
      policy?.carrierBrandStatus === "pending" &&
      policy.carrierBrandAttemptedAt !== undefined &&
      dayjs(args.attemptedAt).diff(
        dayjs(policy.carrierBrandAttemptedAt),
        "minute",
      ) < PENDING_LEASE_MINUTES;
    if (
      !policy ||
      (policy.carrierBrandStatus === "ready" && !args.allowReady) ||
      pendingIsFresh
    ) {
      return 0;
    }
    const attempts = (policy.carrierBrandAttempts ?? 0) + 1;
    await ctx.db.patch(args.policyId, {
      carrierBrandStatus: "pending",
      carrierBrandAttempts: attempts,
      carrierBrandAttemptedAt: args.attemptedAt,
    });
    return attempts;
  },
});

export const markPolicyFailedInternal = internalMutation({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy || policy.carrierBrandStatus === "ready") return false;
    await ctx.db.patch(args.policyId, {
      carrierBrandId: undefined,
      carrierBrandStatus: "failed",
    });
    return true;
  },
});

export const upsertInternal = internalMutation({
  args: {
    normalizedName: v.string(),
    carrierName: v.string(),
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
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("carrierBrands", args);
  },
});

export const linkPolicyInternal = internalMutation({
  args: {
    policyId: v.id("policies"),
    carrierBrandId: v.id("carrierBrands"),
    normalizedName: v.string(),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy) return false;
    const currentNames = [
      policy.insurer?.legalName,
      policy.carrierLegalName,
      policy.carrier,
      policy.security,
    ]
      .filter((name): name is string => typeof name === "string")
      .map(normalizeCarrierBrandName);
    if (!currentNames.includes(args.normalizedName)) return false;
    await ctx.db.patch(args.policyId, {
      carrierBrandId: args.carrierBrandId,
      carrierBrandStatus: "ready",
    });
    return true;
  },
});
