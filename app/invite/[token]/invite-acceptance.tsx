"use client";

import { useAction, useMutation, useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  AuthCard,
  AuthMinimalShell,
  BrandWordmark,
  PartnerWordmark,
  PoweredByGlassWordmark,
} from "@/components/auth-shell";
import { OtpField } from "@/components/ui/otp-field";
import { PillButton } from "@/components/ui/pill-button";
import { completeOtpSignIn } from "@/lib/otp-auth";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { ArrowRight, Loader2 } from "lucide-react";

type InviteData = {
  invitationId: string;
  brokerName: string;
  whiteLabelingEnabled?: boolean;
  brokerIconUrl?: string | null;
  brokerWebsite?: string;
  brokerSlug?: string;
  brandingColor?: string;
  agentDisplayName?: string;
  clientOrgName?: string;
  primaryContactEmail?: string;
  primaryContactName?: string;
  prefillPassport?: unknown;
};

const INPUT_CLASSES =
  "h-9 w-full rounded-lg border border-foreground/8 bg-popover px-3 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

const LABEL_CLASSES =
  "text-label font-medium text-muted-foreground block mb-1.5";

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

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function InviteAcceptance({ token }: { token: string }) {
  const router = useRouter();
  const getByToken = useAction(api.clientInvitations.getByToken);
  const getInviteOtpCode = useAction(api.clientInvitations.getInviteOtpCode);
  const acceptInvitation = useMutation(api.clientInvitations.acceptInvite);
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();

  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);

  const [step, setStep] = useState<"details" | "code">("details");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoVerifying, setAutoVerifying] = useState(false);
  const acceptingRef = useRef(false);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    getByToken({ token })
      .then((data) => {
        setInviteData(data as InviteData);
        if (data.primaryContactEmail) setEmail(data.primaryContactEmail);
      })
      .catch((err: unknown) =>
        setFetchError(
          getUserFacingErrorMessage(err, "Could not load this invitation."),
        ),
      )
      .finally(() => setFetching(false));
  }, [token, getByToken]);

  // Auto-verify: the invite link itself proves email ownership, so we trigger
  // the OTP send, read the stashed code back, and sign in — no code entry.
  useEffect(() => {
    if (!inviteData?.primaryContactEmail) return;
    if (isAuthenticated) return;
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    const targetEmail = inviteData.primaryContactEmail;
    void (async () => {
      setAutoVerifying(true);
      try {
        await signIn("resend-otp", { email: targetEmail });
        // Poll briefly for the stashed code to appear (sendVerificationRequest
        // writes it via an internal mutation).
        let stashed: { email: string; code: string } | null = null;
        for (let i = 0; i < 10; i++) {
          stashed = await getInviteOtpCode({ token });
          if (stashed) break;
          await new Promise((r) => setTimeout(r, 400));
        }
        if (!stashed) throw new Error("Could not auto-verify — please try again.");
        await completeOtpSignIn(stashed.email, stashed.code);
        window.location.reload();
      } catch (err) {
        setError(
          getUserFacingErrorMessage(
            err,
            "Could not auto-verify. Please try again.",
          ),
        );
        autoStartedRef.current = false;
      } finally {
        setAutoVerifying(false);
      }
    })();
  }, [inviteData, isAuthenticated, signIn, getInviteOtpCode, token]);

  // Once OTP verifies, auth becomes true — accept the invitation then redirect
  // to onboarding, which collects the organization name and other details.
  useEffect(() => {
    if (!isAuthenticated || acceptingRef.current) return;
    acceptingRef.current = true;
    acceptInvitation({ token })
      .then(() => {
        router.replace("/onboarding");
      })
      .catch((err: unknown) => {
        setError(getUserFacingErrorMessage(err, "Could not accept invitation"));
        acceptingRef.current = false;
      });
  }, [isAuthenticated, acceptInvitation, token, router]);

  async function handleDetailsSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    if (isEmailLike(email) === false) {
      setError("Enter a valid email address.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await signIn("resend-otp", { email });
      setStep("code");
    } catch (err: unknown) {
      setError(friendlyError(getUserFacingErrorMessage(err, "")));
    } finally {
      setLoading(false);
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await completeOtpSignIn(email, code);
      window.location.reload();
    } catch (err: unknown) {
      setError(friendlyError(getUserFacingErrorMessage(err, "")));
      setLoading(false);
    }
  }

  if (fetching) {
    return (
      <AuthMinimalShell footer={<PoweredByGlassWordmark />}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </AuthMinimalShell>
    );
  }

  if (fetchError && !inviteData) {
    return (
      <AuthMinimalShell footer={<PoweredByGlassWordmark />}>
        <AuthCard
          title="Invitation unavailable"
          subtitle={fetchError}
          logo={<BrandWordmark />}
        >
          <p className="text-base text-muted-foreground">
            If you believe this is an error, ask your broker to resend the invitation.
          </p>
        </AuthCard>
      </AuthMinimalShell>
    );
  }

  const brokerName = inviteData?.brokerName ?? "Your broker";
  const whiteLabelingEnabled = inviteData?.whiteLabelingEnabled !== false;
  const isAutoFlow = !!inviteData?.primaryContactEmail;
  const title = isAutoFlow
    ? `${brokerName} invited you to Glass`
    : step === "details"
      ? `${brokerName} invited you to Glass`
      : "Verify your email";
  const subtitle =
    isAutoFlow || step === "details"
      ? `Join ${brokerName} to manage your policies, share documents, and get instant answers about your coverage.`
      : undefined;

  return (
    <AuthMinimalShell footer={<PoweredByGlassWordmark />}>
      <AuthCard
        title={title}
        subtitle={subtitle}
        logo={
          whiteLabelingEnabled ? (
            <PartnerWordmark
              name={inviteData?.brokerName}
              iconUrl={inviteData?.brokerIconUrl}
              website={inviteData?.brokerWebsite}
            />
          ) : (
            <BrandWordmark />
          )
        }
      >
        {isAutoFlow ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-base text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>
                {autoVerifying ? "Signing you in…" : "Opening your workspace…"}
              </span>
            </div>
            {error && (
              <p className="px-1 py-1 text-base text-muted-foreground">{error}</p>
            )}
          </div>
        ) : step === "details" ? (
          <form onSubmit={handleDetailsSubmit} className="space-y-4">
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
                autoFocus
                className={INPUT_CLASSES}
              />
            </div>

            {error && (
              <p className="px-1 py-1 text-base text-muted-foreground">{error}</p>
            )}

            <PillButton
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full justify-center text-base shadow-none sm:w-auto"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? "Sending code..." : "Continue"}
              {!loading ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
          </form>
        ) : (
          <form onSubmit={handleCodeSubmit} className="space-y-4">
            <div>
              <label className="text-label font-medium text-muted-foreground block mb-2">
                Verification Code
              </label>
              <OtpField value={code} onValueChange={setCode} autoFocus required />
              <p className="mt-2 text-base text-muted-foreground">
                We sent a 6-digit code to{" "}
                <span className="font-medium text-foreground">{email}</span>
              </p>
            </div>

            {error && (
              <p className="px-1 py-1 text-base text-muted-foreground">{error}</p>
            )}

            <div className="flex flex-col items-start gap-5 pt-6">
              <PillButton
                type="submit"
                disabled={loading || code.length < 6}
                className="w-full justify-center text-base shadow-none sm:w-auto"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {loading ? "Verifying..." : "Verify and continue"}
                {!loading ? (
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
                className="self-center text-base text-muted-foreground transition-colors hover:text-foreground sm:self-start"
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
