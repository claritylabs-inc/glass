import { v } from "convex/values";
import { query, mutation, internalQuery, action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ResolvedUser } from "./lib/auth";

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

// Personal profile fields only — company fields moved to org settings
export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    title: v.optional(v.string()),
    // Legacy company fields — still accepted during transition
    companyName: v.optional(v.string()),
    insuranceBroker: v.optional(v.string()),
    brokerContactName: v.optional(v.string()),
    brokerContactEmail: v.optional(v.string()),
    companyWebsite: v.optional(v.string()),
    companyContext: v.optional(v.string()),
    industry: v.optional(v.string()),
    industryVertical: v.optional(v.string()),
    coiHandling: v.optional(v.union(v.literal("broker"), v.literal("user"), v.literal("ignore"))),
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

    // Also mark org as onboarded if user has one
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (membership) {
      await ctx.db.patch(membership.orgId, { onboardingComplete: true });
    }
  },
});

// Legacy: keep for backward compat during transition
export const checkHandleAvailability = query({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const normalized = args.handle.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (normalized.length < 3 || normalized.length > 30) {
      return { available: false, normalized, reason: "Handle must be 3-30 characters" };
    }
    if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(normalized) && normalized.length > 1) {
      return { available: false, normalized, reason: "Must start with a letter and end with a letter or number" };
    }
    // Check both tables
    const existingOrg = await ctx.db
      .query("organizations")
      .withIndex("by_agentHandle", (q) => q.eq("agentHandle", normalized))
      .first();
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_agentHandle", (q) => q.eq("agentHandle", normalized))
      .first();
    const taken = !!(existingOrg || existingUser);
    return { available: !taken, normalized, reason: taken ? "Handle already taken" : undefined };
  },
});

