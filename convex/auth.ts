import { convexAuth } from "@convex-dev/auth/server";
import { Email } from "@convex-dev/auth/providers/Email";
import { buildOtpEmail } from "./lib/emailTemplate";
import { getBrandingContext } from "./lib/branding";
import { sendResendEmail, getAuthFromAddress } from "./lib/resend";
import { internal } from "./_generated/api";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sendVerificationRequest = async function (this: unknown, ...args: any[]) {
  const [{ identifier: email, token }, ctx] = args as [
    { identifier: string; token: string },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendVerificationRequest: sendVerificationRequest as any,
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [ResendOTP],
});

// ── Internal query: find a broker to brand the sign-in email for ─────────────
import { internalQuery, mutation } from "./_generated/server";
import { v } from "convex/values";

/** Public mutation: record a broker-branding hint for an upcoming sign-in.
 * Called from the /login/[slug] page right before signIn. */
export const setBrandingHint = mutation({
  args: { email: v.string(), brokerSlug: v.string() },
  handler: async (ctx, { email, brokerSlug }) => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;
    const broker = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", brokerSlug))
      .first();
    if (!broker || broker.type !== "broker") return;

    // Overwrite any existing hint for this email.
    const existing = await ctx.db
      .query("brandingHints")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .collect();
    for (const h of existing) await ctx.db.delete(h._id);
    await ctx.db.insert("brandingHints", {
      email: normalized,
      brokerOrgId: broker._id,
      createdAt: Date.now(),
    });
  },
});

const BRANDING_HINT_TTL_MS = 15 * 60 * 1000;

export const brokerBrandingForEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return null;

    // 0. Check short-lived branding hint (from whitelabeled login page).
    const hint = await ctx.db
      .query("brandingHints")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .order("desc")
      .first();
    const fresh = hint && Date.now() - hint.createdAt < BRANDING_HINT_TTL_MS;

    // 1. Check for a pending client invitation with this email, pick most recent.
    const invites = await ctx.db
      .query("clientInvitations")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const match = invites
      .filter((i) => i.primaryContactEmail?.trim().toLowerCase() === normalized)
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    let brokerOrgId = fresh ? hint!.brokerOrgId : match?.brokerOrgId;

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
