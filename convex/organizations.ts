import { v } from "convex/values";
import { mutation, internalQuery } from "./_generated/server";
import { getOrgAccess, assertCanManageBroker, type OrgAccess } from "./lib/access";

function assertCanManageOwnOrg(access: OrgAccess) {
  if (access.accessType !== "member" || access.role !== "admin") {
    throw new Error("Admin access required");
  }
}

export const updateBrokerBranding = mutation({
  args: {
    brokerOrgId: v.id("organizations"),
    whiteLabelingEnabled: v.optional(v.boolean()),
    brandingColor: v.optional(v.string()),
    brandingMode: v.optional(v.union(v.literal("light"), v.literal("dark"))),
    brandingTextOnAccent: v.optional(
      v.union(v.literal("light"), v.literal("dark"), v.literal("auto")),
    ),
    agentDisplayName: v.optional(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.brokerOrgId);
    assertCanManageBroker(access);

    const { brokerOrgId, ...updates } = args;
    const patch: Record<string, unknown> = {};
    if (updates.whiteLabelingEnabled !== undefined)
      patch.whiteLabelingEnabled = updates.whiteLabelingEnabled;
    if (updates.brandingColor !== undefined)
      patch.brandingColor = updates.brandingColor;
    if (updates.brandingMode !== undefined)
      patch.brandingMode = updates.brandingMode;
    if (updates.brandingTextOnAccent !== undefined)
      patch.brandingTextOnAccent = updates.brandingTextOnAccent;
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

export const updateOrgLogo = mutation({
  args: {
    orgId: v.id("organizations"),
    logoStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.orgId);
    assertCanManageOwnOrg(access);
    if (access.org.iconStorageId && access.org.iconStorageId !== args.logoStorageId) {
      await ctx.storage.delete(access.org.iconStorageId).catch(() => {});
    }
    await ctx.db.patch(args.orgId, { iconStorageId: args.logoStorageId });
  },
});

export const generateOrgLogoUploadUrl = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.orgId);
    assertCanManageOwnOrg(access);
    return ctx.storage.generateUploadUrl();
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("organizations") },
  handler: async (ctx, args) => ctx.db.get(args.id),
});

export const listMembershipsForOrg = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) =>
    ctx.db.query("orgMemberships").withIndex("by_orgId", (q) => q.eq("orgId", args.orgId)).collect(),
});
