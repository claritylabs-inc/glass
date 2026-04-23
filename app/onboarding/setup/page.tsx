"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useMutation, useQuery } from "convex/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { BrandWordmark, PartnerWordmark } from "@/components/auth-shell";
import { PolicyEmptyState } from "@/components/policy-empty-state";
import { PillButton } from "@/components/ui/pill-button";
import { LogoIcon } from "@/components/ui/logo-icon";
import { ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

const AGENT_DOMAIN = process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "glass.claritylabs.inc";

type Step = 0 | 1 | 2 | 3;

const STEPS: ReadonlyArray<{ label: string; subtitle?: string }> = [
  { label: "Welcome to Glass", subtitle: "Start by telling us a little about yourself." },
  { label: "Your organization", subtitle: "Confirm your company name and website." },
  { label: "Your policies", subtitle: "Add policies so you can manage them, get answers and generate COIs." },
  { label: "You're all set", subtitle: "Here's what you can do next." },
] as const;

const inputClass =
  "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

const labelClass = "text-label-sm font-medium text-muted-foreground block mb-1.5";

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
  broker,
}: {
  children: ReactNode;
  currentStep?: Step;
  email?: string;
  onLogout?: () => Promise<void> | void;
  broker?: { name?: string | null; iconUrl?: string | null; website?: string | null } | null;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 w-full bg-background px-6 py-6 sm:px-8">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-sm text-muted-foreground">
          <div className="justify-self-start min-w-0">
            <div className="sm:hidden">
              <LogoIcon size={18} color="#A0D2FA" static />
            </div>
            <div className="hidden sm:block">
              {broker ? (
                <PartnerWordmark name={broker.name} iconUrl={broker.iconUrl} website={broker.website} />
              ) : (
                <BrandWordmark />
              )}
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

type PolicyRow = {
  _id: string;
  carrier?: string | null;
  policyNumber?: string | null;
  documentType?: string;
  pipelineStatus?: string;
  uploadedBySide?: string;
};

export default function ClientOnboardingSetupPage() {
  const router = useRouter();
  const { signOut } = useAuthActions();

  const viewer = useQuery(api.users.viewer);
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const updateProfile = useMutation(api.users.updateProfile);
  const updateOrg = useMutation(api.orgs.updateOrg);
  const completeOnboarding = useMutation(api.users.completeOnboarding);
  const generateUploadUrl = useMutation(api.policies.generateUploadUrl);
  const extractFromUpload = useAction(api.actions.extractFromUpload.extractFromUpload);
  const extractCompanyInfo = useAction(api.actions.extractCompanyInfo.extractCompanyInfo);

  const policies = useQuery(api.policies.listForClient, { documentType: "policy" }) as
    | PolicyRow[]
    | undefined;

  const [currentStep, setCurrentStep] = useState<Step>(0);
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState("");
  const [orgName, setOrgName] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  // If already complete, bounce home.
  useEffect(() => {
    if (viewer?.onboardingComplete) router.replace("/");
  }, [viewer, router]);

  // If somehow this is a broker, redirect.
  useEffect(() => {
    const type = (viewerOrg?.org as { type?: "broker" | "client" } | undefined)?.type;
    if (type === "broker") router.replace("/onboarding/broker");
  }, [viewerOrg, router]);

  // Hydrate inputs from server data.
  useEffect(() => {
    if (!viewer) return;
    setUserName((v) => v || viewer.name || "");
    setUserRole((v) => v || viewer.title || "");
  }, [viewer]);

  useEffect(() => {
    const org = viewerOrg?.org;
    if (!org) return;
    setOrgName((v) => v || org.name || "");
    setWebsite((v) => v || org.website || "");
  }, [viewerOrg]);

  const brokerAgentHandle = viewerOrg?.brokerOrg?.agentHandle ?? viewerOrg?.org?.agentHandle;
  const brokerAgentEmail = brokerAgentHandle ? `${brokerAgentHandle}@${AGENT_DOMAIN}` : null;

  const handleLogout = useCallback(async () => {
    await signOut();
    router.replace("/login");
  }, [signOut, router]);

  const handleStep0Next = useCallback(async () => {
    setSubmitting(true);
    setError("");
    try {
      await updateProfile({ name: userName.trim(), title: userRole.trim() });
      setCurrentStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }, [updateProfile, userName, userRole]);

  const handleStep1Next = useCallback(async () => {
    setSubmitting(true);
    setError("");
    try {
      const trimmedName = orgName.trim();
      const trimmedSite = website.trim();
      await updateOrg({
        name: trimmedName || undefined,
        website: trimmedSite || undefined,
      });
      if (trimmedSite) {
        const enrichToast = toast.loading("Enriching your profile from your website…");
        void extractCompanyInfo({ url: trimmedSite })
          .then(() => toast.success("Profile enriched from your website.", { id: enrichToast }))
          .catch(() => toast.dismiss(enrichToast));
      }
      setCurrentStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }, [updateOrg, orgName, website, extractCompanyInfo]);

  const handleFilesUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      try {
        for (const file of files) {
          const uploadUrl = await generateUploadUrl();
          const res = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": "application/pdf" },
            body: file,
          });
          if (!res.ok) throw new Error("Upload failed");
          const { storageId } = (await res.json()) as { storageId: string };
          await extractFromUpload({
            fileId: storageId as never,
            fileName: file.name,
          });
        }
        toast.success(
          files.length > 1
            ? `${files.length} uploads started — extraction runs in the background.`
            : "Upload started — extraction runs in the background.",
        );
      } catch (err) {
        console.error(err);
        toast.error("Upload failed. Please try again.");
      } finally {
        setUploading(false);
      }
    },
    [generateUploadUrl, extractFromUpload],
  );

  const handleFinish = useCallback(async () => {
    setSubmitting(true);
    setError("");
    try {
      await completeOnboarding();
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to finish");
      setSubmitting(false);
    }
  }, [completeOnboarding, router]);

  const canContinueStep0 = userName.trim().length > 0 && userRole.trim().length > 0;
  const canContinueStep1 = orgName.trim().length > 0;

  const policyCount = policies?.length ?? 0;

  return (
    <Shell currentStep={currentStep} email={viewer?.email} onLogout={handleLogout} broker={viewerOrg?.brokerOrg ?? null}>
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-3 text-left">
          <h1 className="text-base font-medium tracking-tight">
            {currentStep === 0 && viewerOrg?.brokerOrg?.name
              ? `Welcome to ${viewerOrg.brokerOrg.name}`
              : STEPS[currentStep].label}
          </h1>
          {STEPS[currentStep].subtitle ? (
            <p className="text-base text-muted-foreground">{STEPS[currentStep].subtitle}</p>
          ) : null}
        </div>

        {currentStep === 0 && (
          <div className="space-y-10">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className={labelClass}>Your name</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Jane Smith"
                  autoFocus
                  className={inputClass}
                />
              </div>
              <div className="space-y-2">
                <label className={labelClass}>Your role</label>
                <input
                  type="text"
                  value={userRole}
                  onChange={(e) => setUserRole(e.target.value)}
                  placeholder="Founder, Ops Lead, etc."
                  className={inputClass}
                />
              </div>
            </div>

            {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}

            <PillButton
              type="button"
              onClick={handleStep0Next}
              disabled={!canContinueStep0 || submitting}
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
            <div className="space-y-4">
              <div className="space-y-2">
                <label className={labelClass}>Organization name</label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Acme Inc."
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
                  placeholder="acme.com"
                  className={inputClass}
                />
                <p className="text-label-sm text-muted-foreground/70">
                  We'll use this to enrich your company profile automatically.
                </p>
              </div>
            </div>

            {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}

            <PillButton
              type="button"
              onClick={handleStep1Next}
              disabled={!canContinueStep1 || submitting}
              className="w-full justify-center text-sm shadow-none sm:w-auto"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue
              {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
          </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-8">
            {policyCount > 0 ? (
              <div className="space-y-3">
                <div className={labelClass + " mb-0"}>
                  Policies on file
                  <span className="ml-1.5 text-muted-foreground/60">({policyCount})</span>
                </div>
                <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
                  {(policies ?? []).map((p) => (
                    <div
                      key={p._id}
                      className="flex items-center justify-between px-4 py-3 border-t border-foreground/4 first:border-t-0"
                    >
                      <div className="min-w-0">
                        <div className="text-body-sm font-medium truncate">
                          {p.carrier || "Untitled policy"}
                        </div>
                        {p.policyNumber ? (
                          <div className="text-body-sm text-muted-foreground truncate">
                            {p.policyNumber}
                          </div>
                        ) : null}
                      </div>
                      {p.pipelineStatus && p.pipelineStatus !== "ready" ? (
                        <span className="text-body-sm text-muted-foreground/70 ml-3 shrink-0">
                          Processing…
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <PolicyEmptyState
              docType="policy"
              agentEmail={brokerAgentEmail}
              uploading={uploading}
              onUpload={handleFilesUpload}
              title={policyCount > 0 ? "Add a policy" : "Add your first policy"}
              subtitle="Drop a PDF or forward an email — Glass extracts it for you."
            />

            {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => setCurrentStep(3)}
                className="text-label-sm text-muted-foreground hover:text-foreground transition self-start"
              >
                Skip for now
              </button>
              <PillButton
                type="button"
                onClick={() => setCurrentStep(3)}
                className="w-full justify-center text-sm shadow-none sm:w-auto"
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </PillButton>
            </div>
          </div>
        )}

        {currentStep === 3 && (
          <div className="space-y-10">
            <div className="space-y-4 text-body-sm text-muted-foreground leading-relaxed">
              <p>
                <span className="text-foreground font-medium">Glass is your system of record</span>{" "}
                for insurance data.
              </p>
              <p>
                Ask questions about your policies and coverage over chat or by emailing your
                agent. Generate certificates of insurance in seconds. Everything stays in one
                place, always up to date.
              </p>
            </div>

            <a
              href="/settings?section=connections"
              className="block rounded-lg border border-foreground/8 bg-card p-4 hover:bg-foreground/[0.02] transition-colors"
            >
              <div className="flex items-start gap-3">
                <Sparkles className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-body-sm font-medium">Connect ChatGPT or Claude via MCP</div>
                  <div className="text-label-sm text-muted-foreground">
                    Query your policies directly from your favorite AI assistant.
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              </div>
            </a>

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
