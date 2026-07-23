// convex/clientInvitations.ts
//
// Client invitation flows — creates new client orgs on acceptance.
// Distinct from orgInvitations (which invites users into an *existing* org).

import { v } from "convex/values";
import { query, mutation, action, internalMutation, internalQuery } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal as _internal } from "./_generated/api";
import type { Id as DataModelId } from "./_generated/dataModel";
const internal = _internal as any;
import { getOrgAccess, assertBrokerOrg } from "./lib/access";
import { recordBrokerActivity } from "./lib/brokerActivity";
import { notify } from "./lib/notify";
import { sendResendEmail, getAuthFromAddress } from "./lib/resend";
import { buildEmailShell } from "./lib/emailTemplate";
import { getBrandingContext, isWhiteLabelingEnabled } from "./lib/branding";
import { getAuthSiteUrl } from "./lib/domains";
import type { MutationCtx } from "./_generated/server";
import {
  findUserByNormalizedPhone,
  normalizeAvailableUserPhone,
  normalizeUserPhone,
} from "./lib/userPhone";
import {
  assertCustomerUser,
  assertImpersonatedSetupWrite,
  isBootstrapOperatorEmail,
} from "./lib/operatorIdentity";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Hash a raw token string to SHA-256 hex using Web Crypto API. */
async function sha256Hex(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Generate a 32-byte random hex token string using Web Crypto API. */
function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function companyNameFromEmail(email: string | undefined | null): string | null {
  if (!email) return null;
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  const root = domain.split(".")[0]?.trim();
  if (!root) return null;
  const cleaned = root.replace(/[^a-z0-9-_ ]/gi, "");
  if (!cleaned) return null;
  const words = cleaned
    .split(/[-_\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (words.length === 0) return null;
  return words
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ")
    .slice(0, 80);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function cleanOptionalString(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeWebsite(value: string | undefined | null) {
  const trimmed = cleanOptionalString(value);
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function findUserByEmail(ctx: MutationCtx, email: string) {
  return await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .first();
}

async function upsertInvitedUser(
  ctx: MutationCtx,
  args: {
    email: string;
    name?: string;
    phone?: string;
  },
) {
  const email = normalizeEmail(args.email);
  if (!email) throw new Error("Client email is required");
  if (isBootstrapOperatorEmail(email)) {
    throw new Error("Operator emails cannot be used as client contacts");
  }
  const existing = await findUserByEmail(ctx, email);
  if (existing) await assertCustomerUser(ctx, existing._id);
  const phone = await normalizeAvailableUserPhone(ctx, args.phone, existing?._id);
  const name = cleanOptionalString(args.name);

  if (existing) {
    const patch: { name?: string; phone?: string | undefined } = {};
    if (name) patch.name = name;
    if (args.phone !== undefined) patch.phone = phone;
    if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
    return existing._id;
  }

  return await ctx.db.insert("users", {
    email,
    ...(name ? { name } : {}),
    ...(phone ? { phone } : {}),
  });
}

/**
 * Ensure the user has a membership on a client org for the given broker.
 * Idempotent: returns existing membership if present; otherwise either
 * promotes an existing draft org or inserts a fresh one.
 */
async function ensureClientMembership(
  ctx: MutationCtx,
  args: {
    userId: DataModelId<"users">;
    brokerOrgId: DataModelId<"organizations">;
    draftOrgId?: DataModelId<"organizations">;
    nameHint?: string;
  },
): Promise<{ clientOrgId: DataModelId<"organizations">; reused: boolean }> {
  const memberships = await ctx.db
    .query("orgMemberships")
    .withIndex("by_userId", (q) => q.eq("userId", args.userId))
    .collect();
  for (const m of memberships) {
    const org = await ctx.db.get(m.orgId);
    if (
      org &&
      org.type === "client" &&
      org.brokerOrgId === args.brokerOrgId
    ) {
      return { clientOrgId: m.orgId, reused: true };
    }
  }

  const user = await ctx.db.get(args.userId);
  const resolvedName =
    companyNameFromEmail(user?.email ?? undefined) ??
    (args.nameHint?.trim() || "Client organization");

  if (args.draftOrgId) {
    const draft = await ctx.db.get(args.draftOrgId);
    if (!draft) throw new Error("Client organization missing");
    await ctx.db.patch(args.draftOrgId, {
      name: resolvedName,
      inviteStatus: undefined,
      draftCreatedByUserId: undefined,
      primaryInsuranceContactId: args.userId,
    });
    await ctx.db.insert("orgMemberships", {
      orgId: args.draftOrgId,
      userId: args.userId,
      role: "admin",
    });
    return { clientOrgId: args.draftOrgId, reused: false };
  }

  const clientOrgId = await ctx.db.insert("organizations", {
    name: resolvedName,
    type: "client",
    brokerOrgId: args.brokerOrgId,
    primaryInsuranceContactId: args.userId,
  });
  await ctx.db.insert("orgMemberships", {
    orgId: clientOrgId,
    userId: args.userId,
    role: "admin",
  });
  return { clientOrgId, reused: false };
}

// ── Public mutations / queries ─────────────────────────────────────────────────

/**
 * Open broker signup — user lands on /signup/{brokerSlug} and creates an
 * account. Idempotent per broker.
 */
export const joinBroker = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    await ctx.runQuery(internal.users.requireCustomerUserInternal, { userId });

    const normalized = slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const broker = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", normalized))
      .first();
    if (!broker || broker.type !== "broker") throw new Error("Broker not found");

    const { clientOrgId, reused } = await ensureClientMembership(ctx, {
      userId,
      brokerOrgId: broker._id,
    });

    if (!reused) {
      const user = await ctx.db.get(userId);
      const orgDoc = await ctx.db.get(clientOrgId);
      await recordBrokerActivity(ctx, {
        brokerOrgId: broker._id,
        clientOrgId,
        type: "invitation_accepted",
        actorUserId: userId,
        actorSide: "client",
        summary: `${user?.name ?? user?.email ?? "A client"} signed up via your signup link.`,
        payload: { source: "signup_slug" },
      });
      await notify(ctx, {
        orgId: broker._id,
        type: "client_invitation_accepted",
        title: "New client joined",
        body: `${orgDoc?.name ?? "A client"} signed up via your signup link.`,
        relatedOrgId: clientOrgId,
        actionType: "view_client",
        actionPayload: { clientOrgId },
      });
    }

    return { clientOrgId };
  },
});

// ── Draft client flow ────────────────────────────────────────────────────────
//
// Brokers create a "draft" client org only when they explicitly save or send
// from the invite drawer. When they send the invite, the org flips from draft →
// invited and the invitation record is created. When the client accepts, the org
// transitions to active (inviteStatus cleared) and the invitation links to the
// already-existing org.

/** Create a draft client org. Broker members only. */
export const createDraftClient = mutation({
  args: {
    brokerOrgId: v.id("organizations"),
    clientOrgName: v.optional(v.string()),
    website: v.optional(v.string()),
    primaryContactEmail: v.string(),
    primaryContactName: v.optional(v.string()),
    primaryContactPhone: v.optional(v.string()),
    customMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.brokerOrgId);
    assertBrokerOrg(access);
    await assertImpersonatedSetupWrite(ctx, args.brokerOrgId);
    const primaryContactEmail = normalizeEmail(args.primaryContactEmail);
    if (!primaryContactEmail) throw new Error("Client email is required");
    await upsertInvitedUser(ctx, {
      email: primaryContactEmail,
      name: args.primaryContactName,
      phone: args.primaryContactPhone,
    });

    const name =
      args.clientOrgName?.trim() ||
      companyNameFromEmail(primaryContactEmail) ||
      "Draft client";
    const clientOrgId = await ctx.db.insert("organizations", {
      name,
      website: normalizeWebsite(args.website),
      type: "client",
      brokerOrgId: args.brokerOrgId,
      inviteStatus: "draft",
      primaryContactName: args.primaryContactName?.trim() || undefined,
      primaryContactEmail,
      primaryContactPhone: normalizeUserPhone(args.primaryContactPhone),
      inviteCustomMessage: args.customMessage?.trim() || undefined,
      draftCreatedByUserId: access.userId,
    });

    // Assign to the creating producer so they show up in their own views.
    await ctx.db.insert("brokerClientAssignments", {
      orgId: args.brokerOrgId,
      clientOrgId,
      producerId: access.userId,
      role: "primary",
      createdAt: Date.now(),
    });

    return { clientOrgId };
  },
});

/** Load a draft client org for the invite drawer to resume editing. */
export const getDraftClient = query({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.clientOrgId);
    if (!org || org.type !== "client" || !org.brokerOrgId) return null;
    if (org.inviteStatus !== "draft" && org.inviteStatus !== "invited") return null;
    const access = await getOrgAccess(ctx, org.brokerOrgId);
    assertBrokerOrg(access);
    return {
      clientOrgId: org._id,
      name: org.name,
      website: org.website,
      primaryContactName: org.primaryContactName,
      primaryContactEmail: org.primaryContactEmail,
      primaryContactPhone: org.primaryContactPhone,
      customMessage: org.inviteCustomMessage,
      inviteStatus: org.inviteStatus,
    };
  },
});

