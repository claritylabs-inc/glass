import { v } from "convex/values";
import { query, mutation, action, internalQuery, internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import dayjs from "dayjs";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal as _internal } from "./_generated/api";
import {
  assertBrokerOrg,
  getCurrentOrgAccess as getOrgAccess,
  getOrgAccess as getOrgAccessNew,
  requireCurrentOrgAccess as requireOrgAccess,
  requireCurrentOrgAdmin as requireOrgAdmin,
} from "./lib/access";
import type { Id } from "./_generated/dataModel";
import { getBrandingContext, isWhiteLabelingEnabled } from "./lib/branding";
import { normalizeOptionalEmail, resolveBrokerIdentityForClient } from "./lib/brokerIdentity";
import { buildEmailShell, escapeHtml } from "./lib/emailTemplate";
import { getAuthSiteUrl } from "./lib/domains";
import { getAuthFromAddress, sendResendEmail } from "./lib/resend";
import {
  generateEmailChangeCode,
  sendEmailChangeVerificationEmail,
} from "./lib/emailChange";
import { normalizeAvailableUserPhone } from "./lib/userPhone";
import {
  assertCustomerUser,
  assertImpersonatedSetupWrite,
  getActiveOperatorImpersonation,
  isBootstrapOperatorEmail,
} from "./lib/operatorIdentity";
import {
  assertFeatureFlagAllowedForOrg,
  setFeatureFlagPatch,
} from "./lib/featureFlags";

const internal = _internal as any;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function createMemberInvitation(
  ctx: MutationCtx,
  args: {
    email: string;
    role: "admin" | "member";
    invitedByUserId?: Id<"users">;
  },
) {
  const access = args.invitedByUserId
    ? await requireOrgAdminForUser(ctx, args.invitedByUserId)
    : await requireOrgAdmin(ctx);
  const { userId, orgId } = access;
  const email = normalizeEmail(args.email);
  if (!email) throw new Error("Email is required");
  if (isBootstrapOperatorEmail(email)) {
    throw new Error("Operator emails cannot be invited to customer organizations");
  }

  const memberships = await ctx.db
    .query("orgMemberships")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();
  const existingUser = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .first();
  if (existingUser && memberships.some((m) => m.userId === existingUser._id)) {
    throw new Error("User is already a member");
  }
  if (existingUser) await assertCustomerUser(ctx, existingUser._id);

  const now = dayjs().valueOf();
  const expiresAt = dayjs(now).add(7, "day").valueOf();
  const existingInvites = await ctx.db
    .query("orgInvitations")
    .withIndex("by_email", (q) => q.eq("email", email))
    .collect();
  const pendingForOrg = existingInvites.find(
    (i) => i.orgId === orgId && i.status === "pending",
  );

  if (pendingForOrg) {
    await ctx.db.patch(pendingForOrg._id, {
      role: args.role,
      invitedBy: userId,
      expiresAt,
    });
    return { invitationId: pendingForOrg._id, reusedExisting: true };
  }

  const invitationId = await ctx.db.insert("orgInvitations", {
    orgId,
    email,
    role: args.role,
    invitedBy: userId,
    status: "pending",
    expiresAt,
  });
  return { invitationId, reusedExisting: false };
}

