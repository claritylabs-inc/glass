"use client";

import { useState, useEffect } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { FadeIn } from "@/components/ui/fade-in";
import { LogoIcon } from "@/components/ui/logo-icon";
import { AuthHeroBackground, PrismHeroLogo } from "@/components/auth-hero-background";
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

export default function SignupPage() {
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Pre-fill email from query param (when redirected from login)
  useEffect(() => {
    const prefill = searchParams.get("email");
    if (prefill && !email) {
      setEmail(prefill);
    }
  }, [searchParams, email]);

  useEffect(() => {
    if (isAuthenticated) router.replace("/");
  }, [isAuthenticated, router]);

  if (isAuthenticated) return null;

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await signIn("resend-otp", { email });
      setStep("code");
    } catch (err: any) {
      setError(friendlyError(err.message || ""));
    } finally {
      setLoading(false);
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await signIn("resend-otp", { email, code });
    } catch (err: any) {
      setError(friendlyError(err.message || ""));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 overflow-hidden">
      <AuthHeroBackground />

      <FadeIn className="relative z-10 w-full max-w-sm">
        <PrismHeroLogo />

        <div className="rounded-xl border border-foreground/8 bg-[#faf8f4] p-6 sm:p-8">
          <p className="text-body-sm text-foreground/50 text-center mb-5">
            Get started with AI-powered policy extraction
          </p>

          {step === "email" ? (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div>
                <label className="text-label-sm font-medium text-foreground/50 uppercase tracking-wider block mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  autoFocus
                  className="w-full rounded-lg border border-foreground/10 bg-white/80 px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                />
              </div>

              {error && (
                <p className="text-body-sm text-muted-foreground bg-white/50 border border-foreground/6 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <div className="pt-1">
                <PillButton
                  type="submit"
                  disabled={loading || !email}
                  className="w-full"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Sending code...
                    </>
                  ) : (
                    <>
                      Create account
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </PillButton>
              </div>

              <p className="text-center text-label-sm text-foreground/40">
                Already have an account?{" "}
                <Link href="/login" className="text-foreground/70 font-medium hover:underline">
                  Sign in
                </Link>
              </p>
            </form>
          ) : (
            <form onSubmit={handleCodeSubmit} className="space-y-4">
              <div>
                <label className="text-label-sm font-medium text-foreground/50 uppercase tracking-wider block mb-2">
                  Verification Code
                </label>
                <div
                  className="relative flex gap-2 cursor-text"
                  onClick={() => {
                    const el = document.getElementById("otp-input") as HTMLInputElement | null;
                    el?.focus();
                  }}
                >
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className={`flex-1 aspect-square max-h-14 rounded-lg border bg-white/60 flex items-center justify-center text-xl font-semibold font-mono transition-colors ${
                        code.length === i
                          ? "border-foreground/30 ring-1 ring-foreground/10"
                          : "border-foreground/10"
                      }`}
                    >
                      {code[i] ?? ""}
                    </div>
                  ))}
                  <input
                    id="otp-input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    required
                    autoFocus
                    autoComplete="one-time-code"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-text"
                    aria-label="Verification code"
                  />
                </div>
                <p className="text-label-sm text-foreground/40 mt-2">
                  We sent a 6-digit code to{" "}
                  <span className="text-foreground/70 font-medium">{email}</span>
                </p>
              </div>

              {error && (
                <p className="text-body-sm text-muted-foreground bg-white/50 border border-foreground/6 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <div className="flex flex-col gap-2.5 pt-1">
                <PillButton
                  type="submit"
                  disabled={loading || code.length < 6}
                  className="w-full"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    <>
                      Verify & create account
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

        <p className="text-center mt-5">
          <a href="https://claritylabs.inc" target="_blank" rel="noopener noreferrer" className="inline-flex flex-col items-center gap-0.5 hover:opacity-80 transition-opacity">
            <span className="text-[11px] text-white/40">from</span>
            <span className="inline-flex items-center gap-1 serif text-[18px] text-white/70">clarity <LogoIcon size={16} color="#ffffff" static className="shrink-0" /> labs</span>
          </a>
        </p>
      </FadeIn>
    </div>
  );
}
