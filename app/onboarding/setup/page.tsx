"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useMutation, useQuery } from "convex/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { BrandWordmark, PartnerWordmark } from "@/components/auth-shell";
import { PolicyEmptyState } from "@/components/policy-empty-state";
import { PillButton } from "@/components/ui/pill-button";
import { LogoIcon } from "@/components/ui/logo-icon";
import { PhoneInput } from "@/components/ui/phone-input";
import { ArrowRight, Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

const AGENT_DOMAIN = process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "glass.claritylabs.inc";
const GLASS_IMESSAGE_NUMBER = process.env.NEXT_PUBLIC_GLASS_IMESSAGE_NUMBER ?? "";

function companyNameFromEmail(email?: string | null): string {
  if (!email) return "";
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return "";
  const root = domain.split(".")[0]?.replace(/[^a-z0-9-_ ]/gi, "").trim();
  if (!root) return "";
  return root
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join(" ")
    .slice(0, 80);
}

function websiteFromEmail(email?: string | null): string {
  if (!email) return "";
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain) return "";
  const free = new Set([
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
    "proton.me", "protonmail.com", "aol.com", "me.com", "live.com",
  ]);
  if (free.has(domain)) return "";
  return domain;
}

type Step = 0 | 1 | 2 | 3;

const STEPS: ReadonlyArray<{ label: string; subtitle?: string }> = [
  { label: "Welcome to Glass", subtitle: "Start by telling us a little about yourself." },
  { label: "Your organization", subtitle: "Confirm your company name and website." },
  { label: "Add your policies", subtitle: "Add policies so you can manage them, get answers and generate COIs." },
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
  broker?: {
    name?: string | null;
    iconUrl?: string | null;
    website?: string | null;
    whiteLabelingEnabled?: boolean;
  } | null;
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
              {broker?.whiteLabelingEnabled !== false && broker ? (
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
  const searchParams = useSearchParams();
  const { signOut } = useAuthActions();

  const viewer = useQuery(api.users.viewer);
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const updateProfile = useMutation(api.users.updateProfile);
  const updateOrg = useMutation(api.orgs.updateOrg);
  const createClientOrg = useMutation(api.orgs.createClientOrg);
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
  const [userPhone, setUserPhone] = useState("");
  const [orgName, setOrgName] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [stagedPolicies, setStagedPolicies] = useState<File[]>([]);
  const isVendorInvite = searchParams?.get("source") === "vendor-invite";
  const invitingClientName = searchParams?.get("client")?.trim() || "your client";

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
    queueMicrotask(() => {
      setUserName((v) => v || viewer.name || "");
      setUserRole((v) => v || viewer.title || "");
      setUserPhone((v) => v || viewer.phone || "");
    });
  }, [viewer]);

  useEffect(() => {
    const org = viewerOrg?.org;
    const email = viewer?.email;
    queueMicrotask(() => {
      setOrgName((v) => v || org?.name || companyNameFromEmail(email));
      setWebsite((v) => v || org?.website || websiteFromEmail(email));
    });
  }, [viewerOrg, viewer]);

  const brokerAgentHandle = viewerOrg?.brokerOrg?.agentHandle ?? viewerOrg?.org?.agentHandle;
  const brokerAgentEmail = brokerAgentHandle
    ? `${brokerAgentHandle}@${AGENT_DOMAIN}`
    : `agent@${AGENT_DOMAIN}`;

  const handleLogout = useCallback(async () => {
    await signOut();
    router.replace("/login");
  }, [signOut, router]);

  const handleStep0Next = useCallback(async () => {
    setSubmitting(true);
    setError("");
    try {
      await updateProfile({
        name: userName.trim(),
        title: userRole.trim(),
        phone: userPhone.trim() || undefined,
      });
      setCurrentStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }, [updateProfile, userName, userRole, userPhone]);

  const handleStep1Next = useCallback(async () => {
    setSubmitting(true);
    setError("");
    try {
      const trimmedName = orgName.trim();
      const trimmedSite = website.trim();
      if (viewerOrg?.org) {
        await updateOrg({
          name: trimmedName || undefined,
          website: trimmedSite || undefined,
        });
      } else {
        await createClientOrg({
          name: trimmedName,
          website: trimmedSite || undefined,
        });
      }
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
  }, [updateOrg, createClientOrg, viewerOrg, orgName, website, extractCompanyInfo]);

  const handleFilesUpload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return false;
      setUploading(true);
      try {
        const storageIds: string[] = [];
        for (let i = 0; i < files.length; i++) {
          const uploadUrl = await generateUploadUrl();
          const res = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": "application/pdf" },
            body: files[i],
          });
          if (!res.ok) throw new Error("Upload failed");
          const { storageId } = (await res.json()) as { storageId: string };
          storageIds.push(storageId);
        }

        await extractFromUpload({
          fileId: storageIds[0] as never,
          fileName: files[0].name,
          additionalFiles: storageIds.slice(1).map((fileId, i) => ({
            fileId: fileId as never,
            fileName: files[i + 1].name,
          })),
        });

        toast.success(
          files.length > 1
            ? `${files.length} files uploaded and merged — extraction runs in the background.`
            : "Upload started — extraction runs in the background.",
        );
        return true;
      } catch (err) {
        console.error(err);
        toast.error("Upload failed. Please try again.");
        return false;
      } finally {
        setUploading(false);
      }
    },
    [generateUploadUrl, extractFromUpload],
  );

  const handleStep2Continue = useCallback(async () => {
    if (stagedPolicies.length > 0) {
      const ok = await handleFilesUpload(stagedPolicies);
      if (!ok) return;
      setStagedPolicies([]);
    }
    setCurrentStep(3);
  }, [stagedPolicies, handleFilesUpload]);

  const handleFinish = useCallback(async () => {
    setSubmitting(true);
    setError("");
    try {
      await completeOnboarding();
      router.replace(isVendorInvite ? "/connect/clients" : "/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to finish");
      setSubmitting(false);
    }
  }, [completeOnboarding, isVendorInvite, router]);

  const canContinueStep0 = userName.trim().length > 0 && userRole.trim().length > 0;
  const canContinueStep1 = orgName.trim().length > 0;

  const policyCount = policies?.length ?? 0;
  const stepContent = isVendorInvite
    ? ([
        {
          label: "Set up your vendor account",
          subtitle: `${invitingClientName} invited you to share insurance records and verify your coverage.`,
        },
        {
          label: "Your organization",
          subtitle: "Confirm the company that will share insurance records with this client.",
        },
        {
          label: "Add insurance documents",
          subtitle: "Upload policies or certificates your client can use to review their vendor requirements.",
        },
        {
          label: "You're connected",
          subtitle: "Your client can now review the insurance records you choose to keep in Glass.",
        },
      ] satisfies ReadonlyArray<{ label: string; subtitle?: string }>)
    : STEPS;

  return (
    <Shell currentStep={currentStep} email={viewer?.email} onLogout={handleLogout} broker={viewerOrg?.brokerOrg ?? null}>
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-3 text-left">
          <h1 className="text-base font-medium tracking-tight">
            {currentStep === 0 &&
            viewerOrg?.brokerOrg?.whiteLabelingEnabled !== false &&
            viewerOrg?.brokerOrg?.name &&
            !isVendorInvite
              ? `Welcome to ${viewerOrg.brokerOrg.name}`
              : stepContent[currentStep].label}
          </h1>
          {stepContent[currentStep].subtitle ? (
            <p className="text-base text-muted-foreground">{stepContent[currentStep].subtitle}</p>
          ) : null}
        </div>

        {currentStep === 0 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!canContinueStep0 || submitting) return;
              void handleStep0Next();
            }}
            className="space-y-10"
          >
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
              <div className="space-y-2">
                <label className={labelClass}>Mobile number (optional)</label>
                <PhoneInput
                  value={userPhone || undefined}
                  onChange={(value) => setUserPhone(value ?? "")}
                  defaultCountry="US"
                  placeholder="Enter phone number"
                />
                <p className="text-label-sm text-muted-foreground/70">
                  Used for iMessage access to your Glass agent.
                </p>
              </div>
            </div>

            {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}

            <PillButton
              type="submit"
              disabled={!canContinueStep0 || submitting}
              className="w-full justify-center text-sm shadow-none sm:w-auto"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue
              {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
          </form>
        )}

        {currentStep === 1 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!canContinueStep1 || submitting) return;
              void handleStep1Next();
            }}
            className="space-y-10"
          >
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
                  We&apos;ll use this to enrich your company profile automatically.
                </p>
              </div>
            </div>

            {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}

            <PillButton
              type="submit"
              disabled={!canContinueStep1 || submitting}
              className="w-full justify-center text-sm shadow-none sm:w-auto"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue
              {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
          </form>
        )}

        {currentStep === 2 && (
          <div className="space-y-8">
            {policyCount > 0 ? (
              <div className="rounded-lg border border-foreground/6 bg-card p-5 sm:p-6 flex items-start gap-3">
                <div className="mt-0.5 h-8 w-8 rounded-full bg-foreground/[0.04] flex items-center justify-center shrink-0">
                  <Check className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-body-sm font-semibold text-foreground">
                    {policyCount === 1
                      ? "1 policy uploaded"
                      : `${policyCount} policies uploaded`}
                  </div>
                  <div className="text-body-sm text-muted-foreground mt-0.5">
                    We&apos;re extracting the details in the background — you can move on.
                  </div>
                </div>
              </div>
            ) : (
              <PolicyEmptyState
                docType="policy"
                agentEmail={brokerAgentEmail}
                uploading={uploading}
                onUpload={handleFilesUpload}
                title=""
                subtitle=""
                bare
                staged={stagedPolicies}
                onStagedChange={setStagedPolicies}
                hideUploadButton
              />
            )}

            {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between -mt-4">
              <button
                type="button"
                onClick={() => setCurrentStep(3)}
                disabled={uploading}
                className="text-label-sm text-muted-foreground hover:text-foreground transition self-start sm:self-center disabled:opacity-50"
              >
                Skip for now
              </button>
              <PillButton
                type="button"
                onClick={() => void handleStep2Continue()}
                disabled={
                  uploading ||
                  (policyCount === 0 && stagedPolicies.length === 0)
                }
                className="w-full justify-center text-sm shadow-none sm:w-auto"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Continue
                {!uploading ? <ArrowRight className="h-4 w-4" /> : null}
              </PillButton>
            </div>
          </div>
        )}

        {currentStep === 3 && (
          <div className="space-y-10">
            <ol className="list-none space-y-4 text-base text-muted-foreground [&>li]:flex [&>li]:gap-4">
              {(isVendorInvite
                ? [
                    `Share policies and certificates with ${invitingClientName}.`,
                    "Keep your insurance records current for vendor compliance reviews.",
                    "Generate certificates of insurance when clients need proof of coverage.",
                  ]
                : [
                    "See all of your policies, organized, in one place.",
                    "Get proactive alerts about expiring policies and renewals.",
                    "Generate certificates of insurance for customers, vendors and investors.",
                  ]
              ).map((item, index) => (
                <li key={item}>
                  <span className="shrink-0 tabular-nums text-foreground/30">
                    {index + 1}.
                  </span>
                  <span>{item}</span>
                </li>
              ))}
              <li>
                <span className="shrink-0 tabular-nums text-foreground/30">4.</span>
                <span>
                  Email{" "}
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(brokerAgentEmail)
                        .then(() => toast.success("Copied to clipboard"))
                        .catch(() => toast.error("Couldn't copy"));
                    }}
                    className="mx-1 inline-flex items-center gap-1 font-medium text-foreground underline decoration-foreground/20 underline-offset-4 hover:decoration-foreground/50 transition-colors"
                  >
                    {brokerAgentEmail}
                    <Copy className="h-3.5 w-3.5" />
                  </button>{" "}
                  to get instant answers about your insurance coverage.
                </span>
              </li>
              {GLASS_IMESSAGE_NUMBER ? (
                <li>
                  <span className="shrink-0 tabular-nums text-foreground/30">5.</span>
                  <span>
                    Or text{" "}
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(GLASS_IMESSAGE_NUMBER)
                          .then(() => toast.success("Copied to clipboard"))
                          .catch(() => toast.error("Couldn't copy"));
                      }}
                      className="mx-1 inline-flex items-center gap-1 font-medium text-foreground underline decoration-foreground/20 underline-offset-4 hover:decoration-foreground/50 transition-colors"
                    >
                      {GLASS_IMESSAGE_NUMBER}
                      <Copy className="h-3.5 w-3.5" />
                    </button>{" "}
                    via iMessage to ask questions from your phone.
                  </span>
                </li>
              ) : null}
            </ol>

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