async function requireOrgAdminForUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) {
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (!membership) throw new Error("No organization membership");
  if (membership.role !== "admin") throw new Error("Admin access required");

  const org = await ctx.db.get(membership.orgId);
  if (!org) throw new Error("Organization not found");
  return { userId, orgId: membership.orgId, role: membership.role, org };
}

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
    const impersonation = await getActiveOperatorImpersonation(ctx);
    if (impersonation) {
      if (args.orgId && args.orgId !== impersonation.session.targetOrgId) {
        const requested = await ctx.db.get(args.orgId);
        if (
          !requested ||
          requested.type !== "client" ||
          requested.brokerOrgId !== impersonation.session.targetOrgId
        ) {
          return null;
        }
        membership = {
          orgId: requested._id,
          userId,
          role: impersonation.session.targetRole,
        };
      } else {
        membership = {
          orgId: impersonation.session.targetOrgId,
          userId,
          role: impersonation.session.targetRole,
        };
      }
    } else
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
        phone?: string;
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
          phone?: string;
          title?: string;
        } | null = null;
        const brokerIdentity = await resolveBrokerIdentityForClient(ctx, org);
        const contactUserId =
          brokerIdentity.contactUserId ?? broker.primaryInsuranceContactId;
        if (contactUserId) {
          const contactUser = await ctx.db.get(contactUserId);
          if (contactUser) {
            primaryContact = {
              userId: contactUser._id,
              name: brokerIdentity.contactName ?? contactUser.name,
              email: brokerIdentity.contactEmail ?? contactUser.email,
              phone: brokerIdentity.contactPhone ?? contactUser.phone,
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
    const now = dayjs().valueOf();

    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const members = await Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        const pendingEmailChanges = await ctx.db
          .query("userEmailChangeRequests")
          .withIndex("by_target_status", (q) =>
            q.eq("targetUserId", m.userId).eq("status", "pending"),
          )
          .collect();
        const pendingEmailChange =
          pendingEmailChanges
            .filter((request) => request.expiresAt > now)
            .sort((a, b) => b.requestedAt - a.requestedAt)[0] ?? null;
        return {
          membershipId: m._id,
          userId: m.userId,
          role: m.role,
          name: user?.name,
          email: user?.email,
          phone: user?.phone,
          title: user?.title,
          pendingEmailChange: pendingEmailChange
            ? {
                requestId: pendingEmailChange._id,
                newEmail: pendingEmailChange.newEmail,
                requestedAt: pendingEmailChange.requestedAt,
                expiresAt: pendingEmailChange.expiresAt,
                requestedByUserId: pendingEmailChange.requestedByUserId,
              }
            : undefined,
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
    if ((org.operatorStatus ?? "live") !== "live") return null;
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
    const email = normalizeEmail(args.email);
    // Check both original case and lowercase since invitations may be stored either way
    const byOriginal = await ctx.db
      .query("orgInvitations")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .collect();
    const byLower = args.email !== email
      ? await ctx.db
          .query("orgInvitations")
          .withIndex("by_email", (q) => q.eq("email", email))
          .collect()
      : [];
    const all = [...byOriginal, ...byLower];
    const pending = all.find(
      (i) => i.status === "pending" && i.expiresAt > dayjs().valueOf(),
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
    const lowerEmail = normalizeEmail(user.email!);
    const byLower = user.email !== lowerEmail
      ? await ctx.db
          .query("orgInvitations")
          .withIndex("by_email", (q) => q.eq("email", lowerEmail))
          .collect()
      : [];
    const all = [...byOriginal, ...byLower];
    const pending = all.find(
      (i) => i.status === "pending" && i.expiresAt > dayjs().valueOf(),
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

/** Create a broker org during signup. */
export const createBrokerOrg = mutation({
  args: {
    name: v.string(),
    website: v.optional(v.string()),
    slug: v.string(),
    brandingColor: v.optional(v.string()),
    whiteLabelingEnabled: v.optional(v.boolean()),
    agentDisplayName: v.optional(v.string()),
    agentHandle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await assertCustomerUser(ctx, userId);

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
      primaryInsuranceContactId: userId,
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
    await assertCustomerUser(ctx, userId);

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
      primaryInsuranceContactId: userId,
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
    await assertImpersonatedSetupWrite(ctx, client.brokerOrgId);
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

function cleanOptionalString(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeBrokerPhone(value: string | undefined | null) {
  const phone = cleanOptionalString(value);
  if (!phone) return undefined;
  const parsed = parsePhoneNumberFromString(phone, "US");
  if (!parsed || !parsed.isValid()) {
    throw new Error("Enter a valid broker phone number with country code");
  }
  return parsed.number;
}

export const getBrokerIdentity = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccessNew(ctx, args.orgId);
    const org = await ctx.db.get(args.orgId);
    if (!org || (org.type ?? "client") !== "client") return null;

    const identity = await resolveBrokerIdentityForClient(ctx, org);
    const canEdit =
      identity.brokerOrgId
        ? access.accessType === "broker_of_client" && access.role === "admin"
        : access.accessType === "member" && access.role === "admin";

    const assignment = identity.assignmentId
      ? await ctx.db.get(identity.assignmentId)
      : null;
    const brokerMembers =
      canEdit && identity.brokerOrgId
        ? await Promise.all(
            (
              await ctx.db
                .query("orgMemberships")
                .withIndex("by_orgId", (q) =>
                  q.eq("orgId", identity.brokerOrgId!),
                )
                .collect()
            ).map(async (membership) => {
              const user = await ctx.db.get(membership.userId);
              return {
                userId: membership.userId,
                role: membership.role,
                name: user?.name,
                email: user?.email,
                phone: user?.phone,
              };
            }),
          )
        : [];

    return {
      ...identity,
      connected: !!identity.brokerOrgId,
      canEdit,
      selectedContactUserId: identity.contactUserId,
      overrides: assignment
        ? {
            contactName: assignment.contactName,
            contactEmail: assignment.contactEmail,
            contactPhone: assignment.contactPhone,
          }
        : null,
      brokerMembers,
    };
  },
});

export const getBrokerPageContext = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { showBrokerPage: false, isVendorOnly: false };
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!membership) return { showBrokerPage: false, isVendorOnly: false };
    const org = await ctx.db.get(membership.orgId);
    if (!org || (org.type ?? "client") !== "client") {
      return { showBrokerPage: false, isVendorOnly: false };
    }
    const customerRelationship = await ctx.db
      .query("connectedOrgRelationships")
      .withIndex("by_clientOrgId_status", (q) =>
        q.eq("clientOrgId", org._id).eq("status", "active"),
      )
      .first();
    const vendorRelationship = await ctx.db
      .query("connectedOrgRelationships")
      .withIndex("by_vendorOrgId_status", (q) =>
        q.eq("vendorOrgId", org._id).eq("status", "active"),
      )
      .first();
    const isVendorOnly = !!vendorRelationship && !customerRelationship && !org.brokerOrgId;
    return { showBrokerPage: !isVendorOnly, isVendorOnly };
  },
});

export const updateClientBrokerAssignment = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    brokerCompanyName: v.optional(v.string()),
    producerId: v.optional(v.id("users")),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clientOrg = await ctx.db.get(args.clientOrgId);
    if (!clientOrg || (clientOrg.type ?? "client") !== "client") {
      throw new Error("Client organization required");
    }
    const connectedBrokerOrgId = clientOrg.brokerOrgId;
    if (connectedBrokerOrgId) {
      const brokerAccess = await getOrgAccessNew(ctx, connectedBrokerOrgId);
      assertBrokerOrg(brokerAccess);
      if (brokerAccess.role !== "admin") {
        throw new Error("Broker admin access required");
      }
      await assertImpersonatedSetupWrite(ctx, connectedBrokerOrgId);
    } else {
      const clientAccess = await getOrgAccessNew(ctx, args.clientOrgId);
      if (
        clientAccess.accessType !== "member" ||
        clientAccess.orgType !== "client" ||
        clientAccess.role !== "admin"
      ) {
        throw new Error("Client admin access required");
      }
    }
    if (args.producerId && connectedBrokerOrgId) {
      const membership = await ctx.db
        .query("orgMemberships")
        .withIndex("by_orgId_userId", (q) =>
          q.eq("orgId", connectedBrokerOrgId).eq("userId", args.producerId!),
        )
        .first();
      if (!membership) throw new Error("Producer must be a broker org member");
    }
    if (args.producerId && !connectedBrokerOrgId) {
      throw new Error("Producer selection requires a connected broker org");
    }

    const assignments = connectedBrokerOrgId
      ? await ctx.db
          .query("brokerClientAssignments")
          .withIndex("by_orgId_clientOrgId", (q) =>
            q.eq("orgId", connectedBrokerOrgId).eq("clientOrgId", args.clientOrgId),
          )
          .collect()
      : (
          await ctx.db
            .query("brokerClientAssignments")
            .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", args.clientOrgId))
            .collect()
        ).filter((assignment) => !assignment.orgId);
    const brokerCompanyName = connectedBrokerOrgId
      ? undefined
      : cleanOptionalString(args.brokerCompanyName);
    const contactName = cleanOptionalString(args.contactName);
    const contactEmail = normalizeOptionalEmail(args.contactEmail, { strict: true });
    const contactPhone = normalizeBrokerPhone(args.contactPhone);
    if (
      !connectedBrokerOrgId &&
      !brokerCompanyName &&
      !contactName &&
      !contactEmail &&
      !contactPhone
    ) {
      for (const assignment of assignments) await ctx.db.delete(assignment._id);
      return;
    }
    const existing = assignments.find(
      (assignment) => assignment.producerId === args.producerId,
    ) ?? assignments.find((assignment) => assignment.role === "primary");
    const now = dayjs().valueOf();
    const patch = {
      role: "primary" as const,
      orgId: connectedBrokerOrgId,
      brokerCompanyName,
      producerId: connectedBrokerOrgId ? args.producerId : undefined,
      contactName,
      contactEmail,
      contactPhone,
      updatedAt: now,
    };

    for (const assignment of assignments) {
      if (assignment._id === existing?._id) {
        await ctx.db.patch(assignment._id, patch);
      } else if (assignment.role === "primary") {
        await ctx.db.patch(assignment._id, { role: "secondary" });
      }
    }
    if (!existing) {
      await ctx.db.insert("brokerClientAssignments", {
        clientOrgId: args.clientOrgId,
        ...patch,
        createdAt: now,
      });
    }
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
    relatedLegalEntities: v.optional(
      v.array(
        v.object({
          legalName: v.string(),
          relationship: v.optional(
            v.union(
              v.literal("current"),
              v.literal("fka"),
              v.literal("dba"),
              v.literal("subsidiary"),
              v.literal("parent"),
              v.literal("affiliate"),
              v.literal("other"),
            ),
          ),
          incorporationNumber: v.optional(v.string()),
          taxId: v.optional(v.string()),
          jurisdiction: v.optional(v.string()),
          notes: v.optional(v.string()),
        }),
      ),
    ),
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
    await assertImpersonatedSetupWrite(ctx, orgId);
    await ctx.db.patch(orgId, args);
  },
});

