import { mutation } from "../_generated/server";

export const migrateOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    let updated = 0;
    for (const user of users) {
      if (user.onboardingComplete === undefined) {
        await ctx.db.patch(user._id, { onboardingComplete: true });
        updated++;
      }
    }
    return { updated, total: users.length };
  },
});
