// app/invite/[token]/invite-acceptance.tsx
"use client";

import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { PillButton } from "@/components/ui/pill-button";

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
  "text-label-sm font-medium text-muted-foreground block mb-1";

export default function InviteAcceptance({ token }: { token: string }) {
  const router = useRouter();
  const getByToken = useAction(api.clientInvitations.getByToken);
  const acceptInvitation = useMutation(api.clientInvitations.accept);
  const { signIn } = useAuthActions();

  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getByToken({ token })
      .then((data) => {
        setInviteData(data as InviteData);
        if (data.clientOrgName) setCompanyName(data.clientOrgName);
        if (data.primaryContactEmail) setEmail(data.primaryContactEmail);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, getByToken]);

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim()) return;
    setSubmitting(true);
    try {
      await signIn("password", { email, password, flow: "signUp" }).catch(
        async () => {
          await signIn("password", { email, password, flow: "signIn" });
        },
      );

      const { clientOrgId } = await acceptInvitation({
        token,
        clientOrgName: companyName.trim(),
      });
      router.push(`/?org=${clientOrgId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-muted-foreground/60">Loading…</p>
      </div>
    );
  }

  if (error && !inviteData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="max-w-md w-full px-6 py-16 text-center">
          <h1 className="text-xl font-semibold text-foreground mb-2">
            Invitation unavailable
          </h1>
          <p className="text-sm text-muted-foreground/60">{error}</p>
          <p className="text-xs text-muted-foreground/60 mt-4">
            If you believe this is an error, ask your broker to resend the invitation.
          </p>
        </div>
      </div>
    );
  }

  const accentColor = inviteData?.brandingColor ?? "var(--foreground)";
  const agentName =
    inviteData?.agentDisplayName ?? inviteData?.brokerName ?? "Your Broker";
  const formValid = companyName.trim() && email.trim() && password.trim();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md w-full px-6 py-8 bg-card rounded-2xl border border-foreground/6 shadow-sm">
        {/* Broker branding header */}
        <div className="mb-6 text-center">
          <div
            className="inline-block w-12 h-12 rounded-full mb-3"
            style={{ backgroundColor: accentColor }}
          />
          <h1 className="text-lg font-semibold text-foreground">
            {agentName} has invited you to Glass
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {inviteData?.linkType === "email"
              ? `You've been invited by ${inviteData.brokerName}`
              : `Join via ${inviteData?.brokerName}'s link`}
          </p>
        </div>

        <form onSubmit={handleAccept} className="space-y-4">
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
              placeholder="you@example.com"
              className={INPUT_CLASSES}
            />
          </div>

          <div>
            <label htmlFor="inv-password" className={LABEL_CLASSES}>
              Password
            </label>
            <input
              id="inv-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Choose a password (or enter existing)"
              className={INPUT_CLASSES}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <PillButton
            type="submit"
            variant="primary"
            disabled={!formValid || submitting}
            className="w-full"
          >
            {submitting ? "Setting up your account…" : "Accept invitation"}
          </PillButton>
        </form>
      </div>
    </div>
  );
}