export const setFeatureFlag = mutation({
  args: {
    flagId: v.literal("connect_features"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { orgId, org } = await requireOrgAdmin(ctx);
    await assertImpersonatedSetupWrite(ctx, orgId);
    assertFeatureFlagAllowedForOrg(args.flagId, {
      type: org.type === "broker" ? "broker" : "client",
      featureFlags: org.featureFlags,
    });
    await ctx.db.patch(orgId, {
      featureFlags: setFeatureFlagPatch(org.featureFlags, args.flagId, args.enabled),
    });
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
    const result = await createMemberInvitation(ctx, args);
    return result.invitationId;
  },
});

export const sendMemberInvitation = action({
  args: {
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const invitationResult = await ctx.runMutation(internal.orgs.createMemberInvitationInternal, {
      ...args,
      invitedByUserId: userId,
    });
    const invitationId = invitationResult.invitationId;
    const context = await ctx.runQuery(internal.orgs.getMemberInvitationEmailContextInternal, {
      invitationId,
    });
    if (!context) throw new Error("Invitation not found");

    const siteUrl = getAuthSiteUrl();
    const invitedEmail = context.invitation.email;
    const inviteUrl = `${siteUrl.replace(/\/$/, "")}/login?email=${encodeURIComponent(invitedEmail)}&next=${encodeURIComponent("/")}`;
    const orgName = context.org.name;
    const inviterName = context.invitedBy.name ?? context.invitedBy.email ?? "A team member";
    const roleLabel = context.invitation.role === "admin" ? "admin" : "member";
    const subject = `${inviterName} invited you to join ${orgName} on Glass`;
    const escapedOrgName = escapeHtml(orgName);
    const escapedInviterName = escapeHtml(inviterName);
    const escapedInviteUrl = escapeHtml(inviteUrl);
    const escapedEmail = escapeHtml(invitedEmail);
    const branding = context.whiteLabelingEnabled
      ? getBrandingContext({
          agentDisplayName: context.org.agentDisplayName ?? orgName,
          brandingColor: context.org.brandingColor,
          logoUrl: context.org.iconUrl ?? undefined,
        })
      : getBrandingContext();
    const bodyHtml = `
<tr><td style="padding:28px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#374151;line-height:1.6;">
    <strong>${escapedInviterName}</strong> invited you to join <strong>${escapedOrgName}</strong> on Glass as a ${roleLabel}.
  </p>
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <a href="${escapedInviteUrl}" style="display:inline-block;padding:8px 22px;background-color:#000000;color:#ffffff;font-family:-apple-system,sans-serif;font-size:14px;font-weight:500;text-decoration:none;border-radius:999px;line-height:1.4;">Accept invitation</a>
</td></tr>
<tr><td style="padding:20px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,sans-serif;font-size:12px;color:#6b7280;line-height:1.6;">
    Sign in or create an account with ${escapedEmail}. You can also copy this link:<br>
    <a href="${escapedInviteUrl}" style="color:#6b7280;word-break:break-all;">${escapedInviteUrl}</a>
  </p>
</td></tr>
<tr><td style="padding:16px 40px 32px 40px;">
  <p style="margin:0;font-family:-apple-system,sans-serif;font-size:11px;color:#9ca3af;">This invitation expires in 7 days.</p>
</td></tr>`;
    const html = buildEmailShell({ title: subject, bodyHtml, branding, siteUrl });
    const text = `${inviterName} invited you to join ${orgName} on Glass as a ${roleLabel}.\n\nAccept invitation:\n${inviteUrl}\n\nSign in or create an account with ${invitedEmail}. This invitation expires in 7 days.`;

    const result = await sendResendEmail(
      {
        from: getAuthFromAddress(orgName),
        to: invitedEmail,
        subject,
        html,
        text,
      },
      { retries: 2 },
    );

    if (!result.ok) {
      if (!invitationResult.reusedExisting) {
        await ctx.runMutation(internal.orgs.deleteInvitationInternal, { invitationId });
      }
      throw new Error(`Failed to send invitation email: ${result.error}`);
    }

    return invitationId;
  },
});

export const requestMemberEmailChange = action({
  args: {
    membershipId: v.id("orgMemberships"),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const target = await ctx.runQuery(
      internal.orgs.getMemberEmailChangeTargetInternal,
      {
        membershipId: args.membershipId,
        requestedByUserId: userId,
      },
    );
    const code = generateEmailChangeCode();
    const request = await ctx.runMutation(
      internal.users.createEmailChangeRequestInternal,
      {
        targetUserId: target.targetUserId,
        requestedByUserId: userId,
        newEmail: args.email,
        code,
      },
    );
    const result = await sendEmailChangeVerificationEmail({
      to: request.newEmail,
      code,
    });

    if (!result.ok) {
      await ctx.runMutation(internal.users.cancelEmailChangeRequestInternal, {
        requestId: request.requestId,
        cancelledByUserId: userId,
      });
      throw new Error(`Failed to send verification email: ${result.error}`);
    }

    return request;
  },
});

export const createMemberInvitationInternal = internalMutation({
  args: {
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    invitedByUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await createMemberInvitation(ctx, args);
  },
});

export const getMemberEmailChangeTargetInternal = internalQuery({
  args: {
    membershipId: v.id("orgMemberships"),
    requestedByUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAdminForUser(
      ctx,
      args.requestedByUserId,
    );
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== orgId) {
      throw new Error("Membership not found");
    }
    await assertCustomerUser(ctx, membership.userId);
    return { targetUserId: membership.userId };
  },
});

