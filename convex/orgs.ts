import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgAccess, requireOrgAdmin, getOrgAccess } from "./lib/orgAuth";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getOrgAccess as getOrgAccessNew, assertBrokerOrg } from "./lib/access";
import type { Id } from "./_generated/dataModel";
import { isWhiteLabelingEnabled } from "./lib/branding";

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

    let brokerOrg: {
      _id: Id<"organizations">;
      name: string;
      slug?: string;
      website?: string;
      brandingColor?: string;
      whiteLabelingEnabled?: boolean;
      agentHandle?: string;
      agentDisplayName?: string;
      iconUrl: string | null;
      primaryContact: {
        userId: Id<"users">;
        name?: string;
        email?: string;
        title?: string;
      } | null;
    } | null = null;
    if ((org.type ?? "client") === "client" && org.brokerOrgId) {
      const broker = await ctx.db.get(org.brokerOrgId);
      if (broker) {
        const whiteLabelingEnabled = isWhiteLabelingEnabled(broker);
        const brokerIconUrl = whiteLabelingEnabled && broker.iconStorageId
          ? await ctx.storage.getUrl(broker.iconStorageId)
          : null;
        let primaryContact: {
          userId: Id<"users">;
          name?: string;
          email?: string;
          title?: string;
        } | null = null;
        const contactUserId = broker.primaryInsuranceContactId;
        if (contactUserId) {
          const contactUser = await ctx.db.get(contactUserId);
          if (contactUser) {
            primaryContact = {
              userId: contactUser._id,
              name: contactUser.name,
              email: contactUser.email,
              title: contactUser.title,
            };
          }
        }
        brokerOrg = {
          _id: broker._id,
          name: broker.name,
          slug: broker.slug,
          website: broker.website,
          whiteLabelingEnabled,
          brandingColor: whiteLabelingEnabled ? broker.brandingColor : undefined,
          agentHandle: broker.agentHandle,
          agentDisplayName: whiteLabelingEnabled ? broker.agentDisplayName : undefined,
          iconUrl: brokerIconUrl,
          primaryContact,
        };
      }
    }

    return { org: { ...org, iconUrl }, membership, brokerOrg };
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
  args: { handle: v.string(), excludeOrgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const normalized = args.handle.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (normalized.length < 3 || normalized.length > 30) {
      return { available: false, normalized, reason: "Handle must be 3-30 characters" };
    }
    if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(normalized) && normalized.length > 1) {
      return { available: false, normalized, reason: "Must start with a letter and end with a letter or number" };
    }
    const existingOrg = await ctx.db
      .query("organizations")
      .withIndex("by_agentHandle", (q) => q.eq("agentHandle", normalized))
      .first();
    const taken = !!existingOrg && existingOrg._id !== args.excludeOrgId;
    return { available: !taken, normalized, reason: taken ? "Handle already taken" : undefined };
  },
});

/** Public broker profile for client-facing login page. No auth required. */
export const publicBrokerBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const normalized = args.slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", normalized))
      .first();
    if (!org || org.type !== "broker") return null;
    const whiteLabelingEnabled = isWhiteLabelingEnabled(org);
    const iconUrl = whiteLabelingEnabled && org.iconStorageId
      ? await ctx.storage.getUrl(org.iconStorageId)
      : null;
    return {
      name: org.name,
      slug: org.slug,
      website: org.website,
      whiteLabelingEnabled,
      brandingColor: whiteLabelingEnabled ? org.brandingColor : undefined,
      agentDisplayName: whiteLabelingEnabled ? org.agentDisplayName : undefined,
      iconUrl,
    };
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

