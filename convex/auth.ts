import { convexAuth } from "@convex-dev/auth/server";
import { Email } from "@convex-dev/auth/providers/Email";
import { buildOtpEmail } from "./lib/emailTemplate";
import { getBrandingContext } from "./lib/branding";
import { sendResendEmail, getAuthFromAddress, logLocalEmailCapture } from "./lib/resend";
import { getAuthSiteUrl } from "./lib/domains";
import { internal } from "./_generated/api";


const sendVerificationRequest = async function (this: unknown, ...args: any[]) {
  const [{ identifier: email, token }, ctx] = args as [
    { identifier: string; token: string },

    any,
  ];
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
    if (hasPendingInvite) {
      logLocalEmailCapture({
        kind: "suppressed-invite-otp",
        to: email,
        subject: "Suppressed invite OTP",
        text: `Suppressed invite OTP for ${email}: ${token}`,
        codeCandidates: [token],
      });
      return;
    }

    const branding = getBrandingContext();

    const { html, text } = buildOtpEmail(token, getAuthSiteUrl(), branding);
    const subject = "Your Spot sign-in code";
    const result = await sendResendEmail({
      from: getAuthFromAddress(),
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
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const stashInviteOtp = internalMutation({
  args: { email: v.string(), code: v.string() },
  handler: async (ctx, { email, code }) => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return false;
    const pendingInvites = await ctx.db
      .query("clientInvitations")
      .withIndex("status", (q) => q.eq("status", "pending"))
      .collect();
    const pendingVendorInvites = await ctx.db
      .query("connectedOrgInvitations")
      .withIndex("email", (q) => q.eq("vendorEmail", normalized))
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