export const getMemberInvitationEmailContextInternal = internalQuery({
  args: { invitationId: v.id("orgInvitations") },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) return null;
    const org = await ctx.db.get(invitation.orgId);
    const invitedBy = await ctx.db.get(invitation.invitedBy);
    if (!org || !invitedBy) return null;
    const iconUrl = org.iconStorageId ? await ctx.storage.getUrl(org.iconStorageId) : null;
    return {
      invitation,
      org: {
        name: org.name,
        brandingColor: org.brandingColor,
        agentDisplayName: org.agentDisplayName,
        iconUrl,
      },
      whiteLabelingEnabled: isWhiteLabelingEnabled(org),
      invitedBy: {
        name: invitedBy.name,
        email: invitedBy.email,
      },
    };
  },
});

export const deleteInvitationInternal = internalMutation({
  args: { invitationId: v.id("orgInvitations") },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (invitation?.status === "pending") {
      await ctx.db.delete(args.invitationId);
    }
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
    if (invitation.expiresAt < dayjs().valueOf()) {
      await ctx.db.patch(args.invitationId, { status: "expired" });
      throw new Error("Invitation has expired");
    }

    const user = await ctx.db.get(userId);
    if (user?.email?.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new Error("Invitation was sent to a different email address");
    }
    await assertCustomerUser(ctx, userId);

    // Check not already a member
    const existing = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) => q.eq("orgId", invitation.orgId).eq("userId", userId))
      .first();
    if (existing) {
      await ctx.db.patch(args.invitationId, { status: "accepted" });
      await ctx.db.patch(userId, { onboardingComplete: true });
      return existing._id;
    }

    // Create membership
    const membershipId = await ctx.db.insert("orgMemberships", {
      orgId: invitation.orgId,
      userId,
      role: invitation.role,
    });

    await ctx.db.patch(args.invitationId, { status: "accepted" });
    await ctx.db.patch(userId, { onboardingComplete: true });
    return membershipId;
  },
});

