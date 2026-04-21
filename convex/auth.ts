import { convexAuth } from "@convex-dev/auth/server";
import { Email } from "@convex-dev/auth/providers/Email";
import { buildOtpEmail } from "./lib/emailTemplate";
import { sendResendEmail, getAuthFromAddress } from "./lib/resend";

const ResendOTP = Email({
  id: "resend-otp",
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  },
  async sendVerificationRequest({ identifier: email, token }: { identifier: string; token: string }) {
    const siteUrl = process.env.SITE_URL ?? "https://glass.claritylabs.inc";
    const { html, text } = buildOtpEmail(token, siteUrl);
    const result = await sendResendEmail({
      from: getAuthFromAddress(),
      to: email,
      subject: "Your Glass sign-in code",
      html,
      text,
    });
    if (!result.ok) {
      throw new Error("Failed to send verification email: " + result.error);
    }
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [ResendOTP],
});
