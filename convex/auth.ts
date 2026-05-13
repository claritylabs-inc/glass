import { convexAuth } from "@convex-dev/auth/server";
import { Email } from "@convex-dev/auth/providers/Email";
import { buildOtpEmail } from "./lib/emailTemplate";
import { getBrandingContext, isWhiteLabelingEnabled } from "./lib/branding";
import { sendResendEmail, getAuthFromAddress } from "./lib/resend";
import { internal } from "./_generated/api";


const sendVerificationRequest = async function (this: unknown, ...args: any[]) {
  const [{ identifier: email, token }, ctx] = args as [
    { identifier: string; token: string },

    any,
  ];
  // Try to infer a broker branding context from the signed-in attempt:
    // look for the most recent pending client invitation addressed to this
    // email, and use its broker's branding if found.
    let brokerBranding: {
      name: string;
      brandingColor?: string;
      agentDisplayName?: string;
      iconUrl?: string | null;
    } | null = null;
    try {
      brokerBranding = await ctx.runQuery(internal.auth.brokerBrandingForEmail, {
        email,
      });
    } catch {
      brokerBranding = null;
    }

    // Stash the OTP on any pending invite for this email so that invite
    // acceptance UIs can auto-verify. The invite link itself proves email
    // ownership, so the user shouldn't have to enter the code.
    let hasPendingInvite = false;
    try {
      const stashed = await ctx.runMutation(internal.auth.stashInviteOtp, {
        email,
        code: token,
      });
      hasPendingInvite = !!stashed;
    } catch {
      // Non-fatal: fall back to normal OTP flow.
    }

    // When the user is arriving via an invite link, suppress the generic OTP
    // email — the invite email already covers verification.
    if (hasPendingInvite) return;

    const branding = brokerBranding
      ? getBrandingContext({
          agentDisplayName: brokerBranding.agentDisplayName ?? brokerBranding.name,
          brandingColor: brokerBranding.brandingColor,
          logoUrl: brokerBranding.iconUrl ?? undefined,
        })
      : getBrandingContext();

    const { html, text } = buildOtpEmail(token, undefined, branding);
    const subjectBrand = brokerBranding?.name ?? "Glass from Clarity Labs";
    const subject = `Your ${subjectBrand} sign-in code`;
    const fromName = brokerBranding?.name ? `${brokerBranding.name} Login` : undefined;
    const result = await sendResendEmail({
      from: getAuthFromAddress(fromName),
      to: email,
      subject,
      html,
      text,
    });
    if (!result.ok) {
      throw new Error("Failed to send verification email: " + result.error);
    }
};

const ResendOTP = Email({
  id: "resend-otp",
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  },

  sendVerificationRequest: sendVerificationRequest as any,
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [ResendOTP],
});

// ── Internal query: find a broker to brand the sign-in email for ─────────────
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const stashInviteOtp = internalMutation({
  args: { email: v.string(), code: v.string() },
  handler: async (ctx, { email, code }) => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return false;
    const pendingInvites = await ctx.db
      .query("clientInvitations")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const pendingVendorInvites = await ctx.db
      .query("connectedOrgInvitations")
      .withIndex("by_vendorEmail", (q) => q.eq("vendorEmail", normalized))
      .collect();
    const expiresAt = Date.now() + 15 * 60 * 1000; // mirror OTP maxAge
    let matched = false;
    for (const inv of pendingInvites) {
      if (inv.primaryContactEmail?.trim().toLowerCase() === normalized) {
        await ctx.db.patch(inv._id, {
          otpCode: code,
          otpCodeExpiresAt: expiresAt,
        });
        matched = true;
      }
    }
    for (const inv of pendingVendorInvites) {
      if (inv.status === "pending" && inv.expiresAt > Date.now()) {
        await ctx.db.patch(inv._id, {
          otpCode: code,
          otpCodeExpiresAt: expiresAt,
        });
        matched = true;
      }
    }
    return matched;
  },
});

export const brokerBrandingForEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return null;

    // 1. Check for a pending client invitation with this email, pick most recent.
    const invites = await ctx.db
      .query("clientInvitations")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const match = invites
      .filter((i) => i.primaryContactEmail?.trim().toLowerCase() === normalized)
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    let brokerOrgId = match?.brokerOrgId;

    // 2. Otherwise, if the user already exists and belongs to a client org,
    //    use that client's broker.
    if (!brokerOrgId) {
      const user = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", normalized))
        .first();
      if (user) {
        const membership = await ctx.db
          .query("orgMemberships")
          .withIndex("by_userId", (q) => q.eq("userId", user._id))
          .first();
        if (membership) {
          const org = await ctx.db.get(membership.orgId);
          if (org?.type === "client" && org.brokerOrgId) {
            brokerOrgId = org.brokerOrgId;
          }
        }
      }
    }

    if (!brokerOrgId) return null;
    const broker = await ctx.db.get(brokerOrgId);
    if (!broker || broker.type !== "broker") return null;
    if (!isWhiteLabelingEnabled(broker)) return null;

    const iconUrl = broker.iconStorageId
      ? await ctx.storage.getUrl(broker.iconStorageId)
      : null;

    return {
      name: broker.name,
      brandingColor: broker.brandingColor,
      agentDisplayName: broker.agentDisplayName,
      iconUrl,
    };
  },
});
