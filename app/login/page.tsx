"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { FadeIn } from "@/components/ui/fade-in";
import { LogoIcon } from "@/components/ui/logo-icon";
import { PillButton } from "@/components/ui/pill-button";
import { Loader2, ArrowLeft, ArrowRight } from "lucide-react";

function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("could not verify code") || lower.includes("invalid code"))
    return "That code didn't work. Please double-check and try again.";
  if (lower.includes("expired"))
    return "This code has expired. Please request a new one.";
  if (lower.includes("too many") || lower.includes("rate limit"))
    return "Too many attempts. Please wait a moment and try again.";
  if (lower.includes("failed to send") || lower.includes("failed to deliver"))
    return "We couldn't send the verification email. Please try again.";
  return "Something went wrong. Please try again.";
}

export default function LoginPage() {
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const router = useRouter();

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  // Query to check if user exists — only enabled when we've submitted email
  const [emailToCheck, setEmailToCheck] = useState("");
  const emailCheck = useQuery(
    api.users.checkEmail,
    emailToCheck ? { email: emailToCheck } : "skip"
  );
  // Also check for pending invitation (so invited users can log in directly)
  const invitationCheck = useQuery(
    api.orgs.checkPendingInvitation,
    emailToCheck ? { email: emailToCheck } : "skip"
  );

  const sendOtp = useCallback(async (targetEmail: string) => {
    try {
      await signIn("resend-otp", { email: targetEmail });
      setStep("code");
    } catch (err: any) {
      setError(friendlyError(err.message || ""));
    } finally {
      setSendingCode(false);
      setEmailToCheck("");
    }
  }, [signIn]);

  // Handle email check result
  useEffect(() => {
    if (!emailToCheck || emailCheck === undefined || invitationCheck === undefined) return;

    if (!emailCheck.exists && !invitationCheck.hasPendingInvitation) {
      // Unknown email with no invitation — redirect to signup
      setSendingCode(false);
      router.replace(`/signup?email=${encodeURIComponent(emailToCheck)}`);
    } else {
      // Known email OR has pending invitation — proceed with OTP
      sendOtp(emailToCheck);
    }
  }, [emailToCheck, emailCheck, invitationCheck, router, sendOtp]);

  useEffect(() => {
    if (isAuthenticated) router.replace("/");
  }, [isAuthenticated, router]);

  if (isAuthenticated) return null;

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSendingCode(true);
    setError("");
    setEmailToCheck(email);
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setVerifying(true);
    setError("");
    try {
      await signIn("resend-otp", { email, code });
    } catch (err: any) {
      setError(friendlyError(err.message || ""));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <FadeIn className="w-full max-w-sm">
        <div className="p-2 sm:bg-white sm:rounded-xl sm:border sm:border-foreground/8 sm:p-8">
          <div className="text-center mb-6">
            <h3 className="!mb-0 flex items-center justify-center gap-1.5 serif">
              Clarity <LogoIcon size={22} className="shrink-0" /> Labs
            </h3>
          </div>

          {step === "email" ? (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div>
                <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  autoFocus
                  className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                />
              </div>

              {error && (
                <p className="text-body-sm text-muted-foreground bg-foreground/[0.03] border border-foreground/6 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <div className="pt-1">
                <PillButton
                  type="submit"
                  disabled={sendingCode || !email}
                  className="w-full"
                >
                  {sendingCode ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Sending code...
                    </>
                  ) : (
                    <>
                      Send verification code
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </PillButton>
              </div>

              <p className="text-center text-label-sm text-muted-foreground/60">
                Don&apos;t have an account?{" "}
                <Link href="/signup" className="text-foreground font-medium hover:underline">
                  Sign up
                </Link>
              </p>
            </form>
          ) : (
            <form onSubmit={handleCodeSubmit} className="space-y-4">
              <div>
                <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                  Verification Code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors tracking-[0.3em] text-center font-mono"
                />
                <p className="text-label-sm text-muted-foreground/50 mt-1.5">
                  We sent a 6-digit code to{" "}
                  <span className="text-foreground font-medium">{email}</span>
                </p>
              </div>

              {error && (
                <p className="text-body-sm text-muted-foreground bg-foreground/[0.03] border border-foreground/6 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <div className="flex flex-col gap-2.5 pt-1">
                <PillButton
                  type="submit"
                  disabled={verifying || code.length < 6}
                  className="w-full"
                >
                  {verifying ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    <>
                      Verify & sign in
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </PillButton>
                <PillButton
                  variant="secondary"
                  onClick={() => {
                    setStep("email");
                    setCode("");
                    setError("");
                  }}
                  className="w-full"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Use a different email
                </PillButton>
              </div>
            </form>
          )}
        </div>
      </FadeIn>
    </div>
  );
}
