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

/** Fix application sessions with invalid confidence values in extractedFields.
 *  Normalizes any confidence value that isn't "confirmed" to "inferred".
 *  Run: npx convex run migrations:fixApplicationConfidence */
export const fixApplicationConfidence = mutation({
  args: {},
  handler: async (ctx) => {
    const sessions = await ctx.db.query("applicationSessions").collect();
    let fixed = 0;

    for (const session of sessions) {
      if (!session.extractedFields) continue;
      try {
        const fields = JSON.parse(session.extractedFields);
        let changed = false;
        for (const field of fields) {
          if (field.confidence && field.confidence !== "confirmed" && field.confidence !== "inferred") {
            field.confidence = "inferred";
            changed = true;
          }
        }
        if (changed) {
          await ctx.db.patch(session._id, {
            extractedFields: JSON.stringify(fields),
          });
          fixed++;
        }
      } catch {
        // skip unparseable
      }
    }

    return `Fixed confidence values in ${fixed} of ${sessions.length} sessions`;
  },
});