export const checkInvitePhoneAvailability = query({
  args: {
    brokerOrgId: v.id("organizations"),
    email: v.string(),
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.brokerOrgId);
    assertBrokerOrg(access);
    const normalized = (() => {
      try {
        return normalizeUserPhone(args.phone);
      } catch {
        return undefined;
      }
    })();
    if (!normalized) return { available: false, normalized: "" };

    const existing = await findUserByNormalizedPhone(ctx, normalized);
    if (!existing) return { available: true, normalized };
    return {
      available: existing.email?.toLowerCase() === normalizeEmail(args.email),
      normalized,
    };
  },
});

/** Patch a draft (or invited, not yet accepted) client org's contact fields. */
export const updateDraftClient = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    clientOrgName: v.optional(v.string()),
    website: v.optional(v.string()),
    primaryContactEmail: v.optional(v.string()),
    primaryContactName: v.optional(v.string()),
    primaryContactPhone: v.optional(v.string()),
    customMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.clientOrgId);
    if (!org || org.type !== "client" || !org.brokerOrgId) throw new Error("Not found");
    if (org.inviteStatus !== "draft" && org.inviteStatus !== "invited") {
      throw new Error("Client has already been onboarded");
    }
    const access = await getOrgAccess(ctx, org.brokerOrgId);
    assertBrokerOrg(access);
    await assertImpersonatedSetupWrite(ctx, org.brokerOrgId);

    const patch: Record<string, unknown> = {};
    const email = args.primaryContactEmail
      ? normalizeEmail(args.primaryContactEmail)
      : org.primaryContactEmail;
    if (args.primaryContactEmail !== undefined && !email) {
      throw new Error("Client email is required");
    }
    if (email && (args.primaryContactEmail !== undefined || args.primaryContactName !== undefined || args.primaryContactPhone !== undefined)) {
      await upsertInvitedUser(ctx, {
        email,
        name: args.primaryContactName ?? org.primaryContactName,
        phone: args.primaryContactPhone,
      });
    }
    if (args.clientOrgName !== undefined) {
      const trimmed = args.clientOrgName.trim();
      if (trimmed) patch.name = trimmed;
    }
    if (args.website !== undefined) {
      patch.website = normalizeWebsite(args.website);
    }
    if (args.primaryContactEmail !== undefined) {
      patch.primaryContactEmail = email;
    }
    if (args.primaryContactName !== undefined) {
      patch.primaryContactName = args.primaryContactName.trim() || undefined;
    }
    if (args.primaryContactPhone !== undefined) {
      patch.primaryContactPhone = normalizeUserPhone(args.primaryContactPhone);
    }
    if (args.customMessage !== undefined) {
      patch.inviteCustomMessage = args.customMessage.trim() || undefined;
    }
    if (Object.keys(patch).length === 0) return;
    await ctx.db.patch(args.clientOrgId, patch);
  },
});

