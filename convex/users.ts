import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { notify } from "./lib/notify";
import {
  normalizeAvailableUserPhone,
  normalizeUserPhone,
} from "./lib/userPhone";
import { assertCustomerUser } from "./lib/operatorIdentity";

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

export const checkPhoneAvailability = query({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    let normalized: string | undefined;
    try {
      normalized = normalizeUserPhone(args.phone);
    } catch {
      return { available: false, normalized: "" };
    }
    if (!normalized) return { available: false, normalized: "" };

    const existing = await ctx.db
      .query("users")
      .withIndex("phone", (q) => q.eq("phone", normalized))
      .first();

    return {
      available: !existing || existing._id === userId,
      current: existing?._id === userId,
      normalized,
    };
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

// Personal profile fields only — company fields live on organizations.
export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    title: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const patch: { name?: string; title?: string; phone?: string | undefined } = {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.title !== undefined) patch.title = args.title;
    if (args.phone !== undefined) {
      const normalized = await normalizeAvailableUserPhone(
        ctx,
        args.phone,
        userId,
      );
      if (normalized) {
        patch.phone = normalized;
      } else {
        patch.phone = undefined;
      }
    }
    await ctx.db.patch(userId, patch);
  },
});

export const completeOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.patch(userId, { onboardingComplete: true });

    // Also mark org as onboarded if user has one
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (membership) {
      await ctx.db.patch(membership.orgId, { onboardingComplete: true });

      // Notify broker if this is a client org
      const clientOrg = await ctx.db.get(membership.orgId);
      if (clientOrg?.type === "client" && clientOrg.brokerOrgId) {
        await notify(ctx, {
          orgId: clientOrg.brokerOrgId,
          type: "client_onboarding_completed",
          title: "Client completed onboarding",
          body: `${clientOrg.name} finished their onboarding setup.`,
          relatedOrgId: membership.orgId,
          actionType: "view_client",
          actionPayload: { clientOrgId: membership.orgId },
        });
      }
    }
  },
});

export const restartOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.patch(userId, { onboardingComplete: false });

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (membership) {
      await ctx.db.patch(membership.orgId, { onboardingComplete: false });
    }
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const findByPhone = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("phone", (q) => q.eq("phone", args.phone))
      .first();
  },
});

export const findManyByPhones = internalQuery({
  args: { phones: v.array(v.string()) },
  handler: async (ctx, args) => {
    const uniquePhones = [...new Set(args.phones)];
    const users = await Promise.all(
      uniquePhones.map((phone) =>
        ctx.db
          .query("users")
          .withIndex("phone", (q) => q.eq("phone", phone))
          .first(),
      ),
    );
    return users.filter(Boolean);
  },
});

export const listByOrgInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();
    const users = await Promise.all(
      memberships.map((m) => ctx.db.get(m.userId)),
    );
    return users.filter(Boolean);
  },
});

export const requireCustomerUserInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await assertCustomerUser(ctx, args.userId);
    return true;
  },
});

export const resetAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const user = await ctx.db.get(userId);
    if (!user?.isAdmin) throw new Error("Not authorized");

    // Get user's org
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    const orgId = membership?.orgId;

    // Delete all policies + their stored files (by org or user)
    const policies = orgId
      ? await ctx.db.query("policies").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect()
      : await ctx.db.query("policies").withIndex("by_userId", (q) => q.eq("userId", userId)).collect();
    for (const policy of policies) {
      if (policy.fileId) {
        await ctx.storage.delete(policy.fileId);
      }
      await ctx.db.delete(policy._id);
    }

    // Delete all threads and messages
    const threads = orgId
      ? await ctx.db.query("threads").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect()
      : [];
    for (const thread of threads) {
      const messages = await ctx.db
        .query("threadMessages")
        .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
        .collect();
      for (const message of messages) {
        await ctx.db.delete(message._id);
      }
      await ctx.db.delete(thread._id);
    }

    // Reset user profile fields
    await ctx.db.patch(userId, {
      onboardingComplete: false,
    });

    // Reset org if exists
    if (orgId) {
      await ctx.db.patch(orgId, {
        name: "My Organization",
        website: undefined,
        context: undefined,
        industry: undefined,
        industryVertical: undefined,
        coiHandling: undefined,
        agentHandle: undefined,
        onboardingComplete: false,
      });
    }
  },
});
