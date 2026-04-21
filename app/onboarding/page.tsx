"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { AuthCard, AuthMinimalShell, BrandWordmark } from "@/components/auth-shell";
import { AgentHandleForm } from "@/components/agent-handle-form";
import { ConnectionForm } from "@/components/connection-form";
import { PillButton } from "@/components/ui/pill-button";
import { LogoIcon } from "@/components/ui/logo-icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, ArrowRight, AtSign, Check, Loader2, Mail } from "lucide-react";
import { FaGoogle } from "react-icons/fa";
import { toast } from "sonner";
import { useOnboardingCache } from "@/hooks/use-onboarding-cache";

type Step = 0 | 1 | 2 | 3 | 4;
type EnrichmentState = "idle" | "running" | "success" | "error";

const STEPS: ReadonlyArray<{ label: string; subtitle?: string }> = [
  { label: "Create your profile" },
  { label: "Create your workspace" },
  { label: "Claim your handle", subtitle: "Choose the email handle your team will use to reach Glass." },
  { label: "Connect your inbox", subtitle: "Connect your inbox so Glass can find policies and related insurance activity." },
  { label: "Finish your setup" },
] as const;

const BACKSYNC_OPTIONS = [
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
  { label: "3 months", days: 90 },
  { label: "6 months", days: 180 },
  { label: "1 year", days: 365 },
] as const;

function normalizeWebsite(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function StepDots({ currentStep }: { currentStep: Step }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {STEPS.map((step, index) => (
        <div
          key={step.label}
          className={`rounded-full transition-all ${
            index === currentStep
              ? "h-1.5 w-6 bg-foreground sm:h-1.5 sm:w-7"
              : "h-1.5 w-1.5 bg-foreground/15 sm:h-1.5 sm:w-1.5"
          }`}
        />
      ))}
    </div>
  );
}

