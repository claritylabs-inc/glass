"use client";

import { useEffect, useRef, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AuthCard,
  AuthMinimalShell,
  BrandWordmark,
  PartnerWordmark,
  PoweredByGlassWordmark,
} from "@/components/auth-shell";
import { PillButton } from "@/components/ui/pill-button";
import { ArrowRight, Loader2 } from "lucide-react";

type BrokerProfile = {
  name: string;
  slug?: string;
  website?: string;
  whiteLabelingEnabled?: boolean;
  brandingColor?: string;
  agentDisplayName?: string;
  iconUrl?: string | null;
};

function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("could not verify code") || lower.includes("invalid code")) {
    return "That code didn't work. Please double-check and try again.";
  }
  if (lower.includes("expired")) return "This code has expired. Please request a new one.";
  if (lower.includes("too many") || lower.includes("rate limit")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (lower.includes("failed to send") || lower.includes("failed to deliver")) {
    return "We couldn't send the verification email. Please try again.";
  }
  return "Something went wrong. Please try again.";
}

export function BrokerAuthEntryPage({
  broker,
  mode,
}: {
  broker: BrokerProfile;
  mode: "login" | "signup";
}) {
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const joinBroker = useMutation(api.clientInvitations.joinBroker);
  const router = useRouter();
  const searchParams = useSearchParams();

  const isSignup = mode === "signup";
  const nextPath = searchParams.get("next");
  const defaultPostPath = isSignup ? "/onboarding" : "/";
  const postLoginPath =
    nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")
      ? nextPath
      : defaultPostPath;
  const joiningRef = useRef(false);

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(() => searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAuthenticated) return;
    if (isSignup && broker.slug) {
      if (joiningRef.current) return;
      joiningRef.current = true;
      joinBroker({ slug: broker.slug })
        .catch(() => {})
        .finally(() => router.replace(postLoginPath));
      return;
    }
    router.replace(postLoginPath);
  }, [isAuthenticated, postLoginPath, router, isSignup, broker.slug, joinBroker]);

  if (isAuthenticated) return null;

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await signIn("resend-otp", { email });
      setStep("code");
    } catch (err: unknown) {
      setError(friendlyError(err instanceof Error ? err.message : ""));
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
    } catch (err: unknown) {
      setError(friendlyError(err instanceof Error ? err.message : ""));
    } finally {
      setLoading(false);
    }
  }

  const whiteLabelingEnabled = broker.whiteLabelingEnabled !== false;
  const displayName = whiteLabelingEnabled ? broker.name : "Glass";
  const title = isSignup ? `Join ${displayName}` : `Sign in to ${displayName}`;
  const subtitle = isSignup
    ? `Join ${displayName} to manage your policies, share documents, and get instant answers about your coverage.`
    : "Use your work email to continue.";

  const accentStyle = whiteLabelingEnabled && broker.brandingColor
    ? ({ "--brand-accent": broker.brandingColor } as React.CSSProperties)
    : undefined;

  return (
    <div style={accentStyle}>
      <AuthMinimalShell footer={<PoweredByGlassWordmark />}>
        <AuthCard
          title={title}
          subtitle={subtitle}
          logo={
            whiteLabelingEnabled ? (
              <PartnerWordmark
                name={broker.name}
                iconUrl={broker.iconUrl ?? undefined}
                website={broker.website}
              />
            ) : (
              <BrandWordmark />
            )
          }
        >
          {step === "email" ? (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div>
                <label className="text-label-sm font-medium text-muted-foreground block mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  autoFocus
                  className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                />
              </div>
              {error && <p className="px-1 py-1 text-sm text-muted-foreground">{error}</p>}
              <PillButton
                type="submit"
                disabled={loading || !email}
                className="w-full justify-center text-sm shadow-none sm:w-auto"
                style={
                  whiteLabelingEnabled && broker.brandingColor
                    ? { backgroundColor: broker.brandingColor, borderColor: broker.brandingColor }
                    : undefined
                }
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loading ? "Sending code..." : "Continue"}
                {!loading ? <ArrowRight className="h-4 w-4" /> : null}
              </PillButton>
            </form>
          ) : (
            <form onSubmit={handleCodeSubmit} className="space-y-4">
              <div>
                <label className="text-label-sm font-medium text-muted-foreground block mb-2">
                  Verification Code
                </label>
                <div
                  className="relative flex gap-2 cursor-text"
                  onClick={() => {
                    const el = document.getElementById("auth-otp-input") as HTMLInputElement | null;
                    el?.focus();
                  }}
                >
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className={`flex-1 aspect-square max-h-14 rounded-lg border border-foreground/8 bg-popover flex items-center justify-center text-xl font-medium font-mono transition-colors ${
                        code.length === i
                          ? "border-foreground/30 ring-1 ring-foreground/10"
                          : "border-foreground/8"
                      }`}
                    >
                      {code[i] ?? ""}
                    </div>
                  ))}
                  <input
                    id="auth-otp-input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    required
                    autoFocus
                    autoComplete="one-time-code"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-text"
                    aria-label="Verification code"
                  />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  We sent a 6-digit code to{" "}
                  <span className="font-medium text-foreground">{email}</span>
                </p>
              </div>
              {error && <p className="px-1 py-1 text-sm text-muted-foreground">{error}</p>}
              <div className="flex flex-col items-start gap-5 pt-6">
                <PillButton
                  type="submit"
                  disabled={loading || code.length < 6}
                  className="w-full justify-center text-sm shadow-none sm:w-auto"
                  style={
                    whiteLabelingEnabled && broker.brandingColor
                      ? { backgroundColor: broker.brandingColor, borderColor: broker.brandingColor }
                      : undefined
                  }
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {loading ? "Verifying..." : "Verify and continue"}
                  {!loading ? <ArrowRight className="h-4 w-4" /> : null}
                </PillButton>
                <button
                  type="button"
                  onClick={() => {
                    setStep("email");
                    setCode("");
                    setError("");
                  }}
                  className="self-center text-sm text-muted-foreground transition-colors hover:text-foreground sm:self-start"
                >
                  Use a different email
                </button>
              </div>
            </form>
          )}
        </AuthCard>
      </AuthMinimalShell>
    </div>
  );
}