/** Create a broker org during partner signup wizard. */
export const createBrokerOrg = mutation({
  args: {
    name: v.string(),
    website: v.optional(v.string()),
    slug: v.string(),
    brandingColor: v.optional(v.string()),
    whiteLabelingEnabled: v.optional(v.boolean()),
    agentDisplayName: v.optional(v.string()),
    agentHandle: v.optional(v.string()),
    partnerType: v.optional(v.union(
      v.literal("broker"),
      v.literal("program_admin"),
      v.literal("carrier"),
      v.literal("other"),
    )),
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
      partnerType: args.partnerType ?? "broker",
      slug: normalized,
      ...(args.website && { website: args.website }),
      ...(args.whiteLabelingEnabled !== undefined && {
        whiteLabelingEnabled: args.whiteLabelingEnabled,
      }),
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

/** Create a client org during orphan client signup wizard. */
export const createClientOrg = mutation({
  args: {
    name: v.string(),
    website: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check if user already has an org membership
    const existingMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (existingMembership) {
      throw new Error("User already belongs to an organization");
    }

    const orgId = await ctx.db.insert("organizations", {
      name: args.name,
      type: "client",
      ...(args.website && { website: args.website }),
    });

    await ctx.db.insert("orgMemberships", {
      orgId,
      userId,
      role: "admin",
    });

    return orgId;
  },
});

/**
 * Update email-verification settings on a client org (allowedEmails,
 * allowedDomains, emailVerification mode). Only the managing broker's admins
 * can call this.
 */
export const updateClientEmailSettings = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    allowedEmails: v.optional(v.array(v.string())),
    allowedDomains: v.optional(v.array(v.string())),
    emailVerification: v.optional(
      v.union(v.literal("strict"), v.literal("domain"), v.literal("open")),
    ),
  },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientOrgId);
    if (!client || client.type !== "client" || !client.brokerOrgId) {
      throw new Error("Not a managed client org");
    }
    const access = await getOrgAccessNew(ctx, client.brokerOrgId);
    assertBrokerOrg(access);
    if (access.role !== "admin") {
      throw new Error("Only broker admins can update client email settings");
    }
    const normEmails = args.allowedEmails
      ?.map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@"));
    const normDomains = args.allowedDomains
      ?.map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
    const patch: Record<string, unknown> = {};
    if (normEmails !== undefined) patch.allowedEmails = normEmails;
    if (normDomains !== undefined) patch.allowedDomains = normDomains;
    if (args.emailVerification !== undefined) patch.emailVerification = args.emailVerification;
    await ctx.db.patch(args.clientOrgId, patch);
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
    coiHandling: v.optional(v.union(v.literal("broker"), v.literal("member"), v.literal("ignore"))),
    autoGenerateCoi: v.optional(v.boolean()),
    chatEmailNotifications: v.optional(v.boolean()),
    autoSendEmails: v.optional(v.boolean()),
    bccRequesterOnAgentEmails: v.optional(v.boolean()),
    emailSendDelay: v.optional(v.number()),
    allowedEmails: v.optional(v.array(v.string())),
    allowedDomains: v.optional(v.array(v.string())),
    emailVerification: v.optional(v.union(v.literal("strict"), v.literal("domain"), v.literal("open"))),
    brandingColor: v.optional(v.string()),
    whiteLabelingEnabled: v.optional(v.boolean()),
    brandingMode: v.optional(v.union(v.literal("light"), v.literal("dark"))),
    brandingTextOnAccent: v.optional(v.union(v.literal("light"), v.literal("dark"), v.literal("auto"))),
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
    if (org.type !== "broker") throw new Error("Only broker orgs can claim an agent handle");

    const normalized = args.handle.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (normalized.length < 3 || normalized.length > 30) {
      throw new Error("Handle must be 3-30 characters");
    }
    if (org.agentHandle === normalized) return normalized;

    const existingOrg = await ctx.db
      .query("organizations")
      .withIndex("by_agentHandle", (q) => q.eq("agentHandle", normalized))
      .first();
    if (existingOrg && existingOrg._id !== orgId) throw new Error("Handle already taken");

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
    return await ctx.db
      .query("organizations")
      .withIndex("by_agentHandle", (q) => q.eq("agentHandle", args.handle))
      .first();
  },
});

type SenderMatch = "email" | "domain" | "member";

async function senderMatchesOrg(
  ctx: QueryCtx,
  org: {
    _id: Id<"organizations">;
    allowedEmails?: string[];
    allowedDomains?: string[];
    emailVerification?: "strict" | "domain" | "open";
  },
  email: string,
  domain: string,
): Promise<SenderMatch | null> {
  const allowed = (org.allowedEmails ?? []).map((e) => e.toLowerCase());
  if (allowed.includes(email)) return "email";

  if (org.emailVerification !== "strict") {
    const domains = (org.allowedDomains ?? []).map((d) => d.toLowerCase());
    if (domain && domains.includes(domain)) return "domain";

    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();
    for (const membership of memberships) {
      const user = await ctx.db.get(membership.userId);
      if (user?.email?.toLowerCase() === email) return "member";
    }
  }

  return null;
}

