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
import { sendResendEmail, getNotificationFromAddress } from "./lib/resend";

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Hash a raw token string to SHA-256 hex using Web Crypto API.
 */
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

function isEmailLike(value: string | undefined | null): boolean {
  if (!value) return false;
  const normalized = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

function companyNameFromEmail(email: string | undefined): string | null {
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

function resolveClientOrgName(args: {
  requestedName: string;
  invitationName?: string;
  fallbackEmail?: string;
}): string {
  const requested = args.requestedName.trim();
  if (requested && !isEmailLike(requested)) return requested;

  const invitationName = args.invitationName?.trim();
  if (invitationName && !isEmailLike(invitationName)) return invitationName;

  const fromEmail = companyNameFromEmail(args.fallbackEmail);
  if (fromEmail) return fromEmail;

  return "Client Organization";
}

// ── Public mutations / queries ─────────────────────────────────────────────────

// ── Permanent shareable link (one per broker org) ────────────────────────────

/**
 * Get or create the broker's permanent shareable invite link.
 * Returns the raw token so the broker can copy `/invite/<token>` any time.
 */
export const getOrCreatePermaInviteLink = action({
  args: { brokerOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const access = await ctx.runQuery(internal.clientInvitations.resolveAccessInternal, {
      userId,
      orgId: args.brokerOrgId,
    });
    if (!access) throw new Error("Unauthorized");
    if (access.orgType !== "broker") throw new Error("Only broker orgs have shareable links");
    if (access.accessType !== "member") throw new Error("Must be a broker org member");

    const existing = await ctx.runQuery(internal.clientInvitations.findPermaInternal, {
      brokerOrgId: args.brokerOrgId,
    });
    if (existing && existing.rawToken) return { token: existing.rawToken };

    const rawToken = randomToken();
    const tokenHash = await sha256Hex(rawToken);
    await ctx.runMutation(internal.clientInvitations.insertInvitation, {
      brokerOrgId: args.brokerOrgId,
      invitedBy: userId,
      inviteTokenHash: tokenHash,
      linkType: "shareable",
      status: "pending",
      acceptedCount: 0,
      createdAt: Date.now(),
      isPerma: true,
      rawToken,
    });

    return { token: rawToken };
  },
});

// ── Draft client flow ────────────────────────────────────────────────────────
//
// Brokers create a "draft" client org up front so they can attach policy
// uploads + contact details before the invite email goes out. When they send
// the invite, the org flips from draft → invited and the invitation record is
// created. When the client accepts, the org transitions to active (inviteStatus
// cleared) and the invitation links to the already-existing org.

/** Create a draft client org. Broker members only. */
export const createDraftClient = mutation({
  args: {
    brokerOrgId: v.id("organizations"),
    clientOrgName: v.string(),
    primaryContactEmail: v.string(),
    primaryContactName: v.optional(v.string()),
    customMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.brokerOrgId);
    assertBrokerOrg(access);

    const name = args.clientOrgName.trim() || "Draft client";
    const clientOrgId = await ctx.db.insert("organizations", {
      name,
      type: "client",
      brokerOrgId: args.brokerOrgId,
      inviteStatus: "draft",
      primaryContactName: args.primaryContactName?.trim() || undefined,
      primaryContactEmail: args.primaryContactEmail.trim(),
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
      primaryContactName: org.primaryContactName,
      primaryContactEmail: org.primaryContactEmail,
      customMessage: org.inviteCustomMessage,
      inviteStatus: org.inviteStatus,
    };
  },
});

/** Patch a draft (or invited, not yet accepted) client org's contact fields. */
export const updateDraftClient = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    clientOrgName: v.optional(v.string()),
    primaryContactEmail: v.optional(v.string()),
    primaryContactName: v.optional(v.string()),
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

    const patch: Record<string, unknown> = {};
    if (args.clientOrgName !== undefined) {
      const trimmed = args.clientOrgName.trim();
      if (trimmed) patch.name = trimmed;
    }
    if (args.primaryContactEmail !== undefined) {
      patch.primaryContactEmail = args.primaryContactEmail.trim() || undefined;
    }
    if (args.primaryContactName !== undefined) {
      patch.primaryContactName = args.primaryContactName.trim() || undefined;
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
    if (!userId) throw new Error("Not authenticated");

    const draft = await ctx.runQuery(internal.clientInvitations.getDraftContextInternal, {
      clientOrgId: args.clientOrgId,
      userId,
    });
    if (!draft) throw new Error("Draft not found or unauthorized");
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
      linkType: "email",
      status: "pending",
      expiresAt,
      createdAt: Date.now(),
    });

    // Link invitation ↔ client org + flip status to invited
    await ctx.runMutation(internal.clientInvitations.attachInvitationToDraft, {
      clientOrgId: args.clientOrgId,
      tokenHash,
    });

    const brokerOrg = await ctx.runQuery(internal.clientInvitations.getOrgInternal, {
      orgId: draft.brokerOrgId,
    });
    const brokerName = brokerOrg?.name ?? "Your broker";
    const siteUrl = process.env.SITE_URL ?? "https://glass.claritylabs.dev";
    const inviteUrl = `${siteUrl}/invite/${rawToken}`;
    const recipient = draft.primaryContactName
      ? `${draft.primaryContactName} <${draft.primaryContactEmail}>`
      : draft.primaryContactEmail;

    const brokerLogoUrl = brokerOrg?.iconStorageId
      ? await ctx.storage.getUrl(brokerOrg.iconStorageId)
      : null;
    const glassLogoUrl = `${siteUrl}/glass-logo-email.jpg`;
    const headerLogoHtml = brokerLogoUrl
      ? `<img src="${brokerLogoUrl}" alt="${brokerName}" height="48" style="display:block;border:0;border-radius:8px;" />`
      : `<img src="${glassLogoUrl}" alt="Glass by Clarity Labs" height="48" style="display:block;border:0;" />`;

    const subject = `${brokerName} invited you to Glass`;
    const messageBlock = draft.customMessage
      ? `<tr><td style="padding:12px 40px 0 40px;"><p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#4b5563;line-height:1.6;font-style:italic;">"${draft.customMessage.replace(/</g, "&lt;")}"</p></td></tr>`
      : "";
    const text = `${brokerName} has invited you${draft.name ? ` (${draft.name})` : ""} to Glass.\n${draft.customMessage ? `\n"${draft.customMessage}"\n` : ""}\nAccept your invitation:\n${inviteUrl}\n\nThis link expires in 14 days.\n\n—\nGlass by Clarity Labs`;
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background-color:#f9fafb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#ffffff;border-radius:12px;border:1px solid rgba(0,0,0,0.06);">
<tr><td align="center" style="padding:32px 40px 0 40px;">${headerLogoHtml}</td></tr>
<tr><td style="padding:24px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#374151;line-height:1.6;">
    <strong>${brokerName}</strong> has invited you${draft.name ? ` (<strong>${draft.name}</strong>)` : ""} to Glass — a shared workspace for your applications, policies, and documents.
  </p>
</td></tr>
${messageBlock}
<tr><td align="center" style="padding:28px 40px 0 40px;">
  <a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background-color:#111827;color:#ffffff;font-family:-apple-system,sans-serif;font-size:14px;font-weight:500;text-decoration:none;border-radius:999px;">Accept invitation</a>
</td></tr>
<tr><td style="padding:20px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,sans-serif;font-size:12px;color:#6b7280;line-height:1.6;">
    Or copy this link:<br><a href="${inviteUrl}" style="color:#6b7280;word-break:break-all;">${inviteUrl}</a>
  </p>
</td></tr>
<tr><td style="padding:20px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,sans-serif;font-size:11px;color:#9ca3af;">This invitation expires in 14 days.</p>
</td></tr>
<tr><td style="padding:28px 40px 0 40px;"><div style="height:1px;background-color:rgba(0,0,0,0.06);"></div></td></tr>
<tr><td align="center" style="padding:20px 40px 28px 40px;">
  <img src="${glassLogoUrl}" alt="Glass by Clarity Labs" height="24" style="display:block;border:0;margin:0 auto 8px auto;" />
  <p style="margin:0;font-family:-apple-system,sans-serif;font-size:11px;color:#9ca3af;line-height:1.5;">
    Sent via Glass by Clarity Labs${brokerOrg ? ` on behalf of ${brokerName}` : ""}
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    const result = await sendResendEmail(
      {
        from: getNotificationFromAddress(brokerName),
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

/**
 * Create an email client invitation.
 * Broker admins/members create these for a specific contact.
 */
export const createEmail = action({
  args: {
    orgId: v.id("organizations"),
    clientOrgName: v.optional(v.string()),
    primaryContactEmail: v.string(),
    primaryContactName: v.optional(v.string()),
    prefillPassport: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const access = await ctx.runQuery(internal.clientInvitations.resolveAccessInternal, {
      userId,
      orgId: args.orgId,
    });
    if (!access) throw new Error("Unauthorized");
    if (access.orgType !== "broker") throw new Error("Only broker orgs can invite clients");
    if (access.accessType !== "member") throw new Error("Must be a broker org member");

    const rawToken = randomToken();
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = Date.now() + 14 * 24 * 60 * 60 * 1000; // 14 days

    await ctx.runMutation(internal.clientInvitations.insertInvitation, {
      brokerOrgId: args.orgId,
      clientOrgName: args.clientOrgName,
      primaryContactEmail: args.primaryContactEmail,
      primaryContactName: args.primaryContactName,
      prefillPassport: args.prefillPassport,
      invitedBy: userId,
      inviteTokenHash: tokenHash,
      linkType: "email",
      status: "pending",
      expiresAt,
      createdAt: Date.now(),
    });

    const brokerOrg = await ctx.runQuery(internal.clientInvitations.getOrgInternal, {
      orgId: args.orgId,
    });
    const brokerName = brokerOrg?.name ?? "Your broker";
    const siteUrl = process.env.SITE_URL ?? "https://glass.claritylabs.dev";
    const inviteUrl = `${siteUrl}/invite/${rawToken}`;
    const recipient = args.primaryContactName
      ? `${args.primaryContactName} <${args.primaryContactEmail}>`
      : args.primaryContactEmail;

    const brokerLogoUrl = brokerOrg?.iconStorageId
      ? await ctx.storage.getUrl(brokerOrg.iconStorageId)
      : null;
    const glassLogoUrl = `${siteUrl}/glass-logo-email.jpg`;
    const headerLogoHtml = brokerLogoUrl
      ? `<img src="${brokerLogoUrl}" alt="${brokerName}" height="48" style="display:block;border:0;border-radius:8px;" />`
      : `<img src="${glassLogoUrl}" alt="Glass by Clarity Labs" height="48" style="display:block;border:0;" />`;

    const subject = `${brokerName} invited you to Glass`;
    const text = `${brokerName} has invited you${args.clientOrgName ? ` (${args.clientOrgName})` : ""} to Glass.\n\nAccept your invitation:\n${inviteUrl}\n\nThis link expires in 14 days.\n\n—\nGlass by Clarity Labs`;
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background-color:#f9fafb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#ffffff;border-radius:12px;border:1px solid rgba(0,0,0,0.06);">
<tr><td align="center" style="padding:32px 40px 0 40px;">${headerLogoHtml}</td></tr>
<tr><td style="padding:24px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#374151;line-height:1.6;">
    <strong>${brokerName}</strong> has invited you${args.clientOrgName ? ` (<strong>${args.clientOrgName}</strong>)` : ""} to Glass — a shared workspace for your applications, policies, and documents.
  </p>
</td></tr>
<tr><td align="center" style="padding:28px 40px 0 40px;">
  <a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background-color:#111827;color:#ffffff;font-family:-apple-system,sans-serif;font-size:14px;font-weight:500;text-decoration:none;border-radius:999px;">Accept invitation</a>
</td></tr>
<tr><td style="padding:20px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,sans-serif;font-size:12px;color:#6b7280;line-height:1.6;">
    Or copy this link:<br><a href="${inviteUrl}" style="color:#6b7280;word-break:break-all;">${inviteUrl}</a>
  </p>
</td></tr>
<tr><td style="padding:20px 40px 0 40px;">
  <p style="margin:0;font-family:-apple-system,sans-serif;font-size:11px;color:#9ca3af;">This invitation expires in 14 days.</p>
</td></tr>
<tr><td style="padding:28px 40px 0 40px;"><div style="height:1px;background-color:rgba(0,0,0,0.06);"></div></td></tr>
<tr><td align="center" style="padding:20px 40px 28px 40px;">
  <img src="${glassLogoUrl}" alt="Glass by Clarity Labs" height="24" style="display:block;border:0;margin:0 auto 8px auto;" />
  <p style="margin:0;font-family:-apple-system,sans-serif;font-size:11px;color:#9ca3af;line-height:1.5;">
    Sent via Glass by Clarity Labs${brokerOrg ? ` on behalf of ${brokerName}` : ""}
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    const result = await sendResendEmail(
      {
        from: getNotificationFromAddress(brokerName),
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

/**
 * Create a shareable client invitation link.
 */
export const createShareable = action({
  args: {
    orgId: v.id("organizations"),
    maxUses: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const access = await ctx.runQuery(internal.clientInvitations.resolveAccessInternal, {
      userId,
      orgId: args.orgId,
    });
    if (!access) throw new Error("Unauthorized");
    if (access.orgType !== "broker") throw new Error("Only broker orgs can create shareable links");
    if (access.accessType !== "member") throw new Error("Must be a broker org member");

    const rawToken = randomToken();
    const tokenHash = await sha256Hex(rawToken);

    await ctx.runMutation(internal.clientInvitations.insertInvitation, {
      brokerOrgId: args.orgId,
      invitedBy: userId,
      inviteTokenHash: tokenHash,
      linkType: "shareable",
      status: "pending",
      acceptedCount: 0,
      maxUses: args.maxUses,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });

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
    if (access.role !== "admin") throw new Error("Admin role required to revoke invitations");

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
    if (inv.linkType === "email" && inv.status === "accepted") {
      throw new Error("This invitation has already been accepted");
    }
    if (inv.maxUses !== undefined && (inv.acceptedCount ?? 0) >= inv.maxUses) {
      throw new Error("This invitation link has reached its maximum uses");
    }

    const brokerOrg = await ctx.runQuery(internal.clientInvitations.getOrgInternal, {
      orgId: inv.brokerOrgId,
    });

    return {
      invitationId: inv._id,
      linkType: inv.linkType,
      brokerName: brokerOrg?.name ?? "Your Broker",
      brokerIconUrl: brokerOrg?.iconStorageId
        ? await ctx.storage.getUrl(brokerOrg.iconStorageId)
        : null,
      brokerWebsite: brokerOrg?.website,
      brokerSlug: brokerOrg?.slug,
      brandingColor: brokerOrg?.brandingColor,
      agentDisplayName: brokerOrg?.agentDisplayName,
      clientOrgName: inv.clientOrgName,
      primaryContactEmail: inv.primaryContactEmail,
      primaryContactName: inv.primaryContactName,
      prefillPassport: inv.prefillPassport,
    };
  },
});

/**
 * Accept a client invitation.
 * Creates a new client org + makes the calling user an admin of it.
 * Caller must already be authenticated (signed up or logged in just before calling this).
 */
export const accept = mutation({
  args: {
    token: v.string(),
    clientOrgName: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // We can't call the action sha256Hex inside a mutation — token lookup uses
    // a pre-hashed index. Accept receives the raw token, hashes it inline using
    // Web Crypto (available in Convex mutation runtime via TextEncoder).
    // Convex mutations run in V8; use subtle crypto.
    const encoder = new TextEncoder();
    const data = encoder.encode(args.token);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

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
    if (inv.linkType === "email" && inv.status === "accepted") {
      throw new Error("This invitation has already been accepted");
    }
    if (inv.maxUses !== undefined && (inv.acceptedCount ?? 0) >= inv.maxUses) {
      throw new Error("This invitation link has reached its maximum uses");
    }

    const acceptingUser = await ctx.db.get(userId);
    const orgName = resolveClientOrgName({
      requestedName: args.clientOrgName,
      invitationName: inv.clientOrgName,
      fallbackEmail: inv.primaryContactEmail ?? acceptingUser?.email,
    });

    // If the invitation was created from a draft, the client org already exists —
    // reuse it instead of creating a duplicate.
    let clientOrgId: DataModelId<"organizations">;
    if (inv.clientOrgId && inv.linkType === "email") {
      const existing = await ctx.db.get(inv.clientOrgId);
      if (!existing) throw new Error("Client organization missing");
      clientOrgId = inv.clientOrgId;
      await ctx.db.patch(clientOrgId, {
        name: orgName,
        inviteStatus: undefined,
        draftCreatedByUserId: undefined,
      });
    } else {
      clientOrgId = await ctx.db.insert("organizations", {
        name: orgName,
        type: "client",
        brokerOrgId: inv.brokerOrgId,
      });
      // Record explicit broker–client assignment (only for legacy/shareable path)
      await ctx.db.insert("brokerClientAssignments", {
        orgId: inv.brokerOrgId,
        clientOrgId,
        producerId: inv.invitedBy,
        role: "primary",
        createdAt: Date.now(),
      });
    }

    // Make the accepting user admin of the client org
    await ctx.db.insert("orgMemberships", {
      orgId: clientOrgId,
      userId,
      role: "admin",
    });

    // Update invitation
    if (inv.linkType === "email") {
      await ctx.db.patch(inv._id, { status: "accepted", clientOrgId });
    } else {
      await ctx.db.patch(inv._id, {
        acceptedCount: (inv.acceptedCount ?? 0) + 1,
        clientOrgId, // last accepted org for reference
      });
    }

    // Record broker activity
    await recordBrokerActivity(ctx, {
      brokerOrgId: inv.brokerOrgId,
      clientOrgId,
      type: "invitation_accepted",
      actorUserId: userId,
      actorSide: "client",
      summary: `${acceptingUser?.name ?? acceptingUser?.email ?? "A client"} accepted the invitation to join.`,
      payload: { invitationId: inv._id },
    });

    // Notify broker of invitation acceptance
    await notify(ctx, {
      orgId: inv.brokerOrgId,
      type: "client_invitation_accepted",
      title: "Client accepted your invitation",
      body: `${orgName} accepted your invitation and joined Glass.`,
      relatedOrgId: clientOrgId,
      actionType: "view_client",
      actionPayload: { clientOrgId },
    });

    // Pre-fill passport with invite data
    const inviteeEmail = inv.primaryContactEmail ?? acceptingUser?.email;
    const inviteeName = inv.primaryContactName ?? acceptingUser?.name;
    const companyName = orgName;

    const passportPatch: Record<string, unknown> = {};
    if (inviteeEmail) passportPatch.primaryContactEmail = inviteeEmail;
    if (inviteeName) passportPatch.primaryContactName = inviteeName;
    if (companyName) passportPatch.legalName = companyName;

    if (Object.keys(passportPatch).length > 0) {
      await ctx.runMutation(internal.clientPassport.upsertCoreInternal, {
        clientOrgId,
        patch: passportPatch,
        actorUserId: userId,
      });

      // Write provenance rows for invite-sourced fields
      const now = Date.now();
      if (inviteeEmail) {
        await ctx.runMutation(internal.passportSideTables.upsertProvenance, {
          clientOrgId,
          fieldPath: "primaryContactEmail",
          source: "invite",
          confidence: "confirmed",
          sourceLabel: "Broker invite",
          setAt: now,
        });
      }
      if (inviteeName) {
        await ctx.runMutation(internal.passportSideTables.upsertProvenance, {
          clientOrgId,
          fieldPath: "primaryContactName",
          source: "invite",
          confidence: "confirmed",
          sourceLabel: "Broker invite",
          setAt: now,
        });
      }
      if (companyName) {
        await ctx.runMutation(internal.passportSideTables.upsertProvenance, {
          clientOrgId,
          fieldPath: "legalName",
          source: "invite",
          confidence: "confirmed",
          sourceLabel: "Broker invite",
          setAt: now,
        });
      }
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
    linkType: v.union(v.literal("email"), v.literal("shareable")),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired"), v.literal("revoked")),
    acceptedCount: v.optional(v.number()),
    maxUses: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    isPerma: v.optional(v.boolean()),
    rawToken: v.optional(v.string()),
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

export const findPermaInternal = internalQuery({
  args: { brokerOrgId: v.id("organizations") },
  handler: async (ctx, { brokerOrgId }) => {
    return await ctx.db
      .query("clientInvitations")
      .withIndex("by_brokerOrgId_isPerma", (q) =>
        q.eq("brokerOrgId", brokerOrgId).eq("isPerma", true),
      )
      .first();
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
    if (inv) await ctx.db.patch(inv._id, { clientOrgId });
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