/** Delete a draft or invited-but-not-accepted client org. */
export const deleteDraftClient = mutation({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.clientOrgId);
    if (!org || org.type !== "client" || !org.brokerOrgId) throw new Error("Not found");
    if (org.inviteStatus !== "draft" && org.inviteStatus !== "invited") {
      throw new Error("Cannot delete: client has accepted the invite");
    }
    const access = await getOrgAccess(ctx, org.brokerOrgId);
    assertBrokerOrg(access);
    await assertImpersonatedSetupWrite(ctx, org.brokerOrgId);

    // Revoke any pending invitations for this org
    const invites = await ctx.db
      .query("clientInvitations")
      .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", org.brokerOrgId!))
      .collect();
    for (const inv of invites) {
      if (inv.clientOrgId === args.clientOrgId && inv.status === "pending") {
        await ctx.db.patch(inv._id, { status: "revoked" });
      }
    }

    // Soft delete the attached policies
    const policies = await ctx.db
      .query("policies")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.clientOrgId))
      .collect();
    for (const p of policies) {
      if (!p.deletedAt) await ctx.db.patch(p._id, { deletedAt: Date.now() });
    }

    // Remove assignments + memberships (draft orgs shouldn't have any, but be safe)
    const assignments = await ctx.db
      .query("brokerClientAssignments")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", args.clientOrgId))
      .collect();
    for (const a of assignments) await ctx.db.delete(a._id);

    await ctx.db.delete(args.clientOrgId);
  },
});

