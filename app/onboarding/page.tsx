"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { FadeIn } from "@/components/ui/fade-in";
import { LogoIcon } from "@/components/ui/logo-icon";
import { PillButton } from "@/components/ui/pill-button";
import { ConnectionForm } from "@/components/connection-form";
import {
  Loader2,
  ArrowRight,
  ArrowLeft,
  Globe,
  Sparkles,
  Mail,
  Database,
  Search,
  LayoutDashboard,
  Brain,
  Check,
} from "lucide-react";

export default function OnboardingPage() {
  const router = useRouter();
  const viewer = useQuery(api.users.viewer);
  const connections = useQuery(api.connections.list);
  const updateProfile = useMutation(api.users.updateProfile);
  const completeOnboarding = useMutation(api.users.completeOnboarding);
  const seedData = useMutation(api.seed.seed);
  const extractCompanyInfo = useAction(api.actions.extractCompanyInfo.extractCompanyInfo);

  const [currentStep, setCurrentStep] = useState(0);

  // Step 1 state
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [companyContext, setCompanyContext] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  // Step 2 state
  const [connectionFormOpen, setConnectionFormOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Step 3 state
  const [finishing, setFinishing] = useState(false);

  // Auto-resize textarea
  const contextRef = useRef<HTMLTextAreaElement>(null);
  const autoResize = useCallback(() => {
    const el = contextRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, []);

  // Pre-fill from viewer
  useEffect(() => {
    if (viewer) {
      setName(viewer.name ?? "");
      setCompanyName(viewer.companyName ?? "");
      setCompanyWebsite(viewer.companyWebsite ?? "");
      setCompanyContext(viewer.companyContext ?? "");
    }
  }, [viewer]);

  useEffect(() => { autoResize(); }, [companyContext, autoResize]);

  const hasConnection = (connections?.length ?? 0) > 0;

  async function handleExtract() {
    if (!companyWebsite) return;
    setExtracting(true);
    try {
      // Save current form fields first so the viewer re-fetch doesn't wipe them
      const updates: Record<string, string> = {};
      if (name) updates.name = name;
      if (companyName) updates.companyName = companyName;
      if (companyWebsite) updates.companyWebsite = companyWebsite;
      if (companyContext) updates.companyContext = companyContext;
      await updateProfile(updates);

      let url = companyWebsite;
      if (!url.startsWith("http")) url = "https://" + url;
      const result = await extractCompanyInfo({ url });
      if (result.companyContext) {
        setCompanyContext(result.companyContext);
      }
    } finally {
      setExtracting(false);
    }
  }

  async function handleStep1Next() {
    setSavingProfile(true);
    try {
      const updates: Record<string, string> = {};
      if (name) updates.name = name;
      if (companyName) updates.companyName = companyName;
      if (companyWebsite) updates.companyWebsite = companyWebsite;
      if (companyContext) updates.companyContext = companyContext;
      await updateProfile(updates);
      setCurrentStep(1);
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSeedDemo() {
    setSeeding(true);
    try {
      await seedData();
      setSeeded(true);
    } finally {
      setSeeding(false);
    }
  }

  async function handleFinish() {
    setFinishing(true);
    try {
      await completeOnboarding();
      router.replace("/");
    } catch {
      setFinishing(false);
    }
  }

  if (viewer === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const steps = [
    { label: "Details" },
    { label: "Data" },
    { label: "Ready" },
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <FadeIn className="w-full max-w-lg">
        <div className="bg-white rounded-xl border border-foreground/8 p-6 sm:p-8">
          {/* Header */}
          <div className="text-center mb-6">
            <h3 className="!mb-0 flex items-center justify-center gap-1.5">
              Clarity <LogoIcon size={22} className="shrink-0" /> Labs
            </h3>
            <p className="text-body-sm text-muted-foreground mt-2">
              Let&apos;s get you set up
            </p>
          </div>

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mb-8">
            {steps.map((s, i) => (
              <div key={s.label} className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i <= currentStep ? "bg-foreground" : "bg-foreground/15"
                  }`}
                />
                {i < steps.length - 1 && (
                  <div className={`w-8 h-px transition-colors ${
                    i < currentStep ? "bg-foreground/30" : "bg-foreground/10"
                  }`} />
                )}
              </div>
            ))}
          </div>

          {/* Step 1: Your Details */}
          {currentStep === 0 && (
            <div className="space-y-4">
              <div>
                <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                  Your Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Smith"
                  autoFocus
                  className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                />
              </div>

              <div>
                <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                  Company Name
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Insurance Brokerage"
                  className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                />
              </div>

              <div>
                <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                  Company Website
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
                    <input
                      type="text"
                      value={companyWebsite}
                      onChange={(e) => setCompanyWebsite(e.target.value)}
                      placeholder="https://yourcompany.com"
                      className="w-full rounded-lg border border-foreground/8 bg-white pl-8.5 pr-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleExtract}
                    disabled={extracting || !companyWebsite}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-foreground/8 bg-white text-label-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/15 hover:bg-foreground/[0.02] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  >
                    {extracting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span className="hidden sm:inline">{extracting ? "Extracting..." : "Extract Info"}</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                  Company Context
                </label>
                <textarea
                  ref={contextRef}
                  value={companyContext}
                  onChange={(e) => setCompanyContext(e.target.value)}
                  onInput={autoResize}
                  placeholder="Brief description of your company, industry, and insurance needs..."
                  rows={3}
                  className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors resize-none overflow-hidden"
                />
                <p className="text-label-sm text-muted-foreground/50 mt-1">
                  Used to provide context to the AI during policy extraction
                </p>
              </div>

              <div className="pt-2">
                <PillButton
                  onClick={handleStep1Next}
                  disabled={savingProfile}
                  className="w-full"
                >
                  {savingProfile ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      Next
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </PillButton>
              </div>
            </div>
          )}

          {/* Step 2: Link Your Data */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div className="text-center mb-2">
                <h4 className="!mb-1 text-base font-semibold">Link Your Data</h4>
                <p className="text-label-sm text-muted-foreground/60">
                  Connect an email account or try with demo data
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Connect Email card */}
                <button
                  type="button"
                  onClick={() => setConnectionFormOpen(true)}
                  className={`flex flex-col items-center gap-3 p-5 rounded-lg border transition-all cursor-pointer ${
                    hasConnection
                      ? "border-foreground/20 bg-foreground/[0.02]"
                      : "border-foreground/8 hover:border-foreground/15 hover:bg-foreground/[0.02]"
                  }`}
                >
                  {hasConnection ? (
                    <div className="w-10 h-10 rounded-full bg-foreground/5 flex items-center justify-center">
                      <Check className="w-5 h-5 text-foreground" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-foreground/5 flex items-center justify-center">
                      <Mail className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="text-center">
                    <p className="text-body-sm font-medium">
                      {hasConnection ? "Email Connected" : "Connect Email"}
                    </p>
                    <p className="text-label-sm text-muted-foreground/50 mt-0.5">
                      {hasConnection ? "Add another or continue" : "Scan for insurance policies"}
                    </p>
                  </div>
                </button>

                {/* Demo Data card */}
                <button
                  type="button"
                  onClick={handleSeedDemo}
                  disabled={seeding || seeded}
                  className={`flex flex-col items-center gap-3 p-5 rounded-lg border transition-all cursor-pointer disabled:cursor-not-allowed ${
                    seeded
                      ? "border-foreground/20 bg-foreground/[0.02]"
                      : "border-foreground/8 hover:border-foreground/15 hover:bg-foreground/[0.02]"
                  }`}
                >
                  {seeded ? (
                    <div className="w-10 h-10 rounded-full bg-foreground/5 flex items-center justify-center">
                      <Check className="w-5 h-5 text-foreground" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-foreground/5 flex items-center justify-center">
                      {seeding ? (
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      ) : (
                        <Database className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                  )}
                  <div className="text-center">
                    <p className="text-body-sm font-medium">
                      {seeded ? "Demo Data Loaded" : "Try Demo Data"}
                    </p>
                    <p className="text-label-sm text-muted-foreground/50 mt-0.5">
                      {seeded ? "Sample policies ready" : "Load sample policies"}
                    </p>
                  </div>
                </button>
              </div>

              <div className="flex items-center justify-between pt-2">
                <PillButton
                  variant="secondary"
                  onClick={() => setCurrentStep(0)}
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </PillButton>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setCurrentStep(2)}
                    className="text-label-sm text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
                  >
                    Skip for now
                  </button>
                  <PillButton
                    onClick={() => setCurrentStep(2)}
                    disabled={!hasConnection && !seeded}
                  >
                    Next
                    <ArrowRight className="w-3.5 h-3.5" />
                  </PillButton>
                </div>
              </div>

            </div>
          )}

          {/* Step 3: How It Works */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <div className="text-center mb-2">
                <h4 className="!mb-1 text-base font-semibold">How It Works</h4>
                <p className="text-label-sm text-muted-foreground/60">
                  Here&apos;s what you can do with Clarity Labs
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex gap-3 p-4 rounded-lg border border-foreground/6 bg-foreground/[0.01]">
                  <div className="w-9 h-9 rounded-lg bg-foreground/5 flex items-center justify-center shrink-0">
                    <Search className="w-4.5 h-4.5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-body-sm font-medium">Scan & Extract</p>
                    <p className="text-label-sm text-muted-foreground/60 mt-0.5">
                      Automatically find insurance emails and extract policy data from PDF attachments
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 p-4 rounded-lg border border-foreground/6 bg-foreground/[0.01]">
                  <div className="w-9 h-9 rounded-lg bg-foreground/5 flex items-center justify-center shrink-0">
                    <LayoutDashboard className="w-4.5 h-4.5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-body-sm font-medium">Policy Dashboard</p>
                    <p className="text-label-sm text-muted-foreground/60 mt-0.5">
                      Filter and organize policies by type, carrier, and year
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 p-4 rounded-lg border border-foreground/6 bg-foreground/[0.01]">
                  <div className="w-9 h-9 rounded-lg bg-foreground/5 flex items-center justify-center shrink-0">
                    <Brain className="w-4.5 h-4.5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-body-sm font-medium">AI-Powered Analysis</p>
                    <p className="text-label-sm text-muted-foreground/60 mt-0.5">
                      Extracts coverages, limits, deductibles, and document structure
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <PillButton
                  variant="secondary"
                  onClick={() => setCurrentStep(1)}
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </PillButton>
                <PillButton
                  onClick={handleFinish}
                  disabled={finishing}
                >
                  {finishing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Getting started...
                    </>
                  ) : (
                    <>
                      Get Started
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </PillButton>
              </div>
            </div>
          )}
        </div>
      </FadeIn>

      <ConnectionForm
        open={connectionFormOpen}
        onClose={() => setConnectionFormOpen(false)}
      />
    </div>
  );
}
