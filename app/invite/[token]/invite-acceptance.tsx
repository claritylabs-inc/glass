"use client";

import { useAction, useMutation, useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { AuthCard, AuthMinimalShell, BrandWordmark } from "@/components/auth-shell";
import { PillButton } from "@/components/ui/pill-button";
import { ArrowRight, Loader2 } from "lucide-react";

type InviteData = {
  invitationId: string;
  linkType: "email" | "shareable";
  brokerName: string;
  brokerSlug?: string;
  brandingColor?: string;
  agentDisplayName?: string;
  clientOrgName?: string;
  primaryContactEmail?: string;
  primaryContactName?: string;
  prefillPassport?: unknown;
};

const INPUT_CLASSES =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

const LABEL_CLASSES =
  "text-label-sm font-medium text-muted-foreground block mb-1.5";

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

export default function InviteAcceptance({ token }: { token: string }) {
  const router = useRouter();
  const getByToken = useAction(api.clientInvitations.getByToken);
  const acceptInvitation = useMutation(api.clientInvitations.accept);
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();

  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);

  const [step, setStep] = useState<"details" | "code">("details");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    getByToken({ token })
      .then((data) => {
        setInviteData(data as InviteData);
        if (data.clientOrgName) setCompanyName(data.clientOrgName);
        if (data.primaryContactEmail) setEmail(data.primaryContactEmail);
      })
      .catch((err: Error) => setFetchError(err.message))
      .finally(() => setFetching(false));
  }, [token, getByToken]);

  // Once OTP verifies, auth becomes true — accept the invitation then redirect.
  useEffect(() => {
    if (!isAuthenticated || accepting) return;
    setAccepting(true);
    acceptInvitation({ token, clientOrgName: companyName.trim() })
      .then(({ clientOrgId }) => {
        router.replace(`/?org=${clientOrgId}`);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not accept invitation");
        setAccepting(false);
      });
  }, [isAuthenticated, accepting, acceptInvitation, token, companyName, router]);

  async function handleDetailsSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim() || !email.trim()) return;
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
      // isAuthenticated effect above will accept + redirect
    } catch (err: unknown) {
      setError(friendlyError(err instanceof Error ? err.message : ""));
      setLoading(false);
    }
  }

  if (fetching) {
    return (
      <AuthMinimalShell>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </AuthMinimalShell>
    );
  }

  if (fetchError && !inviteData) {
    return (
      <AuthMinimalShell>
        <AuthCard
          title="Invitation unavailable"
          subtitle={fetchError}
          logo={<BrandWordmark />}
        >
          <p className="text-sm text-muted-foreground">
            If you believe this is an error, ask your broker to resend the invitation.
          </p>
        </AuthCard>
      </AuthMinimalShell>
    );
  }

  const brokerName = inviteData?.brokerName ?? "Your broker";
  const title =
    step === "details"
      ? `${brokerName} invited you to Glass`
      : "Verify your email";
  const subtitle =
    step === "details"
      ? `Join ${brokerName}'s workspace.`
      : undefined;

  return (
    <AuthMinimalShell>
      <AuthCard title={title} subtitle={subtitle} logo={<BrandWordmark />}>
        {step === "details" ? (
          <form onSubmit={handleDetailsSubmit} className="space-y-4">
            <div>
              <label htmlFor="inv-company" className={LABEL_CLASSES}>
                Your company name
              </label>
              <input
                id="inv-company"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme Corp"
                required
                autoFocus={!companyName}
                className={INPUT_CLASSES}
              />
            </div>

            <div>
              <label htmlFor="inv-email" className={LABEL_CLASSES}>
                Email
              </label>
              <input
                id="inv-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoFocus={!!companyName && !email}
                className={INPUT_CLASSES}
              />
            </div>

            {error && (
              <p className="px-1 py-1 text-sm text-muted-foreground">{error}</p>
            )}

            <PillButton
              type="submit"
              disabled={loading || !companyName.trim() || !email.trim()}
              className="w-full justify-center text-sm shadow-none sm:w-auto"
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
                  const el = document.getElementById(
                    "inv-otp-input",
                  ) as HTMLInputElement | null;
                  el?.focus();
                }}
              >
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className={`flex-1 aspect-square max-h-14 rounded-lg border bg-popover flex items-center justify-center text-xl font-medium font-mono transition-colors ${
                      code.length === i
                        ? "border-foreground/30 ring-1 ring-foreground/10"
                        : "border-foreground/8"
                    }`}
                  >
                    {code[i] ?? ""}
                  </div>
                ))}
                <input
                  id="inv-otp-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
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

            {error && (
              <p className="px-1 py-1 text-sm text-muted-foreground">{error}</p>
            )}

            <div className="flex flex-col items-start gap-5 pt-6">
              <PillButton
                type="submit"
                disabled={loading || accepting || code.length < 6}
                className="w-full justify-center text-sm shadow-none sm:w-auto"
              >
                {loading || accepting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {accepting
                  ? "Setting up your account..."
                  : loading
                    ? "Verifying..."
                    : "Verify and continue"}
                {!loading && !accepting ? (
                  <ArrowRight className="h-4 w-4" />
                ) : null}
              </PillButton>
              <button
                type="button"
                onClick={() => {
                  setStep("details");
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
  );
}
