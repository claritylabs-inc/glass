import { convexAuth } from "@convex-dev/auth/server";
import { Email } from "@convex-dev/auth/providers/Email";
import { buildOtpEmail } from "./lib/emailTemplate";

const ResendOTP = Email({
  id: "resend-otp",
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  },
  async sendVerificationRequest({ identifier: email, token }: any) {
    const siteUrl = process.env.SITE_URL ?? "https://prism.claritylabs.inc";
    const { html, text } = buildOtpEmail(token, siteUrl);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.AUTH_EMAIL_FROM ?? "Clarity Labs <onboarding@resend.dev>",
        to: email,
        subject: "Your Prism sign-in code",
        html,
        text,
      }),
    });
    if (!res.ok) {
      throw new Error("Failed to send verification email: " + (await res.text()));
    }
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [ResendOTP],
});
