"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useConvexAuth, useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import {
  AuthCard,
  AuthMinimalShell,
  BrandWordmark,
  PoweredByGlassWordmark,
} from "@/components/auth-shell";
import { PillButton } from "@/components/ui/pill-button";
import { ArrowRight, Loader2 } from "lucide-react";

type ConnectedOrgsApi = {
  connectedOrgs: {
    getInvitationByToken: FunctionReference<"action">;
    acceptInvitation: FunctionReference<"mutation">;
  };
};

type RequestData = {
  _id: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  vendorEmail: string;
  relationshipLabel?: string;
  note?: string;
  clientOrg?: { name: string } | null;
  vendorOrg?: { name: string } | null;
};

const connectedOrgsApi = api as unknown as ConnectedOrgsApi;
const INPUT_CLASSES =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";
const LABEL_CLASSES = "text-label-sm font-medium text-muted-foreground block mb-1.5";

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("expired")) return "This request has expired. Ask the client to send a new request.";
  if (lower.includes("admin")) return "You need to be an admin of the vendor org to approve this request.";
  if (lower.includes("invalid code")) return "That code didn't work. Please double-check and try again.";
  return raw || "Something went wrong. Please try again.";
}

export default function VendorRequestAcceptance({ token }: { token: string }) {
  const router = useRouter();
  const getInvitationByToken = useAction(connectedOrgsApi.connectedOrgs.getInvitationByToken);
  const acceptInvitation = useMutation(connectedOrgsApi.connectedOrgs.acceptInvitation);
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();

  const [requestData, setRequestData] = useState<RequestData | null>(null);
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [step, setStep] = useState<"details" | "code">("details");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const acceptingRef = useRef(false);

  useEffect(() => {
    getInvitationByToken({ token })
      .then((data) => {
        const typed = data as RequestData | null;
        if (!typed) throw new Error("Request not found");
        setRequestData(typed);
        setEmail(typed.vendorEmail ?? "");
      })
      .catch((err: Error) => setFetchError(err.message))
      .finally(() => setFetching(false));
  }, [getInvitationByToken, token]);

  useEffect(() => {
    if (!isAuthenticated || acceptingRef.current) return;
    acceptingRef.current = true;
    acceptInvitation({ token })
      .then(() => router.replace("/settings?section=connected-orgs"))
      .catch((err: unknown) => {
        setError(friendlyError(err instanceof Error ? err.message : "Could not approve request"));
        acceptingRef.current = false;
      });
  }, [isAuthenticated, acceptInvitation, token, router]);

  async function handleDetailsSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    if (!isEmailLike(email)) {
      setError("Enter a valid email address.");
      return;
    }
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

  if (fetchError || !requestData) {
    return (
      <AuthMinimalShell footer={<PoweredByGlassWordmark />}>
        <AuthCard title="Request unavailable" subtitle={fetchError ?? "Request not found"} logo={<BrandWordmark />}>
          <p className="text-sm text-muted-foreground">Ask the client to resend the vendor access request.</p>
        </AuthCard>
      </AuthMinimalShell>
    );
  }

  const clientName = requestData.clientOrg?.name ?? "A client";
  const title = step === "details" ? `${clientName} requested vendor access` : "Verify your email";
  const subtitle =
    step === "details"
      ? "Sign in with your vendor email to review and approve read-only access to your insurance profile and policies."
      : undefined;

  return (
    <AuthMinimalShell footer={<PoweredByGlassWordmark />}>
      <AuthCard title={title} subtitle={subtitle} logo={<BrandWordmark />}>
        {requestData.status !== "pending" ? (
          <p className="text-sm text-muted-foreground">This request is {requestData.status}.</p>
        ) : step === "details" ? (
          <form onSubmit={handleDetailsSubmit} className="space-y-4">
            {requestData.note ? (
              <p className="rounded-lg border border-foreground/6 bg-foreground/[0.03] p-3 text-sm text-muted-foreground">
                {requestData.note}
              </p>
            ) : null}
            <div>
              <label htmlFor="vendor-email" className={LABEL_CLASSES}>Vendor email</label>
              <input
                id="vendor-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className={INPUT_CLASSES}
              />
            </div>
            {error ? <p className="px-1 py-1 text-sm text-muted-foreground">{error}</p> : null}
            <PillButton type="submit" disabled={loading || !email.trim()} className="w-full justify-center text-sm shadow-none sm:w-auto">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? "Sending code..." : "Continue"}
              {!loading ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
          </form>
        ) : (
          <form onSubmit={handleCodeSubmit} className="space-y-4">
            <div>
              <label htmlFor="vendor-code" className={LABEL_CLASSES}>Verification code</label>
              <input
                id="vendor-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="000000"
                required
                className={INPUT_CLASSES}
              />
            </div>
            {error ? <p className="px-1 py-1 text-sm text-muted-foreground">{error}</p> : null}
            <PillButton type="submit" disabled={loading || !code.trim()} className="w-full justify-center text-sm shadow-none sm:w-auto">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? "Approving..." : "Approve access"}
            </PillButton>
          </form>
        )}
      </AuthCard>
    </AuthMinimalShell>
  );
}