/** Send the invite email for a draft client org. Flips status draft → invited. */
export const sendDraftInvite = action({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    await ctx.runQuery(internal.users.requireCustomerUserInternal, { userId });

    const draft = await ctx.runQuery(internal.clientInvitations.getDraftContextInternal, {
      clientOrgId: args.clientOrgId,
      userId,
    });
    if (!draft) {
      throwUserFacingError(
        userFacingErrorCodes.orgAccessRequired,
        "This client draft was not found or you no longer have access to it.",
      );
    }
    if (!draft.primaryContactEmail) throw new Error("Primary contact email required");

    const rawToken = randomToken();
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = Date.now() + 14 * 24 * 60 * 60 * 1000;

    await ctx.runMutation(internal.clientInvitations.insertInvitation, {
      brokerOrgId: draft.brokerOrgId,
      clientOrgName: draft.name,
      primaryContactEmail: draft.primaryContactEmail,
      primaryContactName: draft.primaryContactName,
      invitedBy: userId,
      inviteTokenHash: tokenHash,
      status: "pending",
      expiresAt,
      createdAt: Date.now(),
    });

    // Link invitation ↔ client org + flip status to invited. Resends revoke
    // older pending tokens for the same draft so only the newest link works.
    await ctx.runMutation(internal.clientInvitations.attachInvitationToDraft, {
      clientOrgId: args.clientOrgId,
      tokenHash,
    });

    const brokerOrg = await ctx.runQuery(internal.clientInvitations.getOrgInternal, {
      orgId: draft.brokerOrgId,
    });
    const brokerName = brokerOrg?.name ?? "Your broker";
    const siteUrl = getAuthSiteUrl();
    const inviteUrl = `${siteUrl}/invite/${rawToken}`;
    const recipient = draft.primaryContactName
      ? `${draft.primaryContactName} <${draft.primaryContactEmail}>`
      : draft.primaryContactEmail;

    const whiteLabelingEnabled = isWhiteLabelingEnabled(brokerOrg);
    const brokerLogoUrl = whiteLabelingEnabled && brokerOrg?.iconStorageId
      ? await ctx.storage.getUrl(brokerOrg.iconStorageId)
      : null;
    const branding = whiteLabelingEnabled
      ? getBrandingContext({
          agentDisplayName: brokerOrg?.name,
          brandingColor: brokerOrg?.brandingColor,
          logoUrl: brokerLogoUrl ?? undefined,
        })
      : getBrandingContext();

    const subject = `${brokerName} invited you to Glass`;
    const messageBlock = draft.customMessage
      ? `<tr><td style="padding:12px 40px 0 40px;"><p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#4b5563;line-height:1.6;font-style:italic;">"${draft.customMessage.replace(/</g, "&lt;")}"</p></td></tr>`
      : "";
    const text = `${brokerName} has invited you${draft.name ? ` (${draft.name})` : ""} to Glass.\n${draft.customMessage ? `\n"${draft.customMessage}"\n` : ""}\nAccept your invitation:\n${inviteUrl}\n\nThis link expires in 14 days.\n\n—\nGlass from Clarity Labs`;
    const bodyHtml = `
<tr><td style="padding:28px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#374151;line-height:1.6;">
    <strong>${brokerName}</strong> has invited you${draft.name ? ` (<strong>${draft.name}</strong>)` : ""} to Glass — a shared workspace for your policies and documents.
  </p>
</td></tr>
${messageBlock}
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <a href="${inviteUrl}" style="display:inline-block;padding:8px 22px;background-color:#000000;color:#ffffff;font-family:-apple-system,sans-serif;font-size:14px;font-weight:500;text-decoration:none;border-radius:999px;line-height:1.4;">Accept invitation</a>
</td></tr>
<tr><td style="padding:20px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,sans-serif;font-size:12px;color:#6b7280;line-height:1.6;">
    Or copy this link:<br><a href="${inviteUrl}" style="color:#6b7280;word-break:break-all;">${inviteUrl}</a>
  </p>
</td></tr>
<tr><td style="padding:16px 40px 32px 40px;">
  <p style="margin:0;font-family:-apple-system,sans-serif;font-size:11px;color:#9ca3af;">This invitation expires in 14 days.</p>
</td></tr>`;
    const html = buildEmailShell({ title: subject, bodyHtml, branding, siteUrl });

    const result = await sendResendEmail(
      {
        from: getAuthFromAddress(brokerName),
        to: recipient,
        subject,
        html,
        text,
      },
      { retries: 2 },
    );

    if (!result.ok) {
      throw new Error(`Failed to send invite email: ${result.error}`);
    }

    return { token: rawToken };
  },
});

