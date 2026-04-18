"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { FadeIn } from "@/components/ui/fade-in";
import { LogoIcon } from "@/components/ui/logo-icon";
import { AuthHeroBackground, PrismHeroLogo } from "@/components/auth-hero-background";
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
  MessageSquare,
  Users,
  Asterisk,
  Forward,
  UserPlus,
  X,
  Search,
  Brain,
  RefreshCw,
  Shield,
} from "lucide-react";
import { toast } from "sonner";
import { AgentHandleForm } from "@/components/agent-handle-form";
import { INDUSTRIES } from "@/convex/lib/industries";
import { SearchableSelect } from "@/components/ui/searchable-select";

const AGENT_DOMAIN = process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "prism.claritylabs.inc";

export default function OnboardingPage() {
  const router = useRouter();
  const viewer = useQuery(api.users.viewer);
  const viewerOrg = useQuery(api.orgs.viewerOrg);
  const connections = useQuery(api.connections.list);
  const invitations = useQuery(api.orgs.listInvitations);
  const pendingInvitation = useQuery(api.orgs.pendingInvitationForViewer);
  const updateProfile = useMutation(api.users.updateProfile);
  const createOrg = useMutation(api.orgs.createOrg);
  const updateOrg = useMutation(api.orgs.updateOrg);
  const inviteMember = useMutation(api.orgs.inviteMember);
  const cancelInvitation = useMutation(api.orgs.cancelInvitation);
  const acceptInvitation = useMutation(api.orgs.acceptInvitation);
  const completeOnboarding = useMutation(api.users.completeOnboarding);
  const hasDemoData = useQuery(api.seed.hasDemoData);
  const seedData = useAction(api.seed.seed);
  const extractCompanyInfo = useAction(api.actions.extractCompanyInfo.extractCompanyInfo);

  const [currentStep, setCurrentStep] = useState(0);

  // Step 1 state
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [companyContext, setCompanyContext] = useState("");
  const [industry, setIndustry] = useState("");
  const [industryVertical, setIndustryVertical] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  // Step 2 state
  const [connectionFormOpen, setConnectionFormOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const seeded = hasDemoData === true;

  // Step 3 state (agent)
  const [_handleClaimed, setHandleClaimed] = useState(false);
  const [canClaimHandle, setCanClaimHandle] = useState(false);
  const claimRef = useRef<(() => Promise<void>) | null>(null);

  // Step 4 state (team invites)
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviting, setInviting] = useState(false);

  // Step 5 state
  const [finishing, setFinishing] = useState(false);

  // Invitation acceptance state
  const [acceptingInvite, setAcceptingInvite] = useState(false);
  const [inviteName, setInviteName] = useState("");

  // Auto-resize textarea
  const contextRef = useRef<HTMLTextAreaElement>(null);
  const autoResize = useCallback(() => {
    const el = contextRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, []);

  // Pre-fill from org (preferred) or viewer
  useEffect(() => {
    if (viewer) {
      setName(viewer.name ?? "");
      // Prefer org fields if available
      const org = viewerOrg?.org;
      setCompanyName(org?.name ?? viewer.companyName ?? "");
      setCompanyWebsite(org?.website ?? viewer.companyWebsite ?? "");
      setCompanyContext(org?.context ?? viewer.companyContext ?? "");
      setIndustry(org?.industry ?? viewer.industry ?? "");
      setIndustryVertical(org?.industryVertical ?? viewer.industryVertical ?? "");
    }
  }, [viewer, viewerOrg]);

  useEffect(() => { autoResize(); }, [companyContext, autoResize]);

  const hasConnection = (connections?.filter((c) => !c.isDemo)?.length ?? 0) > 0;

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

      // Also save to org if available
      if (viewerOrg?.org) {
        const orgUpdates: Record<string, string> = {};
        if (companyName) orgUpdates.name = companyName;
        if (companyWebsite) orgUpdates.website = companyWebsite;
        if (companyContext) orgUpdates.context = companyContext;
        await updateOrg(orgUpdates);
      }

      let url = companyWebsite;
      if (!url.startsWith("http")) url = "https://" + url;
      const result = await extractCompanyInfo({ url });
      if (result.companyContext) {
        setCompanyContext(result.companyContext);
      }
      if (result.industry) {
        setIndustry(result.industry);
        if (result.industryVertical) {
          setIndustryVertical(result.industryVertical);
        } else {
          setIndustryVertical("");
        }
      }
    } finally {
      setExtracting(false);
    }
  }

  async function handleStep1Next() {
    setSavingProfile(true);
    try {
      // Save personal fields to user profile
      const profileUpdates: Record<string, string> = {};
      if (name) profileUpdates.name = name;
      // Also save company fields to user profile for backward compat during transition
      if (companyName) profileUpdates.companyName = companyName;
      if (companyWebsite) profileUpdates.companyWebsite = companyWebsite;
      if (companyContext) profileUpdates.companyContext = companyContext;
      if (industry) profileUpdates.industry = industry;
      if (industryVertical) profileUpdates.industryVertical = industryVertical;
      await updateProfile(profileUpdates);

      // Create org if it doesn't exist, otherwise update it
      if (viewerOrg?.org) {
        const orgUpdates: Record<string, string> = {};
        if (companyName) orgUpdates.name = companyName;
        if (companyWebsite) orgUpdates.website = companyWebsite;
        if (companyContext) orgUpdates.context = companyContext;
        if (industry) orgUpdates.industry = industry;
        if (industryVertical) orgUpdates.industryVertical = industryVertical;
        await updateOrg(orgUpdates);
      } else if (companyName) {
        await createOrg({
          name: companyName,
          ...(companyWebsite && { website: companyWebsite }),
          ...(companyContext && { context: companyContext }),
          ...(industry && { industry }),
          ...(industryVertical && { industryVertical }),
        });
      }

      setCurrentStep(1);
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSeedDemo() {
    setSeeding(true);
    try {
      await seedData();
    } finally {
      setSeeding(false);
    }
  }

  async function handleInvite() {
    if (!inviteEmail) return;
    setInviting(true);
    try {
      await inviteMember({ email: inviteEmail, role: inviteRole });
      toast.success(`Invitation sent to ${inviteEmail}`);
      setInviteEmail("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send invitation");
    } finally {
      setInviting(false);
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

  async function handleAcceptInvitation() {
    if (!pendingInvitation) return;
    setAcceptingInvite(true);
    try {
      // Save name if provided
      if (inviteName.trim()) {
        await updateProfile({ name: inviteName.trim() });
      }
      await acceptInvitation({ invitationId: pendingInvitation.invitationId });
      await completeOnboarding();
      router.replace("/");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to accept invitation");
      setAcceptingInvite(false);
    }
  }

  if (viewer === undefined || pendingInvitation === undefined) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden">
        <AuthHeroBackground />
        <Loader2 className="relative z-10 w-6 h-6 animate-spin text-white/60" />
      </div>
    );
  }

  // Show invitation acceptance UI if user has a pending invitation and no org yet
  if (pendingInvitation && !viewerOrg) {
    return (
      <div className="relative flex min-h-screen items-center justify-center px-4 py-12 overflow-hidden">
        <AuthHeroBackground />
        <FadeIn className="relative z-10 w-full max-w-sm">
          <PrismHeroLogo />
          <div className="rounded-xl border border-foreground/8 bg-background p-6 sm:p-8">
            <p className="text-body-sm text-foreground/50 text-center mb-5">
              You&apos;ve been invited to join a team
            </p>

            <div className="bg-foreground/[0.03] border border-foreground/6 rounded-lg px-4 py-3 mb-6">
              <p className="text-body-sm text-foreground font-medium">
                {pendingInvitation.orgName}
              </p>
              <p className="text-label-sm text-muted-foreground mt-0.5">
                Invited by {pendingInvitation.invitedByName} as {pendingInvitation.role}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-label-sm font-medium text-foreground/50  block mb-1.5">
                  Your Name
                </label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Jane Smith"
                  autoFocus
                  className="w-full rounded-lg border border-foreground/10 bg-card px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                />
              </div>

              <div className="pt-1">
                <PillButton
                  onClick={handleAcceptInvitation}
                  disabled={acceptingInvite}
                  className="w-full"
                >
                  {acceptingInvite ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Joining...
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Join {pendingInvitation.orgName}
                    </>
                  )}
                </PillButton>
              </div>
            </div>
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

  const steps = [
    { label: "Details", subtitle: "Tell us about you and your company" },
    { label: "Data", subtitle: "Connect an email account or try with demo data" },
    { label: "Agent", subtitle: "Claim an email address for your AI policy assistant" },
    { label: "Team", subtitle: "Invite teammates to collaborate on your insurance program" },
    { label: "Ready", subtitle: "See how Clarity organizes your policies" },
  ];

  const pendingInvitations = invitations?.filter((inv) => inv.status === "pending") ?? [];

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-12 overflow-hidden">
      <AuthHeroBackground />
      <FadeIn className="relative z-10 w-full max-w-lg">
        <PrismHeroLogo />
        <div className="rounded-xl border border-foreground/8 bg-background p-6 sm:p-8">
          {/* Header */}
          <div className="text-center mb-6">
            <p className="text-body-sm text-foreground/50">
              {steps[currentStep].subtitle}
            </p>
          </div>

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-1 mb-8">
            {steps.map((s, i) => (
              <div
                key={s.label}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i === currentStep
                    ? "w-8 bg-primary-light"
                    : i < currentStep
                      ? "w-4 bg-primary-light/40"
                      : "w-4 bg-foreground/10"
                }`}
              />
            ))}
          </div>

          {/* Step 1: Your Details */}
          {currentStep === 0 && (
            <div className="space-y-4">
              <div>
                <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
                  Your Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Smith"
                  autoFocus
                  className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                />
              </div>

              <div>
                <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
                  Company Name
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Insurance Brokerage"
                  className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                />
              </div>

              <div>
                <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
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
                      className="w-full rounded-lg border border-foreground/8 bg-popover pl-8.5 pr-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleExtract}
                    disabled={extracting || !companyWebsite}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-foreground/8 bg-popover text-label-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/15 hover:bg-foreground/[0.02] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
                    Industry
                  </label>
                  <SearchableSelect
                    options={INDUSTRIES.map((ind) => ({ value: ind.value, label: ind.label }))}
                    value={industry}
                    onChange={(v) => {
                      setIndustry(v);
                      setIndustryVertical("");
                    }}
                    placeholder="Select industry..."
                  />
                </div>
                <div>
                  <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
                    Vertical
                  </label>
                  <SearchableSelect
                    options={INDUSTRIES.find((i) => i.value === industry)?.verticals.map((v) => ({ value: v.value, label: v.label })) ?? []}
                    value={industryVertical}
                    onChange={setIndustryVertical}
                    placeholder="Select vertical..."
                    disabled={!industry}
                  />
                </div>
              </div>

              <div>
                <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
                  Company Context
                </label>
                <textarea
                  ref={contextRef}
                  value={companyContext}
                  onChange={(e) => setCompanyContext(e.target.value)}
                  onInput={autoResize}
                  placeholder="Brief description of your company, industry, and insurance needs..."
                  rows={3}
                  className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors resize-none overflow-hidden"
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
                      {seeded ? "Demo Data Loaded" : seeding ? "Generating..." : "Try Demo Data"}
                    </p>
                    <p className="text-label-sm text-muted-foreground/50 mt-0.5">
                      {seeded ? "Sample policies ready" : seeding ? "Creating industry-specific data" : "Load sample policies"}
                    </p>
                  </div>
                </button>
              </div>

              {/* Intelligence pipeline explanation */}
              <div className="rounded-lg border border-foreground/6 bg-foreground/[0.015] px-4 py-3">
                <p className="text-label-sm font-medium text-foreground/70 mb-2.5">
                  What happens after you connect
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="flex items-start gap-2.5">
                    <Search className="w-3.5 h-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
                    <p className="text-[11px] leading-relaxed text-muted-foreground/60">
                      Scan for insurance-related emails daily
                    </p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <Brain className="w-3.5 h-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
                    <p className="text-[11px] leading-relaxed text-muted-foreground/60">
                      Extract company details, operations, and risk signals
                    </p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <Shield className="w-3.5 h-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
                    <p className="text-[11px] leading-relaxed text-muted-foreground/60">
                      Build an intelligence profile to auto-fill applications
                    </p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <RefreshCw className="w-3.5 h-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
                    <p className="text-[11px] leading-relaxed text-muted-foreground/60">
                      Continuously improve as more emails arrive
                    </p>
                  </div>
                </div>
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

          {/* Step 3: AI Email Agent */}
          {currentStep === 2 && (
            <div className="space-y-6">
              {(viewerOrg?.org?.agentHandle ?? viewer?.agentHandle) ? (
                <div className="rounded-lg border border-primary-light/40 bg-primary-light/[0.06] p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Asterisk className="w-4 h-4 text-primary-light shrink-0" />
                    <p className="text-body-sm font-medium text-foreground">Agent email claimed</p>
                  </div>
                  <p className="text-label-sm font-mono text-[#6BB8F0] pl-6">
                    {viewerOrg?.org?.agentHandle ?? viewer?.agentHandle}@{AGENT_DOMAIN}
                  </p>
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
                  onClaimed={() => {
                    setHandleClaimed(true);
                    setCurrentStep(3);
                  }}
                  hideButton
                  claimRef={claimRef}
                  onAvailabilityChange={setCanClaimHandle}
                />
              )}

              <div>
                <p className="text-label-sm font-medium text-muted-foreground  mb-3">
                  What Prism can do
                </p>
                <div className="space-y-2">
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-violet-50/60 dark:bg-violet-950/30 border border-violet-100 dark:border-violet-900/50">
                    <MessageSquare className="w-4 h-4 text-violet-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-body-sm font-medium text-foreground">Direct: ask policy questions</p>
                      <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                        Email your agent to look up coverages, limits, dates, and more
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-sky-50/60 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/50">
                    <Users className="w-4 h-4 text-sky-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-body-sm font-medium text-foreground">CC: reply-all with policy info</p>
                      <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                        CC your agent on a thread and it replies to all participants
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-teal-50/60 dark:bg-teal-950/30 border border-teal-100 dark:border-teal-900/50">
                    <Forward className="w-4 h-4 text-teal-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-body-sm font-medium text-foreground">Forward: auto-reply to customers</p>
                      <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                        Forward a customer email and the agent replies directly to them
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <PillButton variant="secondary" onClick={() => setCurrentStep(1)}>
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </PillButton>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setCurrentStep(3)}
                    className="text-label-sm text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
                  >
                    Skip for now
                  </button>
                  {(viewerOrg?.org?.agentHandle ?? viewer?.agentHandle) ? (
                    <PillButton onClick={() => setCurrentStep(3)}>
                      Next
                      <ArrowRight className="w-3.5 h-3.5" />
                    </PillButton>
                  ) : (
                    <PillButton
                      onClick={() => claimRef.current?.()}
                      disabled={!canClaimHandle}
                    >
                      Claim Handle
                      <ArrowRight className="w-3.5 h-3.5" />
                    </PillButton>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Invite Your Team */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                      placeholder="colleague@company.com"
                      autoFocus
                      className="w-full rounded-lg border border-foreground/8 bg-popover pl-8.5 pr-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleInvite}
                    disabled={inviting || !inviteEmail}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-foreground/8 bg-popover text-label-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/15 hover:bg-foreground/[0.02] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  >
                    {inviting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <UserPlus className="w-3.5 h-3.5" />
                    )}
                    <span className="hidden sm:inline">Invite</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-label-sm text-muted-foreground/50">Role:</span>
                  <div className="flex rounded-lg border border-foreground/8 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setInviteRole("member")}
                      className={`px-3 py-1 text-label-sm font-medium transition-colors cursor-pointer ${
                        inviteRole === "member"
                          ? "bg-foreground/5 text-foreground"
                          : "text-muted-foreground/50 hover:text-muted-foreground"
                      }`}
                    >
                      Member
                    </button>
                    <button
                      type="button"
                      onClick={() => setInviteRole("admin")}
                      className={`px-3 py-1 text-label-sm font-medium border-l border-foreground/8 transition-colors cursor-pointer ${
                        inviteRole === "admin"
                          ? "bg-foreground/5 text-foreground"
                          : "text-muted-foreground/50 hover:text-muted-foreground"
                      }`}
                    >
                      Admin
                    </button>
                  </div>
                </div>
              </div>

              {pendingInvitations.length > 0 && (
                <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
                  {pendingInvitations.map((inv, i) => (
                    <div
                      key={inv._id}
                      className={`flex items-center gap-3 px-4 py-2.5 ${
                        i > 0 ? "border-t border-foreground/4" : ""
                      }`}
                    >
                      <Mail className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                      <span className="text-body-sm text-foreground flex-1 truncate">{inv.email}</span>
                      <span className="text-label-sm text-muted-foreground/40 capitalize">{inv.role}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await cancelInvitation({ invitationId: inv._id });
                          toast.success("Invitation cancelled");
                        }}
                        className="text-muted-foreground/30 hover:text-muted-foreground transition-colors cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {pendingInvitations.length === 0 && (
                <div className="rounded-lg border border-dashed border-foreground/8 bg-foreground/[0.01] p-6 text-center">
                  <Users className="w-5 h-5 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-label-sm text-muted-foreground/50">
                    Teammates will share your policy data and can use the AI agent
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <PillButton variant="secondary" onClick={() => setCurrentStep(2)}>
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </PillButton>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setCurrentStep(4)}
                    className="text-label-sm text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
                  >
                    Skip for now
                  </button>
                  <PillButton onClick={() => setCurrentStep(4)}>
                    Next
                    <ArrowRight className="w-3.5 h-3.5" />
                  </PillButton>
                </div>
              </div>
            </div>
          )}

          {/* Step 5: How It Works — Animated Demo */}
          {currentStep === 4 && (
            <HowItWorksDemo
              onBack={() => setCurrentStep(3)}
              onFinish={handleFinish}
              finishing={finishing}
            />
          )}
        </div>
        <p className="text-center mt-5">
          <a href="https://claritylabs.inc" target="_blank" rel="noopener noreferrer" className="inline-flex flex-col items-center gap-0.5 hover:opacity-80 transition-opacity">
            <span className="text-[11px] text-white/40">from</span>
            <span className="inline-flex items-center gap-1 serif text-[18px] text-white/70">clarity <LogoIcon size={16} color="#ffffff" static className="shrink-0" /> labs</span>
          </a>
        </p>
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
  { id: "intel", label: "Business intelligence profile built" },
  { id: "ready", label: "Ready to explore" },
];

const PHASE_DESCRIPTIONS: Record<DemoPhase, string> = {
  scanning: "Clarity can connect to your inbox and scan for insurance emails.",
  extracting: "Clarity can download attachments and extract policy data with AI.",
  analyzing: "Clarity organizes coverages and builds a business intelligence profile.",
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
      <span className="w-5 h-5 rounded-full bg-foreground text-background text-[10px] font-bold flex items-center justify-center shrink-0">
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
  const [_emailCount, setEmailCount] = useState(0);

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

    // Phase 3: Analyzing (7s–11s)
    timers.push(setTimeout(() => setPhase("analyzing"), 7000));
    DEMO_STATUS.forEach((item, i) => {
      timers.push(setTimeout(() => setStatusItems((prev) => [...prev, item]), 7400 + i * 700));
    });

    // Phase 4: Ready (11s), loop after 6s pause
    timers.push(setTimeout(() => setPhase("ready"), 11000));
    timers.push(setTimeout(() => setCycle((c) => c + 1), 17000));

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
                {DEMO_STATUS.map((item, _i) => {
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
