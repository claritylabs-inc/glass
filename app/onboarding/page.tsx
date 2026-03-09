"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  FileText,
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

          {/* Step 3: How It Works — Animated Demo */}
          {currentStep === 2 && (
            <HowItWorksDemo
              onBack={() => setCurrentStep(1)}
              onFinish={handleFinish}
              finishing={finishing}
            />
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

/* ═══════════════════════════════════════════════════════════════════════
   How It Works — Animated accordion demo (adapted from claire-demo)
   ═══════════════════════════════════════════════════════════════════════ */

type DemoPhase = "scanning" | "extracting" | "analyzing" | "ready";

const DEMO_EMAILS = [
  { subject: "GL Policy Renewal Notice", from: "renewals@hartford.com" },
  { subject: "Your Commercial Auto Policy Docs", from: "service@progressive.com" },
  { subject: "Workers' Comp Certificate Attached", from: "certs@employers.com" },
  { subject: "Commercial Property — Annual Renewal", from: "agent@travelers.com" },
];

const DEMO_POLICIES = [
  { type: "General Liability", carrier: "Hartford", number: "CGL-2026-88412" },
  { type: "Commercial Auto", carrier: "Progressive", number: "CA-7731920" },
  { type: "Workers' Compensation", carrier: "EMPLOYERS", number: "WC-2026-04517" },
  { type: "Commercial Property", carrier: "Travelers", number: "CPP-663291" },
];

const DEMO_STATUS = [
  { id: "policies", label: "4 policies extracted" },
  { id: "coverages", label: "12 coverages identified" },
  { id: "dates", label: "Effective dates & limits mapped" },
  { id: "ready", label: "Ready to explore" },
];

const PHASE_DESCRIPTIONS: Record<DemoPhase, string> = {
  scanning: "Connecting to your inbox and scanning for insurance emails.",
  extracting: "Downloading attachments and extracting policy data with AI.",
  analyzing: "Organizing coverages, limits, and key dates.",
  ready: "Your policies are organized and ready to explore.",
};

function getActiveBucket(phase: DemoPhase): number {
  if (phase === "scanning") return 0;
  if (phase === "extracting") return 1;
  return 2;
}

const ease = [0.16, 1, 0.3, 1] as const;

function ThinkingDots() {
  return (
    <span className="inline-flex gap-0.5 ml-1 align-middle">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-1 h-1 rounded-full bg-foreground/40"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}

function CollapsedStep({ stepNumber, label, summary }: { stepNumber: number; label: string; summary: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.35, ease }}
      className="overflow-hidden"
    >
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-foreground/6 bg-foreground/[0.02] mb-2">
        <span className="w-5 h-5 rounded-full bg-foreground/8 text-muted-foreground text-[10px] font-bold flex items-center justify-center shrink-0">
          {stepNumber}
        </span>
        <span className="text-label-sm font-medium text-foreground/70">{label}</span>
        <span className="text-label-sm text-muted-foreground/50 ml-auto">{summary}</span>
        <Check className="w-3 h-3 shrink-0 text-foreground/40" />
      </div>
    </motion.div>
  );
}

function StepLabel({ stepNumber, label }: { stepNumber: number; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3 shrink-0">
      <span className="w-5 h-5 rounded-full bg-foreground text-white text-[10px] font-bold flex items-center justify-center shrink-0">
        {stepNumber}
      </span>
      <span className="text-label-sm font-medium text-foreground/70">
        {label}
      </span>
    </div>
  );
}

/** Gentle fade for list items — no vertical shift or blur like FadeIn */
function ItemFade({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay, ease }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function HowItWorksDemo({
  onBack,
  onFinish,
  finishing,
}: {
  onBack: () => void;
  onFinish: () => void;
  finishing: boolean;
}) {
  const [cycle, setCycle] = useState(0);
  const [phase, setPhase] = useState<DemoPhase>("scanning");
  const [scannedEmails, setScannedEmails] = useState<number[]>([]);
  const [extractedPolicies, setExtractedPolicies] = useState<number[]>([]);
  const [statusItems, setStatusItems] = useState<typeof DEMO_STATUS>([]);
  const [emailCount, setEmailCount] = useState(0);

  const activeBucket = getActiveBucket(phase);

  // Animation timeline — resets and replays on each cycle
  useEffect(() => {
    setPhase("scanning");
    setScannedEmails([]);
    setExtractedPolicies([]);
    setStatusItems([]);
    setEmailCount(0);

    const timers: ReturnType<typeof setTimeout>[] = [];

    // Phase 1: Scanning (0–3.6s)
    const countDuration = 2400;
    const countSteps = 30;
    const countInterval = countDuration / countSteps;
    for (let i = 1; i <= countSteps; i++) {
      timers.push(setTimeout(() => setEmailCount(Math.round((i / countSteps) * 5237)), i * countInterval));
    }
    DEMO_EMAILS.forEach((_, i) => {
      timers.push(setTimeout(() => setScannedEmails((prev) => [...prev, i]), 600 + i * 600));
    });

    // Phase 2: Extracting (3.6s–7s)
    timers.push(setTimeout(() => setPhase("extracting"), 3600));
    DEMO_POLICIES.forEach((_, i) => {
      timers.push(setTimeout(() => setExtractedPolicies((prev) => [...prev, i]), 4000 + i * 650));
    });

    // Phase 3: Analyzing (7s–10s)
    timers.push(setTimeout(() => setPhase("analyzing"), 7000));
    DEMO_STATUS.forEach((item, i) => {
      timers.push(setTimeout(() => setStatusItems((prev) => [...prev, item]), 7400 + i * 750));
    });

    // Phase 4: Ready (10s), loop after 6s pause
    timers.push(setTimeout(() => setPhase("ready"), 10200));
    timers.push(setTimeout(() => setCycle((c) => c + 1), 16200));

    return () => timers.forEach(clearTimeout);
  }, [cycle]);

  return (
    <div className="space-y-4">
      {/* Contextual description that crossfades between phases */}
      <div className="h-10 flex items-center justify-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={phase}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease }}
            className="text-body-sm text-muted-foreground/70 text-center"
          >
            {PHASE_DESCRIPTIONS[phase]}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* Fixed-height accordion area — prevents layout shift */}
      <div className="relative h-80">
        {/* Collapsed steps stack at the top */}
        <div className="flex flex-col">
          <AnimatePresence>
            {activeBucket > 0 && (
              <CollapsedStep stepNumber={1} label="Find Emails" summary={`4 insurance emails found`} />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {activeBucket > 1 && (
              <CollapsedStep stepNumber={2} label="Extract Data" summary={`${extractedPolicies.length} policies`} />
            )}
          </AnimatePresence>
        </div>

        {/* Active bucket — crossfade in place */}
        <AnimatePresence mode="wait">
          {activeBucket === 0 && (
            <motion.div
              key="scan"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
              className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4"
            >
              <StepLabel stepNumber={1} label="Find Emails" />
              <div className="flex flex-col">
                {DEMO_EMAILS.map((email, idx) => {
                  const revealed = scannedEmails.includes(idx);
                  const isFirst = scannedEmails[0] === idx;
                  return (
                    <div key={idx} className={`flex items-center gap-2 py-2 h-[42px] ${revealed && !isFirst ? "border-t border-foreground/6" : ""}`}>
                      {revealed ? (
                        <ItemFade className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="w-5 flex justify-center shrink-0">
                            {phase === "scanning" && idx === scannedEmails[scannedEmails.length - 1] ? (
                              <motion.span
                                className="text-foreground/30"
                                animate={{ opacity: [1, 0.3, 1] }}
                                transition={{ duration: 0.8, repeat: Infinity }}
                              >
                                <Mail className="w-3.5 h-3.5" />
                              </motion.span>
                            ) : (
                              <Mail className="w-3.5 h-3.5 text-foreground/30" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-label-sm text-foreground truncate">{email.subject}</p>
                            <p className="text-[11px] text-muted-foreground/50 font-mono truncate">{email.from}</p>
                          </div>
                        </ItemFade>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {activeBucket === 1 && (
            <motion.div
              key="extract"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
              className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4"
            >
              <StepLabel stepNumber={2} label="Extract Data" />
              <div className="flex flex-col">
                {DEMO_POLICIES.map((policy, idx) => {
                  const revealed = extractedPolicies.includes(idx);
                  const isFirst = extractedPolicies[0] === idx;
                  return (
                    <div key={idx} className={`flex items-center gap-2 py-2 h-[42px] ${revealed && !isFirst ? "border-t border-foreground/6" : ""}`}>
                      {revealed ? (
                        <ItemFade className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="w-5 flex justify-center shrink-0">
                            <FileText className="w-3.5 h-3.5 text-foreground/30" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-label-sm text-foreground truncate">{policy.type} · {policy.carrier}</p>
                            <p className="text-[11px] text-muted-foreground/50 font-mono truncate">{policy.number}</p>
                          </div>
                        </ItemFade>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {activeBucket === 2 && (
            <motion.div
              key="analyze"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
              className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4"
            >
              <StepLabel stepNumber={3} label="Organize" />
              <div className="flex flex-col gap-3">
                {DEMO_STATUS.map((item, i) => {
                  const visible = statusItems.some((s) => s.id === item.id);
                  const isReady = item.id === "ready";
                  const isLast = visible && statusItems[statusItems.length - 1]?.id === item.id;
                  const showThinking = !isReady && isLast && phase === "analyzing";
                  return (
                    <div key={item.id} className="flex items-center gap-2 h-[20px]">
                      {visible && (
                        <ItemFade className="flex items-center gap-2">
                          <span className="w-5 flex justify-center shrink-0">
                            <span className={`w-1.5 h-1.5 rounded-full ${isReady ? "bg-emerald-500" : "bg-foreground/30"}`} />
                          </span>
                          <span className={`text-label-sm ${isReady ? "text-emerald-600 font-semibold" : "text-muted-foreground/70"}`}>
                            {item.label}
                            {showThinking && <ThinkingDots />}
                          </span>
                        </ItemFade>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between pt-2">
        <PillButton variant="secondary" onClick={onBack}>
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </PillButton>
        <PillButton onClick={onFinish} disabled={finishing}>
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
  );
}
