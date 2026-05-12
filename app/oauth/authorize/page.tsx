"use client";

import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { AuthCard, AuthShell } from "@/components/auth-shell";
import { PillButton } from "@/components/ui/pill-button";
import { Loader2, ArrowLeft, ArrowRight, X } from "lucide-react";

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
  const [redirecting, setRedirecting] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState("");

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
      window.location.assign(url.toString());
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
    } catch (err: unknown) {
      setError(friendlyError(err instanceof Error ? err.message : ""));
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
    } catch (err: unknown) {
      setError(friendlyError(err instanceof Error ? err.message : ""));
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
      const target = url.toString();
      setRedirectUrl(target);
      setRedirecting(true);
      window.location.assign(target);
    } catch (err: unknown) {
      const message = typeof err === "string" ? err
        : (err as { data?: string; message?: string } | null)?.data
          ?? (err instanceof Error ? err.message : null)
          ?? "Failed to authorize";
      setError(String(message));
      setAuthorizing(false);
    }
  }

  function handleDeny() {
    redirectWithError("access_denied");
  }

  // Invalid params
  if (!paramsValid) {
    return (
      <AuthShell>
        <AuthCard title="Invalid request" subtitle="This authorization request could not be completed.">
          <div className="text-center">
            <X className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              This authorization request is missing required parameters.
            </p>
          </div>
        </AuthCard>
      </AuthShell>
    );
  }

  // Loading auth state
  if (authLoading) {
    return (
      <AuthShell>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </AuthShell>
    );
  }

  // Not authenticated — show login
  if (!isAuthenticated) {
    return (
      <AuthShell>
        <AuthCard title="Authorize app" subtitle="Sign in to connect your Glass account.">

            {loginStep === "email" ? (
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
                {error && (
                  <p className="px-1 py-1 text-sm text-muted-foreground">
                    {error}
                  </p>
                )}
                <PillButton type="submit" disabled={sendingCode || !email} className="h-12 w-full justify-center text-sm shadow-none">
                  {sendingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {sendingCode ? "Sending code..." : "Send verification code"}
                  {!sendingCode ? <ArrowRight className="h-4 w-4" /> : null}
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
                      const el = document.getElementById("oauth-otp-input") as HTMLInputElement | null;
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
                  <p className="mt-2 text-sm text-muted-foreground">
                    We sent a 6-digit code to{" "}
                    <span className="font-medium text-foreground">{email}</span>
                  </p>
                </div>
                {error && (
                  <p className="px-1 py-1 text-sm text-muted-foreground">
                    {error}
                  </p>
                )}
                <div className="flex flex-col gap-3 pt-1">
                  <PillButton type="submit" disabled={verifying || code.length < 6} className="h-12 w-full justify-center text-sm shadow-none">
                    {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {verifying ? "Verifying..." : "Verify and continue"}
                    {!verifying ? <ArrowRight className="h-4 w-4" /> : null}
                  </PillButton>
                  <PillButton
                    type="button"
                    variant="secondary"
                    onClick={() => { setLoginStep("email"); setCode(""); setError(""); }}
                    className="h-12 w-full justify-center text-sm shadow-none"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Use a different email
                  </PillButton>
                </div>
              </form>
            )}
        </AuthCard>
      </AuthShell>
    );
  }

  // Authenticated — show consent screen
  const cardTitle = redirecting ? "Connected" : "Authorize app";
  const cardSubtitle = redirecting && clientInfo
    ? `Redirecting you back to ${clientInfo.clientName}...`
    : clientInfo
      ? `${clientInfo.clientName} wants to access your Glass account.`
      : "Review this request before continuing.";

  return (
    <AuthShell>
      <AuthCard title={cardTitle} subtitle={cardSubtitle}>
          {clientInfo === undefined ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : clientInfo === null ? (
            <div className="text-center py-4">
              <X className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <h2 className="mb-1 text-lg font-medium text-foreground">Unknown application</h2>
              <p className="text-sm text-muted-foreground">
                This application is not registered or the redirect URI doesn&apos;t match.
              </p>
            </div>
          ) : redirecting ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                If you&apos;re not redirected automatically,{" "}
                <a href={redirectUrl} className="font-medium text-foreground hover:underline">
                  click here
                </a>
                . You can also close this window.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="text-base text-muted-foreground">
                <p className="mb-2 text-sm font-medium text-foreground">
                  This will allow the app to:
                </p>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <span className="text-foreground/30 mt-0.5">&#x2022;</span>
                    Read your policies and quotes
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-foreground/30 mt-0.5">&#x2022;</span>
                    Access conversation threads
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-foreground/30 mt-0.5">&#x2022;</span>
                    Ask questions via Glass AI
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-foreground/30 mt-0.5">&#x2022;</span>
                    Read and update org memory
                  </li>
                  {(scope ?? "").split(" ").includes("write") && (
                    <li className="flex items-start gap-2">
                      <span className="text-foreground/30 mt-0.5">&#x2022;</span>
                      Modify your insurance data (write access)
                    </li>
                  )}
                </ul>
                {scope && (
                  <p className="mt-2 text-xs text-muted-foreground/60">
                    Requested scopes: {scope}
                  </p>
                )}
              </div>

              {error && (
                <p className="px-1 py-1 text-sm text-muted-foreground">
                  {error}
                </p>
              )}

              <div className="flex flex-col gap-3">
                <PillButton
                  type="button"
                  onClick={handleAllow}
                  disabled={authorizing}
                  className="h-12 w-full justify-center text-sm shadow-none"
                >
                  {authorizing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {authorizing ? "Authorizing..." : "Allow"}
                </PillButton>
                <PillButton
                  type="button"
                  variant="secondary"
                  onClick={handleDeny}
                  disabled={authorizing}
                  className="h-12 w-full justify-center text-sm shadow-none"
                >
                  Deny
                </PillButton>
              </div>
            </div>
          )}
      </AuthCard>
    </AuthShell>
  );
}
