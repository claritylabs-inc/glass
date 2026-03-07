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
  args: {
    id: v.id("emailConnections"),
    deletePolicies: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Find all emails for this connection
    const emails = await ctx.db
      .query("emails")
      .withIndex("by_connection_processed", (idx) =>
        idx.eq("connectionId", args.id)
      )
      .collect();
    const emailIds = new Set(emails.map((e) => e._id));

    if (args.deletePolicies) {
      // Delete policies linked to these emails
      const allPolicies = await ctx.db.query("policies").collect();
      for (const policy of allPolicies) {
        if (policy.emailId && emailIds.has(policy.emailId)) {
          await ctx.db.delete(policy._id);
        }
      }
    }

    // Delete emails
    for (const email of emails) {
      await ctx.db.delete(email._id);
    }

    // Delete the connection itself
    await ctx.db.delete(args.id);
  },
});

export const countLinkedPolicies = query({
  args: { id: v.id("emailConnections") },
  handler: async (ctx, args) => {
    const emails = await ctx.db
      .query("emails")
      .withIndex("by_connection_processed", (idx) =>
        idx.eq("connectionId", args.id)
      )
      .collect();
    const emailIds = new Set(emails.map((e) => e._id));

    const allPolicies = await ctx.db.query("policies").collect();
    const linked = allPolicies.filter(
      (p) => p.emailId && emailIds.has(p.emailId) && p.extractionStatus === "complete"
    );

    return { emailCount: emails.length, policyCount: linked.length };
  },
});
