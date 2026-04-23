import { internalMutation } from "../_generated/server";

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("clientInvitations").collect();
    let patched = 0;
    for (const row of rows) {
      const r = row as unknown as Record<string, unknown>;
      if ("linkType" in r || "maxUses" in r || "acceptedCount" in r || "isPerma" in r || "rawToken" in r) {
        await ctx.db.patch(row._id, {
          linkType: undefined,
          maxUses: undefined,
          acceptedCount: undefined,
          isPerma: undefined,
          rawToken: undefined,
        } as never);
        patched++;
      }
    }
    return { scanned: rows.length, patched };
  },
});