export const removeMember = mutation({
  args: { membershipId: v.id("orgMemberships") },
  handler: async (ctx, args) => {
    const { orgId, org } = await requireOrgAdmin(ctx);

    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== orgId) throw new Error("Membership not found");

    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    if (membership.role === "admin") {
      const adminCount = memberships.filter((m) => m.role === "admin").length;
      if (adminCount <= 1) throw new Error("Cannot remove the last admin");
    }

    await ctx.db.delete(args.membershipId);

    const remainingMemberships = memberships.filter(
      (m) => m._id !== args.membershipId,
    );
    let primaryInsuranceContactId = org.primaryInsuranceContactId;
    if (
      org.primaryInsuranceContactId === membership.userId ||
      (!org.primaryInsuranceContactId && remainingMemberships.length === 1)
    ) {
      primaryInsuranceContactId =
        remainingMemberships.length === 1
          ? remainingMemberships[0].userId
          : undefined;
      await ctx.db.patch(orgId, {
        primaryInsuranceContactId,
      });
    }
    return { primaryInsuranceContactId: primaryInsuranceContactId ?? null };
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

export const updateMemberProfile = mutation({
  args: {
    membershipId: v.id("orgMemberships"),
    name: v.optional(v.string()),
    title: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAdmin(ctx);

    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== orgId) throw new Error("Membership not found");
    await assertCustomerUser(ctx, membership.userId);

    const patch: { name?: string; title?: string; phone?: string | undefined } = {};
    if (args.name !== undefined) patch.name = args.name.trim() || undefined;
    if (args.title !== undefined) patch.title = args.title.trim() || undefined;
    if (args.phone !== undefined) {
      patch.phone = await normalizeAvailableUserPhone(ctx, args.phone, membership.userId);
    }
    await ctx.db.patch(membership.userId, patch);
  },
});

export const cancelMemberEmailChange = mutation({
  args: {
    membershipId: v.id("orgMemberships"),
    requestId: v.id("userEmailChangeRequests"),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireOrgAdmin(ctx);
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== orgId) {
      throw new Error("Membership not found");
    }

    const request = await ctx.db.get(args.requestId);
    if (
      !request ||
      request.targetUserId !== membership.userId ||
      request.status !== "pending"
    ) {
      throw new Error("Email change request not found");
    }

    await ctx.db.patch(request._id, {
      status: "cancelled",
      cancelledAt: dayjs().valueOf(),
      cancelledByUserId: userId,
    });
    return { requestId: request._id };
  },
});

