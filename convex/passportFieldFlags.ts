import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgAccess } from "./lib/orgAuth";

export const listForClient = query({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await requireOrgAccess(ctx);
    // Either the client themselves, or a connected broker
    const isSelf = access.orgId === args.clientOrgId;
    const link = isSelf
      ? null
      : await ctx.db
          .query("brokerClientAssignments")
          .withIndex("by_orgId_clientOrgId", (q) =>
            q.eq("orgId", access.orgId).eq("clientOrgId", args.clientOrgId)
          )
          .first()
          .catch(() => null);
    if (!isSelf && !link) throw new Error("No access to this client's flags");

    return await ctx.db
      .query("passportFieldFlags")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", args.clientOrgId))
      .collect();
  },
});

export const create = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    fieldPath: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireOrgAccess(ctx);
    // Only broker orgs that have access to this client can create flags
    const link = await ctx.db
      .query("brokerClientAssignments")
      .withIndex("by_orgId_clientOrgId", (q) =>
        q.eq("orgId", orgId).eq("clientOrgId", args.clientOrgId)
      )
      .first()
      .catch(() => null);
    if (!link) throw new Error("Only the client's broker can create flags");

    return await ctx.db.insert("passportFieldFlags", {
      clientOrgId: args.clientOrgId,
      brokerOrgId: orgId,
      fieldPath: args.fieldPath,
      authorUserId: userId,
      message: args.message,
      status: "open",
      createdAt: Date.now(),
    });
  },
});

export const updateStatus = mutation({
  args: {
    flagId: v.id("passportFieldFlags"),
    status: v.union(v.literal("resolved"), v.literal("dismissed")),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireOrgAccess(ctx);
    const flag = await ctx.db.get(args.flagId);
    if (!flag) throw new Error("Flag not found");
    // Either the client org or the broker org can resolve/dismiss
    const isClient = flag.clientOrgId === orgId;
    const isBroker = flag.brokerOrgId === orgId;
    if (!isClient && !isBroker) throw new Error("Access denied");
    await ctx.db.patch(args.flagId, {
      status: args.status,
      resolvedByUserId: userId,
      resolvedAt: Date.now(),
    });
  },
});
