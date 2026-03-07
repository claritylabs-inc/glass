import { convexAuth } from "@convex-dev/auth/server";
import { Email } from "@convex-dev/auth/providers/Email";

const ResendOTP = Email({
  id: "resend-otp",
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  },
  async sendVerificationRequest({ identifier: email, token }: any) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.AUTH_EMAIL_FROM ?? "onboarding@resend.dev",
        to: email,
        subject: "Your Clarity Labs sign-in code",
        html: `<p>Your verification code is: <strong>${token}</strong></p><p>This code expires in 15 minutes.</p>`,
        text: `Your verification code is: ${token}\n\nThis code expires in 15 minutes.`,
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
