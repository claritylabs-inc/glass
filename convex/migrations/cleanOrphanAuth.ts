import { internalMutation } from "../_generated/server";

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.db.query("authAccounts").collect();
    let deletedAccounts = 0;
    let deletedSessions = 0;
    let deletedRefreshTokens = 0;
    let deletedVerificationCodes = 0;

    for (const account of accounts) {
      const user = await ctx.db.get(account.userId);
      if (!user) {
        // Delete dependent rows first
        const sessions = await ctx.db
          .query("authSessions")
          .withIndex("userId", (q) => q.eq("userId", account.userId))
          .collect();
        for (const s of sessions) {
          const refresh = await ctx.db
            .query("authRefreshTokens")
            .withIndex("sessionId", (q) => q.eq("sessionId", s._id))
            .collect();
          for (const r of refresh) {
            await ctx.db.delete(r._id);
            deletedRefreshTokens++;
          }
          await ctx.db.delete(s._id);
          deletedSessions++;
        }
        const codes = await ctx.db
          .query("authVerificationCodes")
          .withIndex("accountId", (q) => q.eq("accountId", account._id))
          .collect();
        for (const c of codes) {
          await ctx.db.delete(c._id);
          deletedVerificationCodes++;
        }
        await ctx.db.delete(account._id);
        deletedAccounts++;
      }
    }

    return {
      scannedAccounts: accounts.length,
      deletedAccounts,
      deletedSessions,
      deletedRefreshTokens,
      deletedVerificationCodes,
    };
  },
});