export const setPrimaryInsuranceContact = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAdmin(ctx);

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) => q.eq("orgId", orgId).eq("userId", args.userId))
      .first();
    if (!membership) throw new Error("User is not a member of this organization");

    await ctx.db.patch(orgId, { primaryInsuranceContactId: args.userId });
  },
});

export const ensurePrimaryInsuranceContact = mutation({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireOrgAccess(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("Organization not found");

    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const currentPrimaryStillMember = org.primaryInsuranceContactId
      ? memberships.some(
          (membership) => membership.userId === org.primaryInsuranceContactId,
        )
      : false;
    if (currentPrimaryStillMember) {
      return { userId: org.primaryInsuranceContactId, updated: false };
    }

    if (memberships.length !== 1) {
      return { userId: null, updated: false };
    }

    const userId = memberships[0].userId;
    await ctx.db.patch(orgId, { primaryInsuranceContactId: userId });
    return { userId, updated: true };
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
    if (handleOwner && (handleOwner.operatorStatus ?? "live") !== "live") {
      return null;
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

export const resolveBrokerIdentityInternal = internalQuery({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const clientOrg = await ctx.db.get(args.clientOrgId);
    if (!clientOrg) return null;
    return await resolveBrokerIdentityForClient(ctx, clientOrg);
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

export const updateProfileInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    context: v.optional(v.string()),
    industry: v.optional(v.string()),
    industryVertical: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId, ...patch } = args;
    await ctx.db.patch(orgId, patch);
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