/**
 * Resolve which client org a sender is authorized to act on behalf of, for
 * email addressed to the given agent handle. Broker-owned handles route to a
 * matching managed client when possible; the shared default "agent" handle
 * routes standalone client orgs by sender identity.
 */
export const resolveClientBySender = internalQuery({
  args: { handle: v.string(), senderEmail: v.string() },
  handler: async (ctx, args) => {
    const email = args.senderEmail.toLowerCase();
    const domain = email.split("@")[1] ?? "";

    const handleOwner = await ctx.db
      .query("organizations")
      .withIndex("by_agentHandle", (q) => q.eq("agentHandle", args.handle))
      .first();

    if (handleOwner && handleOwner.type !== "broker") {
      if (handleOwner.brokerOrgId) return null;
      const matchedBy = await senderMatchesOrg(ctx, handleOwner, email, domain);
      return matchedBy ? { brokerOrg: handleOwner, clientOrg: null, matchedBy } : null;
    }

    if (!handleOwner && args.handle !== "agent") return null;

    if (!handleOwner) {
      const standaloneOrgs = await ctx.db
        .query("organizations")
        .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", undefined))
        .collect();

      for (const org of standaloneOrgs) {
        if ((org.type ?? "client") !== "client") continue;
        const matchedBy = await senderMatchesOrg(ctx, org, email, domain);
        if (matchedBy) return { brokerOrg: org, clientOrg: null, matchedBy };
      }
      return null;
    }

    const brokerOrg = handleOwner;

    const clientOrgs = await ctx.db
      .query("organizations")
      .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", brokerOrg._id))
      .collect();

    // 1. Strict: explicit allowedEmails match
    for (const client of clientOrgs) {
      const allowed = (client.allowedEmails ?? []).map((e) => e.toLowerCase());
      if (allowed.includes(email)) return { brokerOrg, clientOrg: client, matchedBy: "email" as const };
    }
    // 2. Domain: allowedDomains match (skipping clients in "strict" mode)
    for (const client of clientOrgs) {
      if (client.emailVerification === "strict") continue;
      const domains = (client.allowedDomains ?? []).map((d) => d.toLowerCase());
      if (domain && domains.includes(domain)) {
        return { brokerOrg, clientOrg: client, matchedBy: "domain" as const };
      }
    }
    // 3. Membership: sender is an admin/member of the client org
    for (const client of clientOrgs) {
      if (client.emailVerification === "strict") continue;
      const memberships = await ctx.db
        .query("orgMemberships")
        .withIndex("by_orgId", (q) => q.eq("orgId", client._id))
        .collect();
      for (const m of memberships) {
        const u = await ctx.db.get(m.userId);
        if (u?.email?.toLowerCase() === email) {
          return { brokerOrg, clientOrg: client, matchedBy: "member" as const };
        }
      }
    }
    return { brokerOrg, clientOrg: null, matchedBy: null };
  },
});

export const getOrgsByUserId = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    const orgs = await Promise.all(
      memberships.map((membership) => ctx.db.get(membership.orgId)),
    );

    return orgs.filter(Boolean);
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

export const getUserMembership = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

export const getUserMemberships = internalQuery({
  args: { userIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    const uniqueUserIds = [...new Set(args.userIds)];
    const memberships = await Promise.all(
      uniqueUserIds.map((userId) =>
        ctx.db
          .query("orgMemberships")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .first(),
      ),
    );
    return memberships.filter(Boolean);
  },
});

export const hasMembershipInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", args.orgId).eq("userId", args.userId),
      )
      .first();
    return !!membership;
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

export const listAllInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("organizations").collect();
  },
});

export const getById = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    try {
      await getOrgAccessNew(ctx, args.orgId);
    } catch {
      return null;
    }
    return ctx.db.get(args.orgId);
  },
});

export const listMembersForOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    try {
      await getOrgAccessNew(ctx, args.orgId);
    } catch {
      return [];
    }
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
