import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getOrgAccess, requireAuth } from "./lib/access";

function publicOrg(org: Doc<"organizations">) {
  return {
    _id: org._id,
    name: org.name,
    website: org.website,
    industry: org.industry,
    industryVertical: org.industryVertical,
    context: org.context,
    type: org.type ?? "client",
  };
}

async function requireOrgAdmin(ctx: QueryCtx | MutationCtx, orgId: Id<"organizations">) {
  const access = await getOrgAccess(ctx, orgId);
  if (access.accessType !== "member" || access.role !== "admin") {
    throw new Error("Admin role required");
  }
  return access;
}

async function enrichRelationship(ctx: QueryCtx, rel: Doc<"connectedOrgRelationships">) {
  const [clientOrg, vendorOrg] = await Promise.all([
    ctx.db.get(rel.clientOrgId),
    ctx.db.get(rel.vendorOrgId),
  ]);
  return {
    ...rel,
    clientOrg: clientOrg ? publicOrg(clientOrg) : null,
    vendorOrg: vendorOrg ? publicOrg(vendorOrg) : null,
  };
}

/** List vendor orgs this org can access, plus pending/revoked requests it created. */
export const listVendors = query({
  args: { orgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const memberships = args.orgId
      ? [{ orgId: args.orgId }]
      : await ctx.db
          .query("orgMemberships")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .collect();

    const rows = [];
    for (const membership of memberships) {
      const access = await getOrgAccess(ctx, membership.orgId);
      if (access.accessType !== "member") continue;
      const relationships = await ctx.db
        .query("connectedOrgRelationships")
        .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", membership.orgId))
        .collect();
      for (const rel of relationships) rows.push(await enrichRelationship(ctx, rel));
    }
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/** List client/customer orgs requesting or holding access to this vendor org. */
export const listClients = query({
  args: { orgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const memberships = args.orgId
      ? [{ orgId: args.orgId }]
      : await ctx.db
          .query("orgMemberships")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .collect();

    const rows = [];
    for (const membership of memberships) {
      const access = await getOrgAccess(ctx, membership.orgId);
      if (access.accessType !== "member") continue;
      const relationships = await ctx.db
        .query("connectedOrgRelationships")
        .withIndex("by_vendorOrgId", (q) => q.eq("vendorOrgId", membership.orgId))
        .collect();
      for (const rel of relationships) rows.push(await enrichRelationship(ctx, rel));
    }
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const requestVendorAccess = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    vendorOrgId: v.id("organizations"),
    relationshipLabel: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.clientOrgId);
    if (access.accessType !== "member" || access.role !== "admin") {
      throw new Error("Admin role required to request vendor access");
    }
    if (args.clientOrgId === args.vendorOrgId) throw new Error("Cannot connect an org to itself");
    const vendor = await ctx.db.get(args.vendorOrgId);
    if (!vendor) throw new Error("Vendor organization not found");

    const existing = await ctx.db
      .query("connectedOrgRelationships")
      .withIndex("by_clientOrgId_vendorOrgId", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("vendorOrgId", args.vendorOrgId),
      )
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: existing.status === "active" ? "active" : "pending",
        relationshipLabel: args.relationshipLabel,
        note: args.note,
        requestedByUserId: access.userId,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("connectedOrgRelationships", {
      clientOrgId: args.clientOrgId,
      vendorOrgId: args.vendorOrgId,
      status: "pending",
      requestedByUserId: access.userId,
      relationshipLabel: args.relationshipLabel,
      note: args.note,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const approve = mutation({
  args: { relationshipId: v.id("connectedOrgRelationships") },
  handler: async (ctx, args) => {
    const rel = await ctx.db.get(args.relationshipId);
    if (!rel) throw new Error("Connection request not found");
    const access = await requireOrgAdmin(ctx, rel.vendorOrgId);
    await ctx.db.patch(args.relationshipId, {
      status: "active",
      approvedByUserId: access.userId,
      updatedAt: Date.now(),
    });
  },
});

export const revoke = mutation({
  args: { relationshipId: v.id("connectedOrgRelationships") },
  handler: async (ctx, args) => {
    const rel = await ctx.db.get(args.relationshipId);
    if (!rel) throw new Error("Connection not found");
    const { userId } = await requireAuth(ctx);
    const clientMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) => q.eq("orgId", rel.clientOrgId).eq("userId", userId))
      .first();
    const vendorMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) => q.eq("orgId", rel.vendorOrgId).eq("userId", userId))
      .first();
    if (clientMembership?.role !== "admin" && vendorMembership?.role !== "admin") {
      throw new Error("Admin role required to revoke a connection");
    }
    await ctx.db.patch(args.relationshipId, {
      status: "revoked",
      revokedByUserId: userId,
      updatedAt: Date.now(),
    });
  },
});

export const listActiveVendorsInternal = internalQuery({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const relationships = await ctx.db
      .query("connectedOrgRelationships")
      .withIndex("by_clientOrgId_status", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("status", "active"),
      )
      .collect();
    return await Promise.all(relationships.map((rel) => enrichRelationship(ctx, rel)));
  },
});

export const hasActiveConnectionInternal = internalQuery({
  args: { clientOrgId: v.id("organizations"), vendorOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const rel = await ctx.db
      .query("connectedOrgRelationships")
      .withIndex("by_clientOrgId_vendorOrgId", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("vendorOrgId", args.vendorOrgId),
      )
      .first();
    return !!rel && rel.status === "active";
  },
});
