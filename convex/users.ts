import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});

export const seedUsers = mutation({
  args: {
    users: v.array(
      v.object({
        email: v.string(),
        name: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const created: string[] = [];
    for (const u of args.users) {
      // Skip if user with this email already exists
      const existing = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", u.email))
        .first();
      if (existing) {
        created.push(`${u.email} (already exists: ${existing._id})`);
        continue;
      }
      const id = await ctx.db.insert("users", {
        email: u.email,
        name: u.name,
        emailVerificationTime: Date.now(),
      });
      created.push(`${u.email} (${id})`);
    }
    return created;
  },
});

export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    companyName: v.optional(v.string()),
    insuranceBroker: v.optional(v.string()),
    companyWebsite: v.optional(v.string()),
    companyContext: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.patch(userId, args);
  },
});
