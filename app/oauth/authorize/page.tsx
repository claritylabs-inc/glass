"use client";

import { useState } from "react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { useQuery, useMutation } from "convex/react";
import { useSearchParams, useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { FadeIn } from "@/components/ui/fade-in";
import { LogoIcon } from "@/components/ui/logo-icon";
import { AuthHeroBackground, PrismHeroLogo } from "@/components/auth-hero-background";
import { PillButton } from "@/components/ui/pill-button";
import { Loader2, Shield, X } from "lucide-react";


export default function OAuthAuthorizePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isAuthenticated = !!user;

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

  // Consent state
  const [authorizing, setAuthorizing] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState("");
  const [error, setError] = useState("");

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
      window.location.href = target;
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

  // Not authenticated — redirect to WorkOS hosted login
  if (!isAuthenticated) {
    router.replace("/login");
    return (
      <div className="relative flex min-h-screen items-center justify-center px-4 overflow-hidden">
        <AuthHeroBackground />
        <FadeIn className="relative z-10">
          <Loader2 className="w-6 h-6 animate-spin text-white/40" />
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
          ) : redirecting ? (
            <div className="text-center py-6 space-y-3">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" />
              <div>
                <h2 className="text-body-lg font-semibold text-foreground">Connected</h2>
                <p className="text-body-sm text-muted-foreground mt-1">
                  Redirecting you back to {clientInfo.clientName}...
                </p>
              </div>
              <p className="text-label-sm text-muted-foreground/50 mt-4">
                If you&apos;re not redirected automatically,{" "}
                <a href={redirectUrl} className="underline text-foreground/60 hover:text-foreground/80">
                  click here
                </a>
                . You can also close this window.
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
                <p className="text-label-sm font-medium text-foreground/50  mb-2">
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
                <p className="text-body-sm text-red-500/80 bg-red-50 dark:bg-red-950/30 border border-red-200/30 rounded-lg px-3 py-2">
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