/** Revoke a pending invitation. Broker admin only. */
export const revoke = mutation({
  args: {
    orgId: v.id("organizations"),
    invitationId: v.id("clientInvitations"),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.orgId);
    assertBrokerOrg(access);
    if (access.role !== "admin") {
      throwUserFacingError(
        userFacingErrorCodes.orgAdminRequired,
        "Only an organization admin can revoke invitations.",
      );
    }

    const inv = await ctx.db.get(args.invitationId);
    if (!inv || inv.brokerOrgId !== args.orgId) throw new Error("Invitation not found");
    if (inv.status !== "pending") throw new Error("Only pending invitations can be revoked");

    await ctx.db.patch(args.invitationId, { status: "revoked" });
  },
});

/** List all client invitations for a broker org. */
export const list = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.orgId);
    assertBrokerOrg(access);

    return await ctx.db
      .query("clientInvitations")
      .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", args.orgId))
      .order("desc")
      .collect();
  },
});

/**
 * Public (unauthenticated) — look up invite metadata for the acceptance page.
 * Returns broker branding + prefill data. Does NOT return the tokenHash.
 */
export const getByToken = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.token);
    const inv = await ctx.runQuery(internal.clientInvitations.getByHashInternal, { tokenHash });
    if (!inv) throw new Error("Invitation not found");

    if (inv.status === "revoked") throw new Error("This invitation has been revoked");
    if (inv.status === "expired") throw new Error("This invitation has expired");
    if (inv.expiresAt && inv.expiresAt < Date.now()) {
      await ctx.runMutation(internal.clientInvitations.markExpired, { invitationId: inv._id });
      throw new Error("This invitation has expired");
    }
    if (inv.status === "accepted") {
      throw new Error("This invitation has already been accepted");
    }

    const brokerOrg = await ctx.runQuery(internal.clientInvitations.getOrgInternal, {
      orgId: inv.brokerOrgId,
    });

    return {
      invitationId: inv._id,
      brokerName: brokerOrg?.name ?? "Your Broker",
      whiteLabelingEnabled: isWhiteLabelingEnabled(brokerOrg),
      brokerIconUrl: isWhiteLabelingEnabled(brokerOrg) && brokerOrg?.iconStorageId
        ? await ctx.storage.getUrl(brokerOrg.iconStorageId)
        : null,
      brokerWebsite: brokerOrg?.website,
      brokerSlug: brokerOrg?.slug,
      brandingColor: isWhiteLabelingEnabled(brokerOrg) ? brokerOrg?.brandingColor : undefined,
      agentDisplayName: isWhiteLabelingEnabled(brokerOrg) ? brokerOrg?.agentDisplayName : undefined,
      clientOrgName: inv.clientOrgName,
      primaryContactEmail: inv.primaryContactEmail,
      primaryContactName: inv.primaryContactName,
      prefillPassport: inv.prefillPassport,
    };
  },
});

