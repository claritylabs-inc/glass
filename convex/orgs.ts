import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { requireOrgAccess, requireOrgAdmin, getOrgAccess } from "./lib/orgAuth";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getOrgAccess as getOrgAccessNew, assertBrokerOrg } from "./lib/access";

// ── Queries ──

export const viewerOrg = query({
  args: {
    // Optional orgId — if provided, returns that specific org (for multi-org users)
    orgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    let membership;
    if (args.orgId) {
      membership = await ctx.db
        .query("orgMemberships")
        .withIndex("by_orgId_userId", (q) => q.eq("orgId", args.orgId!).eq("userId", userId))
        .first();
    } else {
      membership = await ctx.db
        .query("orgMemberships")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .first();
    }

    if (!membership) return null;

    const org = await ctx.db.get(membership.orgId);
    if (!org) return null;

    const iconUrl = org.iconStorageId ? await ctx.storage.getUrl(org.iconStorageId) : null;

    return { org: { ...org, iconUrl }, membership };
  },
});

export const listMembers = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireOrgAccess(ctx);

    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const members = await Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return {
          membershipId: m._id,
          userId: m.userId,
          role: m.role,
          name: user?.name,
          email: user?.email,
          title: user?.title,
        };
      }),
    );

    return members;
  },
});

export const listInvitations = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const { orgId } = access;

    return await ctx.db
      .query("orgInvitations")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
  },
});

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
    // Check organizations table
    const existingOrg = await ctx.db
      .query("organizations")
      .withIndex("by_agentHandle", (q) => q.eq("agentHandle", normalized))
      .first();
    // Also check legacy users table for transition period
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_agentHandle", (q) => q.eq("agentHandle", normalized))
      .first();
    const taken = !!(existingOrg || existingUser);
    return { available: !taken, normalized, reason: taken ? "Handle already taken" : undefined };
  },
});

/** Check if a broker slug is available. No auth required. */
export const checkSlugAvailability = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const normalized = args.slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (normalized.length < 3 || normalized.length > 40) {
      return { available: false, normalized, reason: "Slug must be 3-40 characters" };
    }
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(normalized) && normalized.length > 1) {
      return { available: false, normalized, reason: "Slug must start and end with a letter or number" };
    }
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", normalized))
      .first();
    return {
      available: !existing,
      normalized,
      reason: existing ? "Slug already taken" : undefined,
    };
  },
});

/** Check if an email has a pending (non-expired) invitation. No auth required. */
export const checkPendingInvitation = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    // Check both original case and lowercase since invitations may be stored either way
    const byOriginal = await ctx.db
      .query("orgInvitations")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .collect();
    const byLower = args.email !== args.email.toLowerCase()
      ? await ctx.db
          .query("orgInvitations")
          .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
          .collect()
      : [];
    const all = [...byOriginal, ...byLower];
    const pending = all.find(
      (i) => i.status === "pending" && i.expiresAt > Date.now(),
    );
    return { hasPendingInvitation: !!pending };
  },
});

/** Get pending invitation details for the current user (with org info). */
export const pendingInvitationForViewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const user = await ctx.db.get(userId);
    if (!user?.email) return null;

    // Check both original case and lowercase
    const byOriginal = await ctx.db
      .query("orgInvitations")
      .withIndex("by_email", (q) => q.eq("email", user.email!))
      .collect();
    const lowerEmail = user.email!.toLowerCase();
    const byLower = user.email !== lowerEmail
      ? await ctx.db
          .query("orgInvitations")
          .withIndex("by_email", (q) => q.eq("email", lowerEmail))
          .collect()
      : [];
    const all = [...byOriginal, ...byLower];
    const pending = all.find(
      (i) => i.status === "pending" && i.expiresAt > Date.now(),
    );
    if (!pending) return null;

    const org = await ctx.db.get(pending.orgId);
    if (!org) return null;

    const invitedBy = await ctx.db.get(pending.invitedBy);

    return {
      invitationId: pending._id,
      orgName: org.name,
      role: pending.role,
      invitedByName: invitedBy?.name ?? invitedBy?.email ?? "a team member",
    };
  },
});

// ── Mutations ──

export const createOrg = mutation({
  args: {
    name: v.string(),
    website: v.optional(v.string()),
    context: v.optional(v.string()),
    industry: v.optional(v.string()),
    industryVertical: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check if user already has an org
    const existing = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (existing) throw new Error("Already in an organization");

    const orgId = await ctx.db.insert("organizations", {
      name: args.name,
      ...(args.website && { website: args.website }),
      ...(args.context && { context: args.context }),
      ...(args.industry && { industry: args.industry }),
      ...(args.industryVertical && { industryVertical: args.industryVertical }),
    });

    await ctx.db.insert("orgMemberships", {
      orgId,
      userId,
      role: "admin",
    });

    return orgId;
  },
});

