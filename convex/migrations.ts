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
