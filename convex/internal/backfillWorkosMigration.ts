// convex/internal/backfillWorkosMigration.ts
import { internalMutation } from "../_generated/server";

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    // 1) Lowercase normalize users.email; coerce undefined to nothing (leave as-is).
    const users = await ctx.db.query("users").collect();
    for (const u of users) {
      if (u.email && u.email !== u.email.toLowerCase()) {
        await ctx.db.patch(u._id, { email: u.email.toLowerCase() });
      }
    }

    // 2) Backfill orgMemberships.status = "active".
    const memberships = await ctx.db.query("orgMemberships").collect();
    for (const m of memberships) {
      if (!m.status) {
        await ctx.db.patch(m._id, { status: "active" });
      }
    }

    // 3) For each org, set primaryDomain from the admin's email domain;
    //    set domainJoinPolicy = "approval".
    const orgs = await ctx.db.query("organizations").collect();
    for (const org of orgs) {
      const patch: Record<string, unknown> = {};
      if (!org.domainJoinPolicy) patch.domainJoinPolicy = "approval";
      if (!org.primaryDomain) {
        const adminMembership = await ctx.db
          .query("orgMemberships")
          .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
          .filter((q) => q.eq(q.field("role"), "admin"))
          .first();
        if (adminMembership) {
          const admin = await ctx.db.get(adminMembership.userId);
          const email = admin?.email?.toLowerCase();
          if (email?.includes("@")) {
            patch.primaryDomain = email.split("@")[1];
          }
        }
      }

      if (Object.keys(patch).length) {
        await ctx.db.patch(org._id, patch);
      }
    }
  },
});