/** Create a broker org during broker signup wizard. */
export const createBrokerOrg = mutation({
  args: {
    name: v.string(),
    website: v.optional(v.string()),
    slug: v.string(),
    brandingColor: v.optional(v.string()),
    agentDisplayName: v.optional(v.string()),
    agentHandle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Validate slug
    const normalized = args.slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (normalized.length < 3 || normalized.length > 40) {
      throw new Error("Slug must be 3-40 characters");
    }
    const slugTaken = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", normalized))
      .first();
    if (slugTaken) throw new Error("Slug already taken");

    // Validate handle if provided
    if (args.agentHandle) {
      const handleNorm = args.agentHandle.toLowerCase().replace(/[^a-z0-9-]/g, "");
      const handleTaken = await ctx.db
        .query("organizations")
        .withIndex("by_agentHandle", (q) => q.eq("agentHandle", handleNorm))
        .first();
      if (handleTaken) throw new Error("Handle already taken");
    }

    const orgId = await ctx.db.insert("organizations", {
      name: args.name,
      type: "broker",
      slug: normalized,
      ...(args.website && { website: args.website }),
      ...(args.brandingColor && { brandingColor: args.brandingColor }),
      ...(args.agentDisplayName && { agentDisplayName: args.agentDisplayName }),
      ...(args.agentHandle && { agentHandle: args.agentHandle.toLowerCase().replace(/[^a-z0-9-]/g, "") }),
    });

    await ctx.db.insert("orgMemberships", {
      orgId,
      userId,
      role: "admin",
    });

    return orgId;
  },
});

/** List all client orgs for a broker org. */
export const listClients = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccessNew(ctx, args.orgId);
    assertBrokerOrg(access);

    const clients = await ctx.db
      .query("organizations")
      .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", args.orgId))
      .collect();

    return await Promise.all(
      clients.map(async (client) => {
        const members = await ctx.db
          .query("orgMemberships")
          .withIndex("by_orgId", (q) => q.eq("orgId", client._id))
          .collect();
        return { ...client, memberCount: members.length };
      }),
    );
  },
});

/** Return all org memberships for the authenticated user. */
export const listAllOrgsForViewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    return await Promise.all(
      memberships.map(async (m) => {
        const org = await ctx.db.get(m.orgId);
        if (!org) return null;
        const iconUrl = org.iconStorageId ? await ctx.storage.getUrl(org.iconStorageId) : null;
        return { org: { ...org, iconUrl }, membership: m };
      }),
    ).then((results) => results.filter(Boolean));
  },
});

export const updateOrg = mutation({
  args: {
    name: v.optional(v.string()),
    website: v.optional(v.string()),
    context: v.optional(v.string()),
    industry: v.optional(v.string()),
    industryVertical: v.optional(v.string()),
    clientsContext: v.optional(v.string()),
    vendorsContext: v.optional(v.string()),
    insuranceContext: v.optional(v.string()),
    investorsContext: v.optional(v.string()),
    partnersContext: v.optional(v.string()),
    insuranceBroker: v.optional(v.string()),
    brokerContactName: v.optional(v.string()),
    brokerContactEmail: v.optional(v.string()),
    coiHandling: v.optional(v.union(v.literal("broker"), v.literal("member"), v.literal("ignore"))),
    autoGenerateCoi: v.optional(v.boolean()),
    chatEmailNotifications: v.optional(v.boolean()),
    autoSendEmails: v.optional(v.boolean()),
    emailSendDelay: v.optional(v.number()),
    brandingColor: v.optional(v.string()),
    agentDisplayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAdmin(ctx);
    await ctx.db.patch(orgId, args);
  },
});

export const claimAgentHandle = mutation({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const { orgId, org } = await requireOrgAdmin(ctx);
    if (org.agentHandle) throw new Error("Handle already claimed");

    const normalized = args.handle.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (normalized.length < 3 || normalized.length > 30) {
      throw new Error("Handle must be 3-30 characters");
    }

    // Check both tables during transition
    const existingOrg = await ctx.db
      .query("organizations")
      .withIndex("by_agentHandle", (q) => q.eq("agentHandle", normalized))
      .first();
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_agentHandle", (q) => q.eq("agentHandle", normalized))
      .first();
    if (existingOrg || existingUser) throw new Error("Handle already taken");

    await ctx.db.patch(orgId, { agentHandle: normalized });
    return normalized;
  },
});