/**
 * Retrieve the stashed OTP code for this invite's email. The invite token
 * itself proves email ownership, so we hand back the code so the client can
 * auto-submit it via signIn() without the user retyping anything.
 */
export const getInviteOtpCode = action({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{ email: string; code: string } | null> => {
    const tokenHash = await sha256Hex(args.token);
    const inv = await ctx.runQuery(internal.clientInvitations.getByHashInternal, { tokenHash });
    if (!inv) return null;
    if (inv.status !== "pending") return null;
    if (inv.expiresAt && inv.expiresAt < Date.now()) return null;
    if (!inv.otpCode || !inv.primaryContactEmail) return null;
    if (inv.otpCodeExpiresAt && inv.otpCodeExpiresAt < Date.now()) return null;
    return { email: inv.primaryContactEmail, code: inv.otpCode };
  },
});

/**
 * Accept a client invitation. Caller must already be authenticated.
 * Idempotent per broker (reuses existing membership if present).
 */
export const acceptInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    await assertCustomerUser(ctx, userId);

    const tokenHash = await sha256Hex(args.token);
    const inv = await ctx.db
      .query("clientInvitations")
      .withIndex("by_tokenHash", (q) => q.eq("inviteTokenHash", tokenHash))
      .first();

    if (!inv) throw new Error("Invitation not found");
    if (inv.status === "revoked") throw new Error("This invitation has been revoked");
    if (inv.status === "expired") throw new Error("This invitation has expired");
    if (inv.expiresAt && inv.expiresAt < Date.now()) {
      await ctx.db.patch(inv._id, { status: "expired" });
      throw new Error("This invitation has expired");
    }

    const { clientOrgId, reused } = await ensureClientMembership(ctx, {
      userId,
      brokerOrgId: inv.brokerOrgId,
      draftOrgId: inv.clientOrgId,
      nameHint: inv.clientOrgName,
    });

    await ctx.db.patch(inv._id, { status: "accepted", clientOrgId });

    if (!reused) {
      const acceptingUser = await ctx.db.get(userId);
      const orgDoc = await ctx.db.get(clientOrgId);
      await recordBrokerActivity(ctx, {
        brokerOrgId: inv.brokerOrgId,
        clientOrgId,
        type: "invitation_accepted",
        actorUserId: userId,
        actorSide: "client",
        summary: `${acceptingUser?.name ?? acceptingUser?.email ?? "A client"} accepted the invitation to join.`,
        payload: { invitationId: inv._id },
      });
      await notify(ctx, {
        orgId: inv.brokerOrgId,
        type: "client_invitation_accepted",
        title: "Client accepted your invitation",
        body: `${orgDoc?.name ?? "A client"} accepted your invitation and joined Glass.`,
        relatedOrgId: clientOrgId,
        actionType: "view_client",
        actionPayload: { clientOrgId },
      });
    }

    return { clientOrgId };
  },
});

