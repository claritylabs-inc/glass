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

export const checkEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    return { exists: !!user };
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

export const completeOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.patch(userId, { onboardingComplete: true });
  },
});

export const resetAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const user = await ctx.db.get(userId);
    if (!user?.isAdmin) throw new Error("Not authorized");

    // Delete all policies + their stored files
    const policies = await ctx.db
      .query("policies")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    for (const policy of policies) {
      if (policy.fileId) {
        await ctx.storage.delete(policy.fileId);
      }
      await ctx.db.delete(policy._id);
    }

    // Delete all emails
    const emails = await ctx.db
      .query("emails")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    for (const email of emails) {
      await ctx.db.delete(email._id);
    }

    // Delete all connections
    const connections = await ctx.db
      .query("emailConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    for (const conn of connections) {
      await ctx.db.delete(conn._id);
    }

    // Reset profile fields, set onboarding incomplete
    await ctx.db.patch(userId, {
      companyName: undefined,
      insuranceBroker: undefined,
      companyWebsite: undefined,
      companyContext: undefined,
      onboardingComplete: false,
    });
  },
});