export const inviteMember = mutation({
  args: {
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAdmin(ctx);

    // Check if already a member
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    if (existingUser && memberships.some((m) => m.userId === existingUser._id)) {
      throw new Error("User is already a member");
    }

    // Check for existing pending invitation
    const existingInvites = await ctx.db
      .query("orgInvitations")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .collect();
    const pendingForOrg = existingInvites.find(
      (i) => i.orgId === orgId && i.status === "pending",
    );
    if (pendingForOrg) {
      throw new Error("Invitation already pending for this email");
    }

    const invitationId = await ctx.db.insert("orgInvitations", {
      orgId,
      email: args.email,
      role: args.role,
      invitedBy: userId,
      status: "pending",
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return invitationId;
  },
});

export const acceptInvitation = mutation({
  args: { invitationId: v.id("orgInvitations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) throw new Error("Invitation not found");
    if (invitation.status !== "pending") throw new Error("Invitation is no longer valid");
    if (invitation.expiresAt < Date.now()) {
      await ctx.db.patch(args.invitationId, { status: "expired" });
      throw new Error("Invitation has expired");
    }

    const user = await ctx.db.get(userId);
    if (user?.email?.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new Error("Invitation was sent to a different email address");
    }

    // Check not already a member
    const existing = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) => q.eq("orgId", invitation.orgId).eq("userId", userId))
      .first();
    if (existing) {
      await ctx.db.patch(args.invitationId, { status: "accepted" });
      return existing._id;
    }

    // Create membership
    const membershipId = await ctx.db.insert("orgMemberships", {
      orgId: invitation.orgId,
      userId,
      role: invitation.role,
    });

    await ctx.db.patch(args.invitationId, { status: "accepted" });
    return membershipId;
  },
});

export const removeMember = mutation({
  args: { membershipId: v.id("orgMemberships") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAdmin(ctx);

    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== orgId) throw new Error("Membership not found");

    // Can't remove the last admin
    if (membership.role === "admin") {
      const admins = await ctx.db
        .query("orgMemberships")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
      const adminCount = admins.filter((m) => m.role === "admin").length;
      if (adminCount <= 1) throw new Error("Cannot remove the last admin");
    }

    await ctx.db.delete(args.membershipId);
  },
});

export const updateMemberRole = mutation({
  args: {
    membershipId: v.id("orgMemberships"),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAdmin(ctx);

    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== orgId) throw new Error("Membership not found");

    // Can't demote the last admin
    if (membership.role === "admin" && args.role === "member") {
      const admins = await ctx.db
        .query("orgMemberships")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
      const adminCount = admins.filter((m) => m.role === "admin").length;
      if (adminCount <= 1) throw new Error("Cannot demote the last admin");
    }

    await ctx.db.patch(args.membershipId, { role: args.role });
  },
});

export const setPrimaryInsuranceContact = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAdmin(ctx);

    // Verify the user is a member of this org
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) => q.eq("orgId", orgId).eq("userId", args.userId))
      .first();
    if (!membership) throw new Error("User is not a member of this organization");

    await ctx.db.patch(orgId, { primaryInsuranceContactId: args.userId });
  },
});

export const cancelInvitation = mutation({
  args: { invitationId: v.id("orgInvitations") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAdmin(ctx);
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation || invitation.orgId !== orgId) throw new Error("Invitation not found");
    await ctx.db.delete(args.invitationId);
  },
});

// ── Internal queries ──

export const getByHandle = internalQuery({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    // Check organizations first
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_agentHandle", (q) => q.eq("agentHandle", args.handle))
      .first();
    if (org) return org;

    // Fallback: check legacy users table during transition
    const user = await ctx.db
      .query("users")
      .withIndex("by_agentHandle", (q) => q.eq("agentHandle", args.handle))
      .first();
    if (user) {
      // Return in org-like shape for backward compat
      const membership = await ctx.db
        .query("orgMemberships")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .first();
      if (membership) {
        return await ctx.db.get(membership.orgId);
      }
    }
    return null;
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getMembersInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();
    return Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return { ...m, user };
      }),
    );
  },
});

export const setIconInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    iconStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (org?.iconStorageId && org.iconStorageId !== args.iconStorageId) {
      await ctx.storage.delete(org.iconStorageId).catch(() => {});
    }
    await ctx.db.patch(args.orgId, { iconStorageId: args.iconStorageId });
  },
});

export const updatePortfolioAnalysis = internalMutation({
  args: {
    id: v.id("organizations"),
    portfolioAnalysis: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { portfolioAnalysis: args.portfolioAnalysis });
  },
});

export const listAllInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("organizations").collect();
  },
});

export const updateDreamResults = internalMutation({
  args: {
    orgId: v.id("organizations"),
    intelligenceSummary: v.string(),
    lastDreamAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.orgId, {
      intelligenceSummary: args.intelligenceSummary,
      lastDreamAt: args.lastDreamAt,
    });
  },
});

export const getById = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return null;
    return ctx.db.get(args.orgId);
  },
});

export const listMembersForOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();
    return Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return { userId: m.userId, role: m.role, name: user?.name, email: user?.email };
      }),
    );
  },
});