// ── Internal helpers used by actions ─────────────────────────────────────────

export const insertInvitation = internalMutation({
  args: {
    brokerOrgId: v.id("organizations"),
    clientOrgName: v.optional(v.string()),
    primaryContactEmail: v.optional(v.string()),
    primaryContactName: v.optional(v.string()),
    prefillPassport: v.optional(v.any()),
    invitedBy: v.id("users"),
    inviteTokenHash: v.string(),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired"), v.literal("revoked")),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("clientInvitations", args);
  },
});

export const getByHashInternal = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    return await ctx.db
      .query("clientInvitations")
      .withIndex("by_tokenHash", (q) => q.eq("inviteTokenHash", tokenHash))
      .first();
  },
});

export const getOrgInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    return await ctx.db.get(orgId);
  },
});

export const getDraftContextInternal = internalQuery({
  args: { clientOrgId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, { clientOrgId, userId }) => {
    const org = await ctx.db.get(clientOrgId);
    if (!org || org.type !== "client" || !org.brokerOrgId) return null;
    if (org.inviteStatus !== "draft" && org.inviteStatus !== "invited") return null;

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) => q.eq("orgId", org.brokerOrgId!).eq("userId", userId))
      .first();
    if (!membership) return null;

    return {
      brokerOrgId: org.brokerOrgId,
      name: org.name,
      primaryContactName: org.primaryContactName,
      primaryContactEmail: org.primaryContactEmail,
      customMessage: org.inviteCustomMessage,
    };
  },
});

export const attachInvitationToDraft = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    tokenHash: v.string(),
  },
  handler: async (ctx, { clientOrgId, tokenHash }) => {
    const inv = await ctx.db
      .query("clientInvitations")
      .withIndex("by_tokenHash", (q) => q.eq("inviteTokenHash", tokenHash))
      .first();
    if (inv) {
      const previousInvites = await ctx.db
        .query("clientInvitations")
        .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", inv.brokerOrgId))
        .collect();
      for (const previous of previousInvites) {
        if (
          previous.clientOrgId === clientOrgId &&
          previous.status === "pending" &&
          previous._id !== inv._id
        ) {
          await ctx.db.patch(previous._id, { status: "revoked" });
        }
      }
      await ctx.db.patch(inv._id, { clientOrgId });
    }
    await ctx.db.patch(clientOrgId, { inviteStatus: "invited" });
  },
});

export const markExpired = internalMutation({
  args: { invitationId: v.id("clientInvitations") },
  handler: async (ctx, { invitationId }) => {
    await ctx.db.patch(invitationId, { status: "expired" });
  },
});

export const resolveAccessInternal = internalQuery({
  args: {
    userId: v.id("users"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, { userId, orgId }) => {
    const org = await ctx.db.get(orgId);
    if (!org) return null;
    const orgType = (org.type as "broker" | "client") ?? "client";

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) => q.eq("orgId", orgId).eq("userId", userId))
      .first();

    if (membership) return { orgType, accessType: "member" as const, role: membership.role };

    if (orgType === "client" && org.brokerOrgId) {
      const bm = await ctx.db
        .query("orgMemberships")
        .withIndex("by_orgId_userId", (q) =>
          q.eq("orgId", org.brokerOrgId!).eq("userId", userId),
        )
        .first();
      if (bm) return { orgType: "client" as const, accessType: "broker_of_client" as const, role: undefined };
    }

    return null;
  },
});
