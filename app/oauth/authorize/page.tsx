"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { FadeIn } from "@/components/ui/fade-in";
import { LogoIcon } from "@/components/ui/logo-icon";
import { AuthHeroBackground, PrismHeroLogo } from "@/components/auth-hero-background";
import { PillButton } from "@/components/ui/pill-button";
import { Loader2, ArrowLeft, ArrowRight, Shield, X } from "lucide-react";

function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("could not verify code") || lower.includes("invalid code"))
    return "That code didn't work. Please double-check and try again.";
  if (lower.includes("expired"))
    return "This code has expired. Please request a new one.";
  if (lower.includes("too many") || lower.includes("rate limit"))
    return "Too many attempts. Please wait a moment and try again.";
  return "Something went wrong. Please try again.";
}

export default function OAuthAuthorizePage() {
  const searchParams = useSearchParams();
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();

  // Parse OAuth params
  const clientId = searchParams.get("client_id") ?? "";
  const redirectUri = searchParams.get("redirect_uri") ?? "";
  const codeChallenge = searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = searchParams.get("code_challenge_method") ?? "";
  const state = searchParams.get("state") ?? "";
  const responseType = searchParams.get("response_type") ?? "";
  const scope = searchParams.get("scope") ?? undefined;

  // Validate required params
  const paramsValid = responseType === "code" && clientId && redirectUri && codeChallenge && codeChallengeMethod === "S256";

  // Login state
  const [loginStep, setLoginStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  // Consent state
  const [authorizing, setAuthorizing] = useState(false);

  // Load client info (only when authenticated)
  const clientInfo = useQuery(
    api.oauth.getClientInfo,
    isAuthenticated && clientId && redirectUri
      ? { clientId, redirectUri }
      : "skip",
  );
  const createAuthCode = useMutation(api.oauth.createAuthorizationCode);

  function redirectWithError(errorCode: string) {
    try {
      const url = new URL(redirectUri);
      url.searchParams.set("error", errorCode);
      if (state) url.searchParams.set("state", state);
      window.location.href = url.toString();
    } catch {
      // Invalid redirect URI — just show error
      setError(`Authorization failed: ${errorCode}`);
    }
  }

  // Login handlers
  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSendingCode(true);
    setError("");
    try {
      await signIn("resend-otp", { email });
      setLoginStep("code");
    } catch (err: any) {
      setError(friendlyError(err.message || ""));
    } finally {
      setSendingCode(false);
    }
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

  // Consent handlers
  async function handleAllow() {
    setAuthorizing(true);
    setError("");
    try {
      const authCode = await createAuthCode({
        clientId,
        redirectUri,
        codeChallenge,
        scope,
      });
      const url = new URL(redirectUri);
      url.searchParams.set("code", authCode);
      if (state) url.searchParams.set("state", state);
      window.location.href = url.toString();
    } catch (err: any) {
      setError(err.message || "Failed to authorize");
      setAuthorizing(false);
    }
  }

  function handleDeny() {
    redirectWithError("access_denied");
  }

  // Invalid params
  if (!paramsValid) {
    return (
      <div className="relative flex min-h-screen items-center justify-center px-4 overflow-hidden">
        <AuthHeroBackground />
        <FadeIn className="relative z-10 w-full max-w-sm">
          <PrismHeroLogo />
          <div className="rounded-xl border border-foreground/8 bg-background p-6 sm:p-8 text-center">
            <X className="w-8 h-8 text-red-400 mx-auto mb-3" />
            <h2 className="text-body-lg font-semibold text-foreground mb-1">Invalid Request</h2>
            <p className="text-body-sm text-muted-foreground">
              This authorization request is missing required parameters.
            </p>
          </div>
        </FadeIn>
      </div>
    );
  }

  // Loading auth state
  if (authLoading) {
    return (
      <div className="relative flex min-h-screen items-center justify-center px-4 overflow-hidden">
        <AuthHeroBackground />
        <FadeIn className="relative z-10">
          <Loader2 className="w-6 h-6 animate-spin text-white/40" />
        </FadeIn>
      </div>
    );
  }

  // Not authenticated — show login
  if (!isAuthenticated) {
    return (
      <div className="relative flex min-h-screen items-center justify-center px-4 overflow-hidden">
        <AuthHeroBackground />
        <FadeIn className="relative z-10 w-full max-w-sm">
          <PrismHeroLogo />
          <div className="rounded-xl border border-foreground/8 bg-background p-6 sm:p-8">
            <p className="text-label-sm text-muted-foreground text-center mb-4">
              Sign in to connect your Prism account
            </p>

            {loginStep === "email" ? (
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
                    className="w-full rounded-lg border border-foreground/10 bg-white/80 dark:bg-white/[0.06] px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                  />
                </div>
                {error && (
                  <p className="text-body-sm text-muted-foreground bg-white/50 dark:bg-white/[0.04] border border-foreground/6 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}
                <PillButton type="submit" disabled={sendingCode || !email} className="w-full">
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
                      const el = document.getElementById("oauth-otp-input") as HTMLInputElement | null;
                      el?.focus();
                    }}
                  >
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div
                        key={i}
                        className={`flex-1 aspect-square max-h-14 rounded-lg border bg-white/60 dark:bg-white/[0.04] flex items-center justify-center text-xl font-semibold font-mono transition-colors ${
                          code.length === i
                            ? "border-foreground/30 ring-1 ring-foreground/10"
                            : "border-foreground/10"
                        }`}
                      >
                        {code[i] ?? ""}
                      </div>
                    ))}
                    <input
                      id="oauth-otp-input"
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
                  <p className="text-label-sm text-foreground/40 mt-2">
                    We sent a 6-digit code to{" "}
                    <span className="text-foreground/70 font-medium">{email}</span>
                  </p>
                </div>
                {error && (
                  <p className="text-body-sm text-muted-foreground bg-white/50 dark:bg-white/[0.04] border border-foreground/6 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}
                <div className="flex flex-col gap-2.5 pt-1">
                  <PillButton type="submit" disabled={verifying || code.length < 6} className="w-full">
                    {verifying ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        Verify & continue
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </PillButton>
                  <PillButton
                    variant="secondary"
                    onClick={() => { setLoginStep("email"); setCode(""); setError(""); }}
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

  // Authenticated — show consent screen
  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 overflow-hidden">
      <AuthHeroBackground />
      <FadeIn className="relative z-10 w-full max-w-sm">
        <PrismHeroLogo />
        <div className="rounded-xl border border-foreground/8 bg-background p-6 sm:p-8">
          {clientInfo === undefined ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : clientInfo === null ? (
            <div className="text-center py-4">
              <X className="w-8 h-8 text-red-400 mx-auto mb-3" />
              <h2 className="text-body-lg font-semibold text-foreground mb-1">Unknown Application</h2>
              <p className="text-body-sm text-muted-foreground">
                This application is not registered or the redirect URI doesn&apos;t match.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="text-center">
                <Shield className="w-8 h-8 text-foreground/30 mx-auto mb-3" />
                <h2 className="text-body-lg font-semibold text-foreground">
                  Authorize {clientInfo.clientName}
                </h2>
                <p className="text-body-sm text-muted-foreground mt-1">
                  This application wants to access your Prism account.
                </p>
              </div>

              <div className="rounded-lg border border-foreground/6 bg-foreground/[0.02] p-4">
                <p className="text-label-sm font-medium text-foreground/50 uppercase tracking-wider mb-2">
                  This will allow the app to:
                </p>
                <ul className="space-y-1.5 text-body-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <span className="text-foreground/30 mt-0.5">&#x2022;</span>
                    Read your policies, quotes, and applications
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-foreground/30 mt-0.5">&#x2022;</span>
                    Access conversation threads
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-foreground/30 mt-0.5">&#x2022;</span>
                    Ask questions via Prism AI
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-foreground/30 mt-0.5">&#x2022;</span>
                    Read and update business context
                  </li>
                </ul>
              </div>

              {error && (
                <p className="text-body-sm text-muted-foreground bg-white/50 dark:bg-white/[0.04] border border-foreground/6 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <div className="flex flex-col gap-2.5">
                <PillButton onClick={handleAllow} disabled={authorizing} className="w-full">
                  {authorizing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Authorizing...
                    </>
                  ) : (
                    "Allow"
                  )}
                </PillButton>
                <PillButton variant="secondary" onClick={handleDeny} disabled={authorizing} className="w-full">
                  Deny
                </PillButton>
              </div>
            </div>
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
