// app/invite/[token]/invite-acceptance.tsx
"use client";

import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";

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
      // Sign up or sign in
      await signIn("password", { email, password, flow: "signUp" }).catch(async () => {
        // If signUp fails (user exists), try signIn
        await signIn("password", { email, password, flow: "signIn" });
      });

      const { clientOrgId } = await acceptInvitation({ token, clientOrgName: companyName.trim() });
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
        <div className="text-sm text-gray-500">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="max-w-md w-full px-6 py-8 text-center">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Invitation unavailable</h1>
          <p className="text-gray-600 text-sm">{error}</p>
          <p className="text-gray-400 text-xs mt-4">
            If you believe this is an error, ask your broker to resend the invitation.
          </p>
        </div>
      </div>
    );
  }

  const accentColor = inviteData?.brandingColor ?? "#4F46E5";
  const agentName = inviteData?.agentDisplayName ?? inviteData?.brokerName ?? "Your Broker";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full px-6 py-8 bg-white rounded-2xl shadow-sm border border-gray-100">
        {/* Broker branding header */}
        <div className="mb-6 text-center">
          <div
            className="inline-block w-12 h-12 rounded-full mb-3"
            style={{ backgroundColor: accentColor }}
          />
          <h1 className="text-lg font-semibold text-gray-900">
            {agentName} has invited you to Glass
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {inviteData?.linkType === "email"
              ? `You've been invited by ${inviteData.brokerName}`
              : `Join via ${inviteData?.brokerName}'s link`}
          </p>
        </div>

        <form onSubmit={handleAccept} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Your company name
            </label>
            <input
              type="text"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Corp"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Choose a password (or enter existing)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{ backgroundColor: accentColor }}
            className="w-full py-2.5 text-white text-sm font-medium rounded-lg disabled:opacity-50"
          >
            {submitting ? "Setting up your account…" : "Accept Invitation"}
          </button>
        </form>
      </div>
    </div>
  );
}
