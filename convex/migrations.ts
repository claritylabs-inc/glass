import { v } from "convex/values";
import { mutation } from "./_generated/server";

export const migratePolicies = mutation({
  args: {},
  handler: async (ctx) => {
    const policies = await ctx.db.query("policies").collect();
    let migrated = 0;

    for (const policy of policies) {
      const updates: Record<string, any> = {};

      // Migrate policyType → policyTypes
      if (!policy.policyTypes && (policy as any).policyType) {
        updates.policyTypes = [(policy as any).policyType];
      } else if (!policy.policyTypes) {
        updates.policyTypes = ["other"];
      }

      // Add documentType if missing
      if (!policy.documentType) {
        updates.documentType = "policy";
      }

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(policy._id, updates);
        migrated++;
      }
    }

    return `Migrated ${migrated} of ${policies.length} policies`;
  },
});

export const migrateUserId = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    let migrated = 0;

    // Migrate emailConnections
    const connections = await ctx.db.query("emailConnections").collect();
    for (const conn of connections) {
      if (!conn.userId) {
        await ctx.db.patch(conn._id, { userId: args.userId });
        migrated++;
      }
    }

    // Migrate emails
    const emails = await ctx.db.query("emails").collect();
    for (const email of emails) {
      if (!email.userId) {
        await ctx.db.patch(email._id, { userId: args.userId });
        migrated++;
      }
    }

    // Migrate policies
    const policies = await ctx.db.query("policies").collect();
    for (const policy of policies) {
      if (!policy.userId) {
        await ctx.db.patch(policy._id, { userId: args.userId });
        migrated++;
      }
    }

    return `Assigned userId to ${migrated} records`;
  },
});