// Legacy: keep for backward compat during transition
export const claimAgentHandle = mutation({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Prefer setting on org if user has one
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    const normalized = args.handle.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (normalized.length < 3 || normalized.length > 30) {
      throw new Error("Handle must be 3-30 characters");
    }

    const existingOrg = await ctx.db
      .query("organizations")
      .withIndex("by_agentHandle", (q) => q.eq("agentHandle", normalized))
      .first();
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_agentHandle", (q) => q.eq("agentHandle", normalized))
      .first();
    if (existingOrg || existingUser) throw new Error("Handle already taken");

    if (membership) {
      const org = await ctx.db.get(membership.orgId);
      if (org && !org.agentHandle) {
        await ctx.db.patch(membership.orgId, { agentHandle: normalized });
      }
    }
    // Also set on user for backward compat
    await ctx.db.patch(userId, { agentHandle: normalized });
    return normalized;
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

    // Delete all emails
    const emails = orgId
      ? await ctx.db.query("emails").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect()
      : await ctx.db.query("emails").withIndex("by_userId", (q) => q.eq("userId", userId)).collect();
    for (const email of emails) {
      await ctx.db.delete(email._id);
    }

    // Delete all connections
    const connections = orgId
      ? await ctx.db.query("emailConnections").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect()
      : await ctx.db.query("emailConnections").withIndex("by_userId", (q) => q.eq("userId", userId)).collect();
    for (const conn of connections) {
      await ctx.db.delete(conn._id);
    }

    // Delete all agent conversations
    const conversations = orgId
      ? await ctx.db.query("agentConversations").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect()
      : await ctx.db.query("agentConversations").withIndex("by_userId", (q) => q.eq("userId", userId)).collect();
    for (const conv of conversations) {
      await ctx.db.delete(conv._id);
    }

    // Reset user profile fields
    await ctx.db.patch(userId, {
      companyName: undefined,
      insuranceBroker: undefined,
      brokerContactName: undefined,
      brokerContactEmail: undefined,
      companyWebsite: undefined,
      companyContext: undefined,
      industry: undefined,
      industryVertical: undefined,
      coiHandling: undefined,
      agentHandle: undefined,
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
        insuranceBroker: undefined,
        brokerContactName: undefined,
        brokerContactEmail: undefined,
        coiHandling: undefined,
        agentHandle: undefined,
        onboardingComplete: false,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// WorkOS auth helpers
// ---------------------------------------------------------------------------

const CONSUMER_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com",
  "yahoo.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "pm.me",
  "live.com", "msn.com",
]);

export const _ensureCurrentUserCore = internalMutation({
  args: {
    workosUserId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
  },
  handler: async (ctx, { workosUserId, email: rawEmail, name, image }): Promise<ResolvedUser> => {
    const email = rawEmail.toLowerCase();

    // 1. Look up by workosUserId.
    let user = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
      .first();

    if (user) {
      await ctx.db.patch(user._id, { email, name, image });
    } else {
      // 2. Silent migration — match by email (no workosUserId yet).
      const legacy = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .filter((q) => q.eq(q.field("workosUserId"), undefined))
        .first();
      if (legacy) {
        await ctx.db.patch(legacy._id, { workosUserId, email, name, image });
        user = await ctx.db.get(legacy._id);
      } else {
        // 3. Brand new user.
        const userId = await ctx.db.insert("users", {
          workosUserId,
          email,
          name,
          image,
          onboardingComplete: false,
        });
        user = await ctx.db.get(userId);
      }
    }

    if (!user) throw new Error("Failed to materialize user");

    // 4. Org placement — only if user has no membership yet.
    const existingMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (existingMembership) {
      return {
        userId: user._id,
        orgId: existingMembership.orgId,
        onboardingComplete: user.onboardingComplete ?? false,
        membershipStatus: existingMembership.status ?? "active",
      };
    }

    const domain = email.split("@")[1];

    // 4a. Invite match?
    const invite = await ctx.db
      .query("orgInvitations")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (invite) {
      await ctx.db.insert("orgMemberships", {
        orgId: invite.orgId,
        userId: user._id,
        role: invite.role,
        status: "active",
      });
      await ctx.db.delete(invite._id);
      await ctx.db.patch(user._id, { onboardingComplete: true });
      return {
        userId: user._id,
        orgId: invite.orgId,
        onboardingComplete: true,
        membershipStatus: "active",
      };
    }

    // 4b. Domain policy (skip consumer domains entirely).
    if (domain && !CONSUMER_DOMAINS.has(domain)) {
      const org = await ctx.db
        .query("organizations")
        .withIndex("by_primaryDomain", (q) => q.eq("primaryDomain", domain))
        .first();
      if (org && org.domainJoinPolicy !== "off") {
        const status = org.domainJoinPolicy === "auto" ? "active" : "pending";
        await ctx.db.insert("orgMemberships", {
          orgId: org._id,
          userId: user._id,
          role: "member",
          status,
        });
        await ctx.db.patch(user._id, { onboardingComplete: true });
        return {
          userId: user._id,
          orgId: org._id,
          onboardingComplete: true,
          membershipStatus: status,
        };
      }
    }

    // 4c. New solo org.
    const orgId = await ctx.db.insert("organizations", {
      name: (name || email.split("@")[0]) + "'s Organization",
      primaryDomain: domain,
      domainJoinPolicy: "approval",
    });
    await ctx.db.insert("orgMemberships", {
      orgId,
      userId: user._id,
      role: "admin",
      status: "active",
    });
    return {
      userId: user._id,
      orgId,
      onboardingComplete: false,
      membershipStatus: "active",
    };
  },
});

/**
 * Called by the client once per sign-in, on /auth/bootstrap. Fetches the
 * authoritative WorkOS profile server-to-server (not trusting any client
 * arg), then delegates to the internal resolver.
 */
export const ensureCurrentUser = action({
  args: {},
  handler: async (ctx): Promise<ResolvedUser> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const workosUserId = identity.subject;

    const apiKey = process.env.WORKOS_API_KEY;
    if (!apiKey) throw new Error("WORKOS_API_KEY not set");

    const res = await fetch(`https://api.workos.com/user_management/users/${encodeURIComponent(workosUserId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`WorkOS user fetch failed: ${res.status} ${await res.text()}`);
    }
    const user = (await res.json()) as {
      id: string;
      email: string;
      first_name?: string | null;
      last_name?: string | null;
      profile_picture_url?: string | null;
    };

    const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || undefined;
    const image = user.profile_picture_url ?? undefined;

    return await ctx.runMutation(internal.users._ensureCurrentUserCore, {
      workosUserId,
      email: user.email,
      name,
      image,
    });
  },
});
