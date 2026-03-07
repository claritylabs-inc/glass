import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("emailConnections").collect();
  },
});

export const get = query({
  args: { id: v.id("emailConnections") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    label: v.string(),
    imapHost: v.string(),
    imapPort: v.number(),
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("emailConnections", {
      ...args,
    });
  },
});

export const updateScanStatus = mutation({
  args: {
    id: v.id("emailConnections"),
    lastScanStatus: v.union(
      v.literal("scanning"),
      v.literal("success"),
      v.literal("error")
    ),
    lastScanAt: v.optional(v.number()),
    lastScanError: v.optional(v.string()),
    emailsFound: v.optional(v.number()),
    policiesExtracted: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const remove = mutation({
  args: { id: v.id("emailConnections") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
