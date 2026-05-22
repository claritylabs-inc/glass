"use client";

import { useEffect, useRef, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { AuthCard, AuthMinimalShell, BrandWordmark } from "@/components/auth-shell";
import { PillButton } from "@/components/ui/pill-button";
import { ArrowRight, Loader2 } from "lucide-react";

function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("not authorized")) return "This email is not authorized for operator access.";
  if (lower.includes("customer accounts")) return "This email is already associated with a customer account.";
  if (lower.includes("could not verify code") || lower.includes("invalid code")) return "That code didn't work.";
  if (lower.includes("expired")) return "This code has expired.";
  return "Could not sign in to the operator console.";
}

export default function OperatorLoginPage() {
  const router = useRouter();
  const { signIn, signOut } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bootstrap = useMutation((api as any).operator.bootstrapViewer);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bootstrappingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || bootstrappingRef.current) return;
    bootstrappingRef.current = true;
    bootstrap({})
      .then(() => router.replace("/operator"))
      .catch(async (err: unknown) => {
        setError(friendlyError(err instanceof Error ? err.message : ""));
        await signOut();
        setStep("email");
      })
      .finally(() => {
        bootstrappingRef.current = false;
      });
  }, [bootstrap, isAuthenticated, router, signOut]);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await signIn("resend-otp", { email });
      setStep("code");
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : ""));
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await signIn("resend-otp", { email, code });
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : ""));
      setLoading(false);
    }
  }

  return (
    <AuthMinimalShell>
      <AuthCard
        title="Operator login"
        subtitle="For Clarity Labs team members."
        logo={<BrandWordmark />}
      >
        {step === "email" ? (
          <form onSubmit={sendCode} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-label-sm font-medium text-muted-foreground">
                Operator email
              </label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@claritylabs.inc"
                required
                autoFocus
                className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:border-foreground/20 focus:outline-none focus:ring-1 focus:ring-foreground/8"
              />
            </div>
            {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
            <PillButton type="submit" disabled={loading || !email} className="justify-center text-sm">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? "Sending code..." : "Continue"}
              {!loading ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
            <p className="text-label-sm text-muted-foreground">
              Looking for Glass?{" "}
              <Link href="/login" className="font-medium text-foreground hover:opacity-70">
                Go to the main login
              </Link>
            </p>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="space-y-4">
            <div>
              <label className="mb-2 block text-label-sm font-medium text-muted-foreground">
                Verification Code
              </label>
              <div
                className="relative flex cursor-text gap-2"
                onClick={() => {
                  const input = document.getElementById("operator-otp-input") as HTMLInputElement | null;
                  input?.focus();
                }}
              >
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className={`flex aspect-square max-h-14 flex-1 items-center justify-center rounded-lg border bg-popover font-mono text-xl font-medium transition-colors ${
                      code.length === index
                        ? "border-foreground/30 ring-1 ring-foreground/10"
                        : "border-foreground/8"
                    }`}
                  >
                    {code[index] ?? ""}
                  </div>
                ))}
                <input
                  id="operator-otp-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  className="absolute inset-0 h-full w-full cursor-text opacity-0"
                  aria-label="Verification code"
                />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>
              </p>
            </div>
            {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
            <PillButton type="submit" disabled={loading || code.length < 6} className="justify-center text-sm">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? "Verifying..." : "Verify and continue"}
              {!loading ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
            <p className="text-label-sm text-muted-foreground">
              Not an operator?{" "}
              <Link href="/login" className="font-medium text-foreground hover:opacity-70">
                Go to the main login
              </Link>
            </p>
          </form>
        )}
      </AuthCard>
    </AuthMinimalShell>
  );
}
