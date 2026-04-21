import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { getOrgAccess, assertCanManageBroker } from "./lib/access";

export const updateBrokerBranding = mutation({
  args: {
    brokerOrgId: v.id("organizations"),
    brandingColor: v.optional(v.string()),
    agentDisplayName: v.optional(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.brokerOrgId);
    assertCanManageBroker(access);

    const { brokerOrgId, ...updates } = args;
    const patch: Record<string, unknown> = {};
    if (updates.brandingColor !== undefined)
      patch.brandingColor = updates.brandingColor;
    if (updates.agentDisplayName !== undefined)
      patch.agentDisplayName = updates.agentDisplayName;
    if (updates.logoStorageId !== undefined)
      patch.iconStorageId = updates.logoStorageId;

    await ctx.db.patch(brokerOrgId, patch);
  },
});

export const updateSlug = mutation({
  args: {
    brokerOrgId: v.id("organizations"),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.brokerOrgId);
    assertCanManageBroker(access);

    const normalized = args.slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!/^[a-z][a-z0-9-]{1,28}[a-z0-9]$/.test(normalized)) {
      throw new Error("Slug must be 3–30 lowercase alphanumeric characters or hyphens, starting with a letter.");
    }

    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", normalized))
      .first();

    if (existing && existing._id !== args.brokerOrgId) {
      throw new Error("Slug already taken.");
    }

    await ctx.db.patch(args.brokerOrgId, { slug: normalized });
    return normalized;
  },
});

export const generateLogoUploadUrl = mutation({
  args: { brokerOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.brokerOrgId);
    assertCanManageBroker(access);
    return ctx.storage.generateUploadUrl();
  },
});
