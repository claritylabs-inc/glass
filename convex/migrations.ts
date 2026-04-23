import { mutation } from "./_generated/server";

export const migratePolicies = mutation({
  args: {},
  handler: async (ctx) => {
    const policies = await ctx.db.query("policies").collect();
    let migrated = 0;

    for (const policy of policies) {
      const updates: Record<string, unknown> = {};

      const policyWithLegacy = policy as Record<string, unknown>;
      if (!policy.policyTypes && policyWithLegacy.policyType) {
        updates.policyTypes = [policyWithLegacy.policyType];
      } else if (!policy.policyTypes) {
        updates.policyTypes = ["other"];
      }

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