function Shell({
  children,
  currentStep,
  email,
  onLogout,
}: {
  children: ReactNode;
  currentStep?: Step;
  email?: string;
  onLogout?: () => Promise<void> | void;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="w-full px-6 py-6 sm:px-8">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-sm text-muted-foreground">
          <div className="justify-self-start min-w-0">
            <div className="sm:hidden">
              <LogoIcon size={18} color="#A0D2FA" static />
            </div>
            <div className="hidden sm:block">
              <BrandWordmark />
            </div>
          </div>
          <div className="justify-self-center">
            {typeof currentStep === "number" ? <StepDots currentStep={currentStep} /> : null}
          </div>
          <div className="justify-self-end text-right text-sm text-muted-foreground min-w-0">
            {email ? (
              <div className="flex items-center gap-3">
                <span className="hidden sm:inline">{email}</span>
                {onLogout ? (
                  <button
                    type="button"
                    onClick={() => void onLogout()}
                    className="font-medium text-foreground transition hover:opacity-70"
                  >
                    Log out
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl justify-center px-6 pt-20 pb-12 sm:px-8 sm:pt-24 sm:pb-16">{children}</main>
    </div>
  );
}

export default function OnboardingPage() {
  const { signOut } = useAuthActions();
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewer = useQuery(api.users.viewer);
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const connections = useQuery(api.connections.list);

  // Dual-org routing: redirect broker users and broker-flow signups
  useEffect(() => {
    if (viewerOrg === undefined) return; // still loading

    if (viewerOrg) {
      const orgType = (viewerOrg.org as { type?: string }).type ?? "client";
      if (orgType === "broker") {
        router.replace("/"); // broker dashboard (future)
        return;
      }
      return;
    }

    // No org yet — check if broker flow was requested
    const isBrokerFlow = searchParams?.get("type") === "broker";
    if (isBrokerFlow) {
      router.replace("/onboarding/broker");
    }
  }, [viewerOrg, router, searchParams]);
  const pendingInvitation = useQuery(api.orgs.pendingInvitationForViewer);
  const updateProfile = useMutation(api.users.updateProfile);
  const createOrg = useMutation(api.orgs.createOrg);
  const updateOrg = useMutation(api.orgs.updateOrg);
  const acceptInvitation = useMutation(api.orgs.acceptInvitation);
  const completeOnboarding = useMutation(api.users.completeOnboarding);
  const createOAuthState = useMutation(api.connections.createOAuthStateForViewer);
  const extractCompanyInfo = useAction(api.actions.extractCompanyInfo.extractCompanyInfo);
  const { setOnboardingComplete, clearCache: clearOnboardingCache } = useOnboardingCache();

  const stepParam = searchParams?.get("step");
  const parsedStep = stepParam ? Number(stepParam) : NaN;
  const initialStep: Step =
    Number.isFinite(parsedStep) && parsedStep >= 0 && parsedStep <= 4
      ? (parsedStep as Step)
      : 0;

  const [currentStep, setCurrentStepState] = useState<Step>(initialStep);
  const [imapFormOpen, setImapFormOpen] = useState(false);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const claimRef = useRef<(() => Promise<void>) | null>(null);

  const setCurrentStep = useCallback(
    (next: Step) => {
      setCurrentStepState(next);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("step", String(next));
      router.replace(`/onboarding?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  useEffect(() => {
    if (stepParam == null) return;
    if (Number.isFinite(parsedStep) && parsedStep !== currentStep) {
      setCurrentStepState(parsedStep as Step);
    }
  }, [stepParam, parsedStep, currentStep]);

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [historyDays, setHistoryDays] = useState(30);

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingOrg, setSavingOrg] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [acceptingInvite, setAcceptingInvite] = useState(false);
  const [enrichmentState, setEnrichmentState] = useState<EnrichmentState>("idle");
  const [canClaimHandle, setCanClaimHandle] = useState(false);

  useEffect(() => {
    if (!viewer) return;
    setName(viewer.name ?? "");
    setRole(viewer.title ?? "");
  }, [viewer]);

  useEffect(() => {
    const org = viewerOrg?.org;
    if (!org) {
      setCompanyName(viewer?.companyName ?? "");
      setCompanyWebsite(viewer?.companyWebsite ?? "");
      return;
    }
    setCompanyName(org.name ?? viewer?.companyName ?? "");
    setCompanyWebsite(org.website ?? viewer?.companyWebsite ?? "");
  }, [viewer, viewerOrg]);

  const nonDemoConnections = connections?.filter((connection) => !connection.isDemo) ?? [];
  const hasConnection = nonDemoConnections.length > 0;
  const primaryConnection = nonDemoConnections[0];
  const existingHandle = viewerOrg?.org?.agentHandle ?? viewer?.agentHandle;
  const scanStatus = primaryConnection?.lastScanStatus;
  const syncComplete = scanStatus === "success";
  const syncFailed = scanStatus === "error" || scanStatus === "disconnected";
  const hasContext = Boolean(viewerOrg?.org?.context);
  const websiteProvided = Boolean((viewerOrg?.org?.website ?? viewer?.companyWebsite)?.trim());

  async function handleLogout() {
    clearOnboardingCache();
    await signOut();
    router.replace("/login");
  }

  async function handleProfileNext() {
    setSavingProfile(true);
    try {
      await updateProfile({ name: name.trim(), title: role.trim() });
      setCurrentStep(1);
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleOrgNext() {
    const normalizedWebsite = normalizeWebsite(companyWebsite);
    setSavingOrg(true);

    try {
      await updateProfile({
        companyName: companyName.trim(),
        companyWebsite: normalizedWebsite,
      });

      if (viewerOrg?.org) {
        await updateOrg({
          name: companyName.trim(),
          website: normalizedWebsite,
        });
      } else {
        await createOrg({
          name: companyName.trim(),
          website: normalizedWebsite,
        });
      }

      setCurrentStep(2);
      setEnrichmentState(normalizedWebsite ? "running" : "idle");

      if (normalizedWebsite) {
        void extractCompanyInfo({ url: normalizedWebsite })
          .then((result) => {
            if (result?.error) {
              setEnrichmentState("error");
              return;
            }
            setEnrichmentState("success");
          })
          .catch(() => {
            setEnrichmentState("error");
          });
      }
    } finally {
      setSavingOrg(false);
    }
  }

  async function handleConnectGoogle() {
    setConnectingGoogle(true);
    try {
      const sinceDate = new Date(Date.now() - historyDays * 86400000)
        .toISOString()
        .split("T")[0];
      const state = crypto.randomUUID();
      await createOAuthState({ state, sinceDate, returnTo: "/onboarding?step=3" });
      window.location.href = `/api/auth/google/start?state=${encodeURIComponent(state)}`;
    } catch (err) {
      setConnectingGoogle(false);
      toast.error(err instanceof Error ? err.message : "Failed to start Google connection");
    }
  }

  async function handleFinish() {
    setFinishing(true);
    try {
      await completeOnboarding();
      setOnboardingComplete(true);
      router.replace("/");
    } catch (err) {
      setFinishing(false);
      toast.error(err instanceof Error ? err.message : "Failed to finish onboarding");
    }
  }

  async function handleAcceptInvitation() {
    if (!pendingInvitation) return;
    setAcceptingInvite(true);
    try {
      if (inviteName.trim()) {
        await updateProfile({ name: inviteName.trim() });
      }
      await acceptInvitation({ invitationId: pendingInvitation.invitationId });
      await completeOnboarding();
      setOnboardingComplete(true);
      router.replace("/");
    } catch (err) {
      setAcceptingInvite(false);
      toast.error(err instanceof Error ? err.message : "Failed to accept invitation");
    }
  }

  if (
    viewer === undefined ||
    viewerOrg === undefined ||
    connections === undefined ||
    pendingInvitation === undefined
  ) {
    return (
      <Shell>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Shell>
    );
  }

  if (pendingInvitation && !viewerOrg) {
    return (
      <AuthMinimalShell>
        <AuthCard
          title="Join workspace"
          subtitle={`You've been invited to join ${pendingInvitation.orgName}.`}
          logo={<BrandWordmark />}
        >
          <div className="space-y-6">
            <div className="text-base text-muted-foreground">
              <p className="font-medium text-foreground">{pendingInvitation.orgName}</p>
              <p className="mt-1 text-muted-foreground">
                Invited by {pendingInvitation.invitedByName} as {pendingInvitation.role}.
              </p>
            </div>

            <div className="space-y-3">
              <label className="text-label-sm font-medium text-muted-foreground block mb-1.5">Your name</label>
              <input
                type="text"
                value={inviteName}
                onChange={(event) => setInviteName(event.target.value)}
                placeholder="Jane Smith"
                autoFocus
                className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
              />
            </div>

            <PillButton
              type="button"
              onClick={handleAcceptInvitation}
              disabled={acceptingInvite}
              className="w-full justify-center text-sm shadow-none sm:w-auto"
            >
              {acceptingInvite ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Join workspace
            </PillButton>
          </div>
        </AuthCard>
      </AuthMinimalShell>
    );
  }

  const canContinueProfile = name.trim().length > 0 && role.trim().length > 0;
  const canContinueOrg = companyName.trim().length > 0 && companyWebsite.trim().length > 0;

  return (
      <Shell currentStep={currentStep} email={viewer?.email} onLogout={handleLogout}>
        <div className="w-full max-w-md space-y-8">
          <div className="space-y-3 text-left">
            <h1 className="text-base font-medium tracking-tight">{STEPS[currentStep].label}</h1>
            {STEPS[currentStep].subtitle ? (
              <p className="text-base text-muted-foreground">{STEPS[currentStep].subtitle}</p>
            ) : null}
          </div>

          {currentStep === 0 && (
            <div className="space-y-10">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-label-sm font-medium text-muted-foreground block mb-1.5">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Jane Smith"
                    autoFocus
                    className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-label-sm font-medium text-muted-foreground block mb-1.5">Role</label>
                  <input
                    type="text"
                    value={role}
                    onChange={(event) => setRole(event.target.value)}
                    placeholder="Operations Manager"
                    className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                  />
                </div>
              </div>

              <PillButton
                type="button"
                onClick={handleProfileNext}
                disabled={!canContinueProfile || savingProfile}
                className="w-full justify-center text-sm shadow-none sm:w-auto"
              >
                {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Continue
                {!savingProfile ? <ArrowRight className="h-4 w-4" /> : null}
              </PillButton>
            </div>
          )}

          {currentStep === 1 && (
            <div className="space-y-10">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-label-sm font-medium text-muted-foreground block mb-1.5">Company name</label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(event) => setCompanyName(event.target.value)}
                    placeholder="Acme Insurance Brokerage"
                    autoFocus
                    className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-label-sm font-medium text-muted-foreground block mb-1.5">Website</label>
                  <input
                    type="text"
                    value={companyWebsite}
                    onChange={(event) => setCompanyWebsite(event.target.value)}
                    placeholder="yourcompany.com"
                    className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                  />
                </div>
              </div>

              <PillButton
                type="button"
                onClick={handleOrgNext}
                disabled={!canContinueOrg || savingOrg}
                className="w-full justify-center text-sm shadow-none sm:w-auto"
              >
                {savingOrg ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Continue
                {!savingOrg ? <ArrowRight className="h-4 w-4" /> : null}
              </PillButton>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-10">
              <div className="space-y-3">
                <label className="text-label-sm font-medium text-muted-foreground block mb-1.5">Agent handle</label>
                {existingHandle ? (
                  <div className="flex items-start gap-3 text-base text-muted-foreground">
                      <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-foreground/[0.03]">
                        <Check className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">Handle claimed</p>
                        <p className="mt-1 text-sm text-muted-foreground">{existingHandle}@{process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "glass.claritylabs.inc"}</p>
                      </div>
                  </div>
                ) : (
                  <AgentHandleForm
                    suggestedHandle={
                      companyName
                        ? companyName
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, "-")
                            .replace(/^-|-$/g, "")
                        : undefined
                    }
                    hideButton
                    claimRef={claimRef}
                    onAvailabilityChange={setCanClaimHandle}
                    onClaimed={() => setCurrentStep(3)}
                  />
                )}
              </div>

              {existingHandle ? (
                <PillButton
                  type="button"
                  onClick={() => setCurrentStep(3)}
                  className="w-full justify-center text-sm shadow-none sm:w-auto"
                >
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </PillButton>
              ) : (
                <PillButton
                  type="button"
                  onClick={() => claimRef.current?.()}
                  disabled={!canClaimHandle}
                  className="w-full justify-center text-sm shadow-none sm:w-auto"
                >
                  <AtSign className="h-4 w-4" />
                  Claim handle
                </PillButton>
              )}
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-8">
              {hasConnection ? (
                <>
                  <div className="flex items-start gap-3 text-base text-muted-foreground">
                    <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-foreground/[0.03]">
                      <Check className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">Email connected</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Connected as {primaryConnection?.email ?? primaryConnection?.label ?? "your account"}.
                      </p>
                    </div>
                  </div>
                  <PillButton
                    type="button"
                    onClick={() => setCurrentStep(4)}
                    className="w-full justify-center text-sm shadow-none sm:w-auto"
                  >
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </PillButton>
                </>
              ) : (
                <>
                  <div className="rounded-xl border border-foreground/8 bg-popover/60">
                    <div className="flex items-start justify-between gap-4 px-4 py-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">Backsync range</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Choose how far back Glass should scan your inbox.
                        </p>
                      </div>
                      <Select
                        value={String(historyDays)}
                        onValueChange={(value) => setHistoryDays(Number(value))}
                      >
                        <SelectTrigger className="shrink-0 min-w-[9rem]">
                          <SelectValue>
                            {
                              BACKSYNC_OPTIONS.find((o) => o.days === historyDays)?.label
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent
                          align="end"
                          sideOffset={6}
                          alignItemWithTrigger={false}
                          className="min-w-[9rem] p-1"
                        >
                          {BACKSYNC_OPTIONS.map((option) => (
                            <SelectItem
                              key={option.days}
                              value={String(option.days)}
                              className="py-1.5 pr-7 pl-2"
                            >
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <button
                      type="button"
                      disabled={connectingGoogle}
                      onClick={handleConnectGoogle}
                      className="flex w-full items-center justify-center gap-3 rounded-lg bg-foreground px-4 py-3.5 text-body-sm font-medium text-background shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {connectingGoogle ? (
                        <Loader2 className="h-[18px] w-[18px] animate-spin" />
                      ) : (
                        <FaGoogle size={18} />
                      )}
                      Connect Gmail
                    </button>
                    <button
                      type="button"
                      onClick={() => setImapFormOpen(true)}
                      className="flex w-full items-center justify-center gap-3 rounded-lg border border-foreground/8 bg-popover px-4 py-3.5 text-body-sm font-medium text-foreground transition-all hover:border-foreground/15 hover:bg-foreground/[0.02]"
                    >
                      <Mail className="h-[18px] w-[18px]" />
                      Connect other IMAP email
                    </button>
                  </div>

                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => setCurrentStep(4)}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Skip for now
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {currentStep === 4 && (
            <div className="space-y-10 text-left">
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-xl border border-foreground/8 bg-popover/60 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Workspace created</p>
                    <p className="mt-1 text-sm text-muted-foreground">Your profile, workspace, and handle are ready.</p>
                  </div>
                  <Check className="h-4 w-4 text-foreground" />
                </div>

                {(() => {
                  const label = hasConnection ? "Email inbox connected" : "Email inbox";
                  let detail: string;
                  let icon: ReactNode = null;
                  let skipped = false;
                  if (!hasConnection) {
                    detail = "Skipped — connect your inbox any time from Settings.";
                    skipped = true;
                  } else if (syncComplete) {
                    detail = `Synced ${primaryConnection?.email ?? primaryConnection?.label ?? "your inbox"}.`;
                    icon = <Check className="h-4 w-4 text-foreground" />;
                  } else if (syncFailed) {
                    detail = `${primaryConnection?.email ?? "Your inbox"} couldn't sync. Retry from Settings after onboarding.`;
                    icon = <AlertCircle className="h-4 w-4 text-muted-foreground" />;
                  } else {
                    detail = `Connected ${primaryConnection?.email ?? primaryConnection?.label ?? "your inbox"}. Initial sync running in the background.`;
                    icon = <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
                  }
                  return (
                    <div
                      className={`flex items-center justify-between rounded-xl border border-foreground/8 bg-popover/60 px-4 py-3 transition-opacity ${skipped ? "opacity-50" : ""}`}
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{label}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
                      </div>
                      {icon}
                    </div>
                  );
                })()}

                {(() => {
                  let label = "Company information gathered from website";
                  let detail: string;
                  let icon: ReactNode = null;
                  let skipped = false;
                  if (!websiteProvided) {
                    label = "Company information";
                    detail = "No website provided — add one in Settings to enrich your workspace later.";
                    skipped = true;
                  } else if (hasContext) {
                    detail = "Glass filled in additional org context from your website.";
                    icon = <Check className="h-4 w-4 text-foreground" />;
                  } else if (enrichmentState === "error") {
                    detail = "Glass couldn't gather company information automatically. You can still continue.";
                    icon = <AlertCircle className="h-4 w-4 text-muted-foreground" />;
                  } else {
                    detail = "Glass is still gathering company information from your website.";
                    icon = <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
                  }
                  return (
                    <div
                      className={`flex items-center justify-between rounded-xl border border-foreground/8 bg-popover/60 px-4 py-3 transition-opacity ${skipped ? "opacity-50" : ""}`}
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{label}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
                      </div>
                      {icon}
                    </div>
                  );
                })()}
              </div>

              <PillButton
                type="button"
                onClick={handleFinish}
                disabled={finishing}
                className="w-full justify-center text-sm shadow-none sm:w-auto"
              >
                {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Continue to Glass
                {!finishing ? <ArrowRight className="h-4 w-4" /> : null}
              </PillButton>
            </div>
          )}
        </div>

      <ConnectionForm
        open={imapFormOpen}
        onClose={() => setImapFormOpen(false)}
        returnTo="/onboarding?step=3"
        initialHistoryDays={historyDays}
        initialStep="imap"
        showBack={false}
      />
    </Shell>
  );
}
