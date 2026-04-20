"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { AuthCard, AuthMinimalShell, BrandWordmark } from "@/components/auth-shell";
import { AgentHandleForm } from "@/components/agent-handle-form";
import { ConnectionForm } from "@/components/connection-form";
import { PillButton } from "@/components/ui/pill-button";
import { LogoIcon } from "@/components/ui/logo-icon";
import { ArrowLeft, ArrowRight, AtSign, Check, ChevronDown, Clock3, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

type Step = 0 | 1 | 2 | 3 | 4;
type EnrichmentState = "idle" | "running" | "success" | "error";

const STEPS: ReadonlyArray<{ label: string; subtitle?: string }> = [
  { label: "Create your profile" },
  { label: "Create your workspace" },
  { label: "Claim your handle", subtitle: "Choose the email handle your team will use to reach Prism." },
  { label: "Connect your inbox", subtitle: "Connect your inbox so Prism can find policies and related insurance activity." },
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
      <header className="w-full px-6 py-6 sm:px-8 sm:py-7">
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
  const viewer = useQuery(api.users.viewer);
  const viewerOrg = useQuery(api.orgs.viewerOrg);
  const connections = useQuery(api.connections.list);
  const pendingInvitation = useQuery(api.orgs.pendingInvitationForViewer);
  const updateProfile = useMutation(api.users.updateProfile);
  const createOrg = useMutation(api.orgs.createOrg);
  const updateOrg = useMutation(api.orgs.updateOrg);
  const acceptInvitation = useMutation(api.orgs.acceptInvitation);
  const completeOnboarding = useMutation(api.users.completeOnboarding);
  const extractCompanyInfo = useAction(api.actions.extractCompanyInfo.extractCompanyInfo);

  const [currentStep, setCurrentStep] = useState<Step>(0);
  const [connectionFormOpen, setConnectionFormOpen] = useState(false);
  const claimRef = useRef<(() => Promise<void>) | null>(null);

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
  const syncComplete = primaryConnection?.lastScanStatus === "success";

  async function handleLogout() {
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

  async function handleFinish() {
    setFinishing(true);
    try {
      await completeOnboarding();
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
          <div className="space-y-6 px-1 py-2">
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
            <div className="px-1 py-2">
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
            </div>
          )}

          {currentStep === 1 && (
            <div className="px-1 py-2">
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

              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <PillButton
                  type="button"
                  variant="secondary"
                  onClick={() => setCurrentStep(0)}
                  className="w-full text-sm shadow-none sm:w-auto"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </PillButton>
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
            </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="px-1 py-2">
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
                        <p className="mt-1 text-sm text-muted-foreground">{existingHandle}@{process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "prism.claritylabs.inc"}</p>
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

              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <PillButton
                  type="button"
                  variant="secondary"
                  onClick={() => setCurrentStep(1)}
                  className="w-full text-sm shadow-none sm:w-auto"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </PillButton>
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
            </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="px-1 py-2">
            <div className="space-y-10">
              {!hasConnection ? (
                <div className="rounded-xl border border-foreground/8 bg-popover/60">
                  <div className="flex items-start justify-between gap-4 px-4 py-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">Backsync range</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Choose how far back Prism should scan your inbox after you connect it.
                      </p>
                    </div>
                    <div className="relative shrink-0">
                      <select
                        value={historyDays}
                        onChange={(event) => setHistoryDays(Number(event.target.value))}
                        className="appearance-none rounded-lg border border-foreground/8 bg-background py-2 pl-3 pr-9 text-sm text-foreground outline-none transition focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8"
                      >
                        {BACKSYNC_OPTIONS.map((option) => (
                          <option key={option.days} value={option.days}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    </div>
                  </div>
                </div>
              ) : (
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
              )}

              {!hasConnection ? (
                <PillButton
                  type="button"
                  variant="secondary"
                  onClick={() => setConnectionFormOpen(true)}
                  className="w-full justify-center text-sm shadow-none sm:w-auto"
                >
                  <Mail className="h-4 w-4" />
                  Connect email
                </PillButton>
              ) : null}

              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <PillButton
                  type="button"
                  variant="secondary"
                  onClick={() => setCurrentStep(2)}
                  className="w-full text-sm shadow-none sm:w-auto"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </PillButton>
                <PillButton
                  type="button"
                  onClick={() => setCurrentStep(4)}
                  disabled={!hasConnection}
                  className="w-full justify-center text-sm shadow-none sm:w-auto"
                >
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </PillButton>
              </div>
            </div>
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

                <div className="flex items-center justify-between rounded-xl border border-foreground/8 bg-popover/60 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Email inbox connected and synced</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {syncComplete
                        ? `Synced ${primaryConnection?.email ?? primaryConnection?.label ?? "your inbox"}.`
                        : hasConnection
                          ? `Connected ${primaryConnection?.email ?? primaryConnection?.label ?? "your inbox"}. Initial sync is still running.`
                          : "Waiting for an inbox connection to finish syncing."}
                    </p>
                  </div>
                  {syncComplete ? (
                    <Check className="h-4 w-4 text-foreground" />
                  ) : (
                    <Clock3 className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>

                <div className="flex items-center justify-between rounded-xl border border-foreground/8 bg-popover/60 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Company information gathered from website</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {enrichmentState === "success"
                        ? "Company enrichment finished. Prism filled in additional org context automatically."
                        : enrichmentState === "error"
                          ? "Prism couldn't gather company information automatically, but you can continue."
                          : "Prism is still gathering company information from your website."}
                    </p>
                  </div>
                  {enrichmentState === "success" ? (
                    <Check className="h-4 w-4 text-foreground" />
                  ) : (
                    <Clock3 className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <PillButton
                  type="button"
                  variant="secondary"
                  onClick={() => setCurrentStep(3)}
                  className="w-full text-sm shadow-none sm:w-auto"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </PillButton>
                <PillButton
                  type="button"
                  onClick={handleFinish}
                  disabled={finishing}
                  className="w-full justify-center text-sm shadow-none sm:w-auto"
                >
                  {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Enter Prism
                </PillButton>
              </div>
            </div>
          )}
        </div>

      <ConnectionForm
        open={connectionFormOpen}
        onClose={() => setConnectionFormOpen(false)}
        returnTo="/onboarding"
        initialHistoryDays={historyDays}
      />
    </Shell>
  );
}
