import { v } from "convex/values";
import { query } from "./_generated/server";
import { getOrgAccess, assertBrokerOrg } from "./lib/access";

export const listPortfolio = query({
  args: {
    brokerOrgId: v.id("organizations"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    typeFilter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.brokerOrgId);
    assertBrokerOrg(access);

    const limit = args.limit ?? 50;
    const events = await ctx.db
      .query("brokerActivity")
      .withIndex("by_brokerOrgId_createdAt", (q) =>
        q.eq("brokerOrgId", args.brokerOrgId),
      )
      .order("desc")
      .take(limit);

    const filtered = args.typeFilter
      ? events.filter((e) => e.type === args.typeFilter)
      : events;

    // Attach client org names for portfolio display
    const clientOrgIds = [...new Set(filtered.map((e) => e.clientOrgId))];
    const orgs = await Promise.all(clientOrgIds.map((id) => ctx.db.get(id)));
    const orgMap = Object.fromEntries(
      orgs.filter(Boolean).map((o) => [o!._id, o!.name]),
    );

    return filtered.map((e) => ({
      ...e,
      clientOrgName: orgMap[e.clientOrgId] ?? "Unknown client",
    }));
  },
});

export const listForClient = query({
  args: {
    brokerOrgId: v.id("organizations"),
    clientOrgId: v.id("organizations"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    typeFilter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const brokerAccess = await getOrgAccess(ctx, args.brokerOrgId);
    assertBrokerOrg(brokerAccess);

    const limit = args.limit ?? 50;
    const events = await ctx.db
      .query("brokerActivity")
      .withIndex("by_brokerOrgId_clientOrgId_createdAt", (q) =>
        q
          .eq("brokerOrgId", args.brokerOrgId)
          .eq("clientOrgId", args.clientOrgId),
      )
      .order("desc")
      .take(limit);

    return args.typeFilter
      ? events.filter((e) => e.type === args.typeFilter)
      : events;
  },
});
