"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { BrandWordmark } from "@/components/auth-shell";
import { PillButton } from "@/components/ui/pill-button";
import { LogoIcon } from "@/components/ui/logo-icon";
import { useOnboardingCache } from "@/hooks/use-onboarding-cache";
import { ArrowRight, Check, Loader2, X } from "lucide-react";

const WORKSPACE_DOMAIN = process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "glass.claritylabs.inc";

type Step = 0 | 1 | 2 | 3;

const STEPS: ReadonlyArray<{ label: string; subtitle?: string }> = [
  { label: "Set up your brokerage", subtitle: "Tell us about your firm." },
  { label: "Claim your workspace link", subtitle: "Pick the web address your clients will use to reach you." },
  { label: "Brand your agent", subtitle: "Choose how your AI agent shows up to clients." },
  { label: "Set up your email handle", subtitle: "Optional — your clients can email this to reach your agent. You can set this up later." },
] as const;

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
      <main className="mx-auto flex w-full max-w-6xl justify-center px-6 pt-20 pb-12 sm:px-8 sm:pt-24 sm:pb-16">
        {children}
      </main>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

const labelClass = "text-label-sm font-medium text-muted-foreground block mb-1.5";

export default function BrokerOnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signOut } = useAuthActions();
  const viewer = useQuery(api.users.viewer);
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const createBrokerOrg = useMutation(api.orgs.createBrokerOrg);
  const updateProfile = useMutation(api.users.updateProfile);
  const updateOrg = useMutation(api.orgs.updateOrg);
  const claimAgentHandle = useMutation(api.orgs.claimAgentHandle);
  const completeOnboarding = useMutation(api.users.completeOnboarding);
  const { setOnboardingComplete, clearCache: clearOnboardingCache } = useOnboardingCache();

  const stepParam = searchParams?.get("step");
  const parsedStep = stepParam ? Number(stepParam) : NaN;
  const initialStep: Step =
    Number.isFinite(parsedStep) && parsedStep >= 0 && parsedStep <= 3
      ? (parsedStep as Step)
      : 0;

  const [currentStep, setCurrentStepState] = useState<Step>(initialStep);

  const setCurrentStep = useCallback(
    (next: Step) => {
      setCurrentStepState(next);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("step", String(next));
      router.replace(`/onboarding/broker?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  useEffect(() => {
    if (stepParam == null) return;
    if (Number.isFinite(parsedStep) && parsedStep !== currentStep) {
      setCurrentStepState(parsedStep as Step);
    }
  }, [stepParam, parsedStep, currentStep]);
  const [orgName, setOrgName] = useState("");
  const [website, setWebsite] = useState("");
  const [slugInput, setSlugInput] = useState("");
  const [debouncedSlug, setDebouncedSlug] = useState("");
  const [brandingColor, setBrandingColor] = useState("#4F46E5");
  const [agentDisplayName, setAgentDisplayName] = useState("");
  const [agentHandle, setAgentHandle] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!viewer) return;
    setOrgName((v) => v || viewer.companyName || "");
    setWebsite((v) => v || viewer.companyWebsite || "");
  }, [viewer]);

  useEffect(() => {
    const org = viewerOrg?.org;
    if (!org) return;
    setOrgName((v) => v || org.name || "");
    setWebsite((v) => v || org.website || "");
    setSlugInput((v) => v || org.slug || "");
    setBrandingColor((v) => (v && v !== "#4F46E5" ? v : org.brandingColor || "#4F46E5"));
    setAgentDisplayName((v) => v || org.agentDisplayName || "");
    setAgentHandle((v) => v || org.agentHandle || "");
  }, [viewerOrg]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSlug(slugInput), 300);
    return () => clearTimeout(timer);
  }, [slugInput]);

  const slugCheck = useQuery(
    api.orgs.checkSlugAvailability,
    debouncedSlug.length >= 3 ? { slug: debouncedSlug } : "skip",
  );
  const slugChecking = slugInput.length >= 3 && (slugInput !== debouncedSlug || slugCheck === undefined);

  async function handleLogout() {
    clearOnboardingCache();
    await signOut();
    router.replace("/login");
  }

  async function handleNameNext() {
    setSubmitting(true);
    setError("");
    try {
      await updateProfile({
        companyName: orgName.trim(),
        companyWebsite: website.trim(),
      });
      if (viewerOrg?.org) {
        await updateOrg({
          name: orgName.trim(),
          website: website.trim() || undefined,
        });
      }
      setCurrentStep(1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSlugNext() {
    setSubmitting(true);
    setError("");
    try {
      if (!viewerOrg?.org) {
        await createBrokerOrg({
          name: orgName.trim(),
          website: website.trim() || undefined,
          slug: slugInput.trim(),
        });
      }
      setCurrentStep(2);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBrandingNext() {
    setSubmitting(true);
    setError("");
    try {
      await updateOrg({
        brandingColor: brandingColor || undefined,
        agentDisplayName: agentDisplayName.trim() || undefined,
      });
      setCurrentStep(3);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFinish() {
    setSubmitting(true);
    setError("");
    try {
      const handle = agentHandle.trim();
      if (handle && !viewerOrg?.org?.agentHandle) {
        await claimAgentHandle({ handle });
      }
      await completeOnboarding();
      setOnboardingComplete(true);
      router.push("/");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to finish");
      setSubmitting(false);
    }
  }

  const canContinueName = orgName.trim().length > 0;
  const canContinueSlug =
    debouncedSlug.length >= 3 && slugInput === debouncedSlug && slugCheck?.available === true;

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
                <label className={labelClass}>Brokerage name</label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Acme Insurance Brokers"
                  autoFocus
                  className={inputClass}
                />
              </div>
              <div className="space-y-2">
                <label className={labelClass}>Website (optional)</label>
                <input
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="acme-brokers.com"
                  className={inputClass}
                />
              </div>
            </div>

            {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}

            <PillButton
              type="button"
              onClick={handleNameNext}
              disabled={!canContinueName || submitting}
              className="w-full justify-center text-sm shadow-none sm:w-auto"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue
              {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
          </div>
        )}

        {currentStep === 1 && (
          <div className="space-y-10">
            <div className="space-y-2">
              <label className={labelClass}>Workspace link</label>
              <div className="flex items-stretch gap-0">
                <div className="flex items-center rounded-l-lg border border-r-0 border-foreground/8 bg-foreground/[0.02] px-3 py-2 text-label-sm text-muted-foreground/60 select-none whitespace-nowrap">
                  {WORKSPACE_DOMAIN}/
                </div>
                <input
                  type="text"
                  value={slugInput}
                  onChange={(e) =>
                    setSlugInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                  }
                  placeholder="acme-brokers"
                  autoFocus
                  className="flex-1 min-w-0 rounded-r-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                />
              </div>

              <div className="flex items-center gap-2 min-h-[20px] pt-1">
                {slugChecking ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                    <span className="text-label-sm text-muted-foreground">Checking...</span>
                  </>
                ) : null}
                {!slugChecking && debouncedSlug.length >= 3 && slugCheck?.available ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-body-sm text-emerald-600">
                      {WORKSPACE_DOMAIN}/{debouncedSlug} is available
                    </span>
                  </>
                ) : null}
                {!slugChecking && debouncedSlug.length >= 3 && slugCheck && !slugCheck.available ? (
                  <>
                    <X className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-body-sm text-red-500">
                      {slugCheck.reason ?? "Not available"}
                    </span>
                  </>
                ) : null}
                {slugInput.length > 0 && slugInput.length < 3 ? (
                  <span className="text-body-sm text-muted-foreground/50">
                    Minimum 3 characters
                  </span>
                ) : null}
              </div>
            </div>

            {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}

            <PillButton
              type="button"
              onClick={handleSlugNext}
              disabled={(!viewerOrg?.org && !canContinueSlug) || submitting}
              className="w-full justify-center text-sm shadow-none sm:w-auto"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue
              {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
          </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-10">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className={labelClass}>Agent display name</label>
                <input
                  type="text"
                  value={agentDisplayName}
                  onChange={(e) => setAgentDisplayName(e.target.value)}
                  placeholder="Acme Agent"
                  autoFocus
                  className={inputClass}
                />
              </div>
              <div className="space-y-2">
                <label className={labelClass}>Accent color</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={brandingColor}
                    onChange={(e) => setBrandingColor(e.target.value)}
                    className="h-10 w-12 cursor-pointer rounded-lg border border-foreground/8 bg-popover"
                  />
                  <span className="text-sm text-muted-foreground">{brandingColor}</span>
                </div>
              </div>
            </div>

            {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}

            <PillButton
              type="button"
              onClick={handleBrandingNext}
              disabled={submitting}
              className="w-full justify-center text-sm shadow-none sm:w-auto"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue
              {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
          </div>
        )}

        {currentStep === 3 && (
          <div className="space-y-10">
            <div className="space-y-2">
              <label className={labelClass}>Agent handle (optional)</label>
              <input
                type="text"
                value={agentHandle}
                onChange={(e) =>
                  setAgentHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                }
                placeholder="acme"
                autoFocus
                className={inputClass}
              />
              <p className="mt-2 text-sm text-muted-foreground">
                Clients will email this handle to reach your AI agent.
              </p>
            </div>

            {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}

            <PillButton
              type="button"
              onClick={handleFinish}
              disabled={submitting}
              className="w-full justify-center text-sm shadow-none sm:w-auto"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {submitting ? "Finishing…" : "Finish setup"}
            </PillButton>
          </div>
        )}
      </div>
    </Shell>
  );
}
