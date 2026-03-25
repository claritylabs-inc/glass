"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@/components/ui/fade-in";
import { motion } from "framer-motion";
import {
  Loader2,
  Globe,
  Sparkles,
  AlertTriangle,
  Trash2,
  Users,
  UserPlus,
  Shield,
  ShieldCheck,
  X,
  Mail,
  RotateCcw,
  Database,
  Building2,
  Plus,
  Key,
  Copy,
  Check,
  Eye,
  EyeOff,
} from "lucide-react";
import { INDUSTRIES } from "@/convex/lib/industries";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PillButton } from "@/components/ui/pill-button";
import { BusinessContextManager } from "@/components/business-context-manager";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Id } from "@/convex/_generated/dataModel";

const SETTINGS_TABS = [
  { id: "info", label: "Basic Information", icon: Building2 },
  { id: "team", label: "Team Members", icon: Users },
  { id: "context", label: "Business Context", icon: Database },
  { id: "apikeys", label: "API Keys", icon: Key },
] as const;

type SettingsTab = typeof SETTINGS_TABS[number]["id"];

export default function SettingsPage() {
  const viewer = useQuery(api.users.viewer);
  const orgData = useQuery(api.orgs.viewerOrg);
  const members = useQuery(api.orgs.listMembers);
  const invitations = useQuery(api.orgs.listInvitations);
  const updateOrg = useMutation(api.orgs.updateOrg);
  const inviteMember = useMutation(api.orgs.inviteMember);
  const removeMember = useMutation(api.orgs.removeMember);
  const updateMemberRole = useMutation(api.orgs.updateMemberRole);
  const setPrimaryContact = useMutation(api.orgs.setPrimaryInsuranceContact);
  const cancelInvitation = useMutation(api.orgs.cancelInvitation);
  const resetAccount = useMutation(api.users.resetAccount);
  const restartOnboarding = useMutation(api.users.restartOnboarding);
  const removeDemoData = useMutation(api.seed.removeDemoData);
  const hasDemoDataResult = useQuery(api.seed.hasDemoData);
  const extractCompanyInfo = useAction(api.actions.extractCompanyInfo.extractCompanyInfo);
  const router = useRouter();

  const org = orgData?.org;
  const membership = orgData?.membership;
  const isAdmin = membership?.role === "admin";

  const [activeTab, setActiveTab] = useState<SettingsTab>("info");
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [context, setContext] = useState("");
  const [industry, setIndustry] = useState("");
  const [industryVertical, setIndustryVertical] = useState("");
  const [insuranceBroker, setInsuranceBroker] = useState("");
  const [brokerContactName, setBrokerContactName] = useState("");
  const [brokerContactEmail, setBrokerContactEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [removingDemo, setRemovingDemo] = useState(false);
  const [showRemoveDemoDialog, setShowRemoveDemoDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviting, setInviting] = useState(false);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [showAddContextForm, setShowAddContextForm] = useState(false);
  // API Keys state
  const apiKeys = useQuery(api.apiKeys.list);
  const generateApiKey = useMutation(api.apiKeys.generate);
  const revokeApiKey = useMutation(api.apiKeys.revoke);
  const removeApiKey = useMutation(api.apiKeys.remove);
  const [showGenerateKeyDialog, setShowGenerateKeyDialog] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [generatingKey, setGeneratingKey] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [showRevokeDialog, setShowRevokeDialog] = useState<string | null>(null);

  const contextRef = useRef<HTMLTextAreaElement>(null);
  const autoResize = useCallback(() => {
    const el = contextRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, []);

  useEffect(() => {
    if (org) {
      setName(org.name ?? "");
      setWebsite(org.website ?? "");
      setContext(org.context ?? "");
      setIndustry(org.industry ?? "");
      setIndustryVertical(org.industryVertical ?? "");
      setInsuranceBroker(org.insuranceBroker ?? "");
      setBrokerContactName(org.brokerContactName ?? "");
      setBrokerContactEmail(org.brokerContactEmail ?? "");
    }
  }, [org]);

  const hasDemo = hasDemoDataResult === true;

  useEffect(() => { autoResize(); }, [context, autoResize]);

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    try {
      await updateOrg({
        name: name || undefined,
        website: website || undefined,
        context: context || undefined,
        industry: industry || undefined,
        industryVertical: industryVertical || undefined,
        insuranceBroker: insuranceBroker || undefined,
        brokerContactName: brokerContactName || undefined,
        brokerContactEmail: brokerContactEmail || undefined,
      });
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleExtract() {
    if (!website) return;
    setExtracting(true);
    try {
      let url = website;
      if (!url.startsWith("http")) url = "https://" + url;
      const result = await extractCompanyInfo({ url });
      if (result.companyContext) setContext(result.companyContext);
      if (result.industry) {
        setIndustry(result.industry);
        setIndustryVertical(result.industryVertical ?? "");
      }
      toast.success("Company info extracted");
    } catch {
      toast.error("Failed to extract company info");
    } finally {
      setExtracting(false);
    }
  }

  async function handleInvite() {
    if (!inviteEmail) return;
    setInviting(true);
    try {
      await inviteMember({ email: inviteEmail, role: inviteRole });
      toast.success(`Invitation sent to ${inviteEmail}`);
      setInviteEmail("");
      setShowInviteDialog(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to send invitation");
    } finally {
      setInviting(false);
    }
  }

  async function handleRemoveDemo() {
    setRemovingDemo(true);
    try {
      const result = await removeDemoData();
      setShowRemoveDemoDialog(false);
      toast.success(`Removed ${result.removed} demo records`);
    } catch {
      toast.error("Failed to remove demo data");
    } finally {
      setRemovingDemo(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    try {
      await resetAccount();
      setShowResetDialog(false);
      toast.success("Account reset successfully");
      router.replace("/onboarding");
    } catch {
      toast.error("Failed to reset account");
    } finally {
      setResetting(false);
    }
  }

  if (viewer === undefined || orgData === undefined) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  if (!isAdmin) {
    return (
      <AppShell>
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] p-8 text-center">
          <Shield className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
          <h2 className="!mb-2 text-lg font-semibold">Admin Access Required</h2>
          <p className="text-body-sm text-muted-foreground">
            Only organization admins can access settings.
          </p>
        </div>
      </AppShell>
    );
  }

  const saveButton = (
    <PillButton size="compact" onClick={handleSave} disabled={saving}>
      {saving ? (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Saving...
        </>
      ) : (
        "Save Settings"
      )}
    </PillButton>
  );

  const headerActions = (
    <>
      {activeTab === "info" && saveButton}
      {activeTab === "team" && (
        <PillButton size="compact" variant="secondary" onClick={() => setShowInviteDialog(true)}>
          <UserPlus className="w-3.5 h-3.5" />
          Invite Member
        </PillButton>
      )}
      {activeTab === "context" && (
        <PillButton size="compact" variant="secondary" onClick={() => setShowAddContextForm(!showAddContextForm)}>
          <Plus className="w-3.5 h-3.5" />
          Add Entry
        </PillButton>
      )}
      {activeTab === "apikeys" && (
        <PillButton size="compact" variant="secondary" onClick={() => { setShowGenerateKeyDialog(true); setGeneratedKey(null); setNewKeyName(""); }}>
          <Plus className="w-3.5 h-3.5" />
          Generate Key
        </PillButton>
      )}
    </>
  );

  return (
    <AppShell actions={headerActions}>

          {/* Tabs */}
          <FadeIn when={true} staggerIndex={1} duration={0.6}>
            <div className="flex items-center gap-1 border-b border-foreground/6 mb-6">
              {SETTINGS_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative px-3 py-2 text-body-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === tab.id
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground/70"
                  }`}
                >
                  {tab.label}
                  {activeTab === tab.id && (
                    <motion.div
                      layoutId="settings-tab-indicator"
                      className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                </button>
              ))}
            </div>
          </FadeIn>

          {/* Tab content */}
          <FadeIn when={true} staggerIndex={2} duration={0.6}>
            {activeTab === "info" ? (
              <div className="space-y-4">
                {/* Organization info */}
                <form onSubmit={handleSave}>
                  <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] mb-4">
                    <div className="px-5 py-3.5 border-b border-foreground/6">
                      <h3 className="!mb-0 text-sm font-medium text-foreground">Organization</h3>
                    </div>
                    <div className="px-5 py-5 space-y-4">
                      <div>
                        <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                          Organization Name
                        </label>
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Acme Corp"
                          className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                        />
                      </div>

                      <div>
                        <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                          Website
                        </label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
                            <input
                              type="text"
                              value={website}
                              onChange={(e) => setWebsite(e.target.value)}
                              placeholder="https://yourcompany.com"
                              className="w-full rounded-lg border border-foreground/8 bg-popover pl-8.5 pr-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={handleExtract}
                            disabled={extracting || !website}
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

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
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
                          <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
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
                        <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                          Company Context
                        </label>
                        <textarea
                          ref={contextRef}
                          value={context}
                          onChange={(e) => setContext(e.target.value)}
                          onInput={autoResize}
                          placeholder="Brief description of your company, industry, and insurance needs..."
                          rows={4}
                          className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors resize-none overflow-hidden"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Insurance Broker section */}
                  <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] mb-4">
                    <div className="px-5 py-3.5 border-b border-foreground/6">
                      <h3 className="!mb-0 text-sm font-medium text-foreground">Insurance Broker</h3>
                    </div>
                    <div className="px-5 py-5">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                            Broker (Company)
                          </label>
                          <input
                            type="text"
                            value={insuranceBroker}
                            onChange={(e) => setInsuranceBroker(e.target.value)}
                            placeholder="Marsh McLennan"
                            className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                          />
                        </div>
                        <div>
                          <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                            Contact Name
                          </label>
                          <input
                            type="text"
                            value={brokerContactName}
                            onChange={(e) => setBrokerContactName(e.target.value)}
                            placeholder="Jane Smith"
                            className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                          />
                        </div>
                        <div>
                          <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                            Contact Email
                          </label>
                          <input
                            type="email"
                            value={brokerContactEmail}
                            onChange={(e) => setBrokerContactEmail(e.target.value)}
                            placeholder="jane@broker.com"
                            className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </form>

                {/* Onboarding section */}
                <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04]">
                  <div className="px-5 py-3.5 border-b border-foreground/6">
                    <h3 className="!mb-0 text-sm font-medium text-foreground">Onboarding</h3>
                  </div>
                  <div className="px-5 py-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-body-sm font-medium text-foreground">Re-run Setup</p>
                        <p className="text-label-sm text-muted-foreground mt-0.5">
                          Walk through the onboarding steps again. Your existing data will not be affected.
                        </p>
                      </div>
                      <PillButton
                        variant="secondary"
                        onClick={async () => {
                          try {
                            await restartOnboarding();
                            toast.success("Restarting onboarding...");
                            router.replace("/onboarding");
                          } catch {
                            toast.error("Failed to restart onboarding");
                          }
                        }}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Re-run
                      </PillButton>
                    </div>
                  </div>
                </div>

                {/* Demo Data section */}
                {hasDemo && (
                  <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/30">
                    <div className="px-5 py-3.5 border-b border-amber-200 dark:border-amber-900/50">
                      <h3 className="!mb-0 text-sm font-medium text-amber-900 dark:text-amber-400">Demo Data</h3>
                    </div>
                    <div className="px-5 py-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-body-sm font-medium text-foreground">Remove Demo Data</p>
                          <p className="text-label-sm text-muted-foreground mt-0.5">
                            Delete all demo policies, emails, and connections. Real data is not affected.
                          </p>
                        </div>
                        <PillButton
                          variant="destructive"
                          onClick={() => setShowRemoveDemoDialog(true)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Remove
                        </PillButton>
                      </div>
                    </div>
                  </div>
                )}

                {/* Danger Zone */}
                {viewer?.isAdmin && (
                  <div className="mt-4">
                    <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/30">
                      <div className="px-5 py-3.5 border-b border-red-200 dark:border-red-900/50">
                        <h3 className="!mb-0 text-sm font-medium text-red-900 dark:text-red-400">Danger Zone</h3>
                      </div>
                      <div className="px-5 py-5">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-body-sm font-medium text-foreground">Reset Organization</p>
                            <p className="text-label-sm text-muted-foreground mt-0.5">
                              Delete all policies, emails, connections, and conversations. This cannot be undone.
                            </p>
                          </div>
                          <PillButton
                            variant="destructive"
                            onClick={() => setShowResetDialog(true)}
                          >
                            Reset
                          </PillButton>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : activeTab === "team" ? (
              <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04]">
                <div className="px-5 py-3.5 border-b border-foreground/6">
                  <h3 className="!mb-0 text-sm font-medium text-foreground">Team Members</h3>
                </div>
                <div className="divide-y divide-foreground/6">
                  {members?.map((member) => (
                    <div key={member.membershipId} className="px-5 py-3.5 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-foreground/8 flex items-center justify-center text-label-sm font-medium text-foreground shrink-0">
                        {member.name
                          ? member.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
                          : member.email?.[0]?.toUpperCase() ?? "?"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-body-sm font-medium text-foreground truncate">
                          {member.name || member.email}
                          {member.userId === viewer?._id && (
                            <span className="text-label-sm text-muted-foreground/40 ml-1">(you)</span>
                          )}
                        </p>
                        {member.name && member.email && (
                          <p className="text-label-sm text-muted-foreground truncate">{member.email}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {member.userId === org?.primaryInsuranceContactId && (
                          <span className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded">
                            Primary Contact
                          </span>
                        )}
                        <span className={`text-[11px] px-1.5 py-0.5 rounded flex items-center gap-1 ${
                          member.role === "admin"
                            ? "text-[#5BA4D9] bg-[#A0D2FA]/10"
                            : "text-muted-foreground bg-foreground/5"
                        }`}>
                          {member.role === "admin" && <ShieldCheck className="w-3 h-3" />}
                          {member.role === "admin" ? "Admin" : "Member"}
                        </span>
                        {member.userId !== viewer?._id && (
                          <div className="flex items-center gap-1">
                            {member.userId !== org?.primaryInsuranceContactId && (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await setPrimaryContact({ userId: member.userId });
                                    toast.success("Primary contact updated");
                                  } catch (e: any) {
                                    toast.error(e.message || "Failed to update");
                                  }
                                }}
                                className="text-[11px] text-muted-foreground/40 hover:text-foreground transition-colors cursor-pointer"
                                title="Set as primary insurance contact"
                              >
                                Set Primary
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await updateMemberRole({
                                    membershipId: member.membershipId,
                                    role: member.role === "admin" ? "member" : "admin",
                                  });
                                  toast.success("Role updated");
                                } catch (e: any) {
                                  toast.error(e.message || "Failed to update role");
                                }
                              }}
                              className="text-[11px] text-muted-foreground/40 hover:text-foreground transition-colors cursor-pointer"
                            >
                              {member.role === "admin" ? "Demote" : "Promote"}
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await removeMember({ membershipId: member.membershipId });
                                  toast.success("Member removed");
                                } catch (e: any) {
                                  toast.error(e.message || "Failed to remove member");
                                }
                              }}
                              className="text-[11px] text-red-400 hover:text-red-600 transition-colors cursor-pointer"
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Pending invitations */}
                  {invitations?.filter((i) => i.status === "pending").map((inv) => (
                    <div key={inv._id} className="px-5 py-3.5 flex items-center gap-3 opacity-60">
                      <div className="w-8 h-8 rounded-full bg-foreground/5 flex items-center justify-center shrink-0">
                        <Mail className="w-3.5 h-3.5 text-muted-foreground/40" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-body-sm text-muted-foreground truncate">{inv.email}</p>
                        <p className="text-label-sm text-muted-foreground/40">Invitation pending</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] text-muted-foreground bg-foreground/5 px-1.5 py-0.5 rounded">
                          {inv.role}
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await cancelInvitation({ invitationId: inv._id });
                              toast.success("Invitation cancelled");
                            } catch {
                              toast.error("Failed to cancel invitation");
                            }
                          }}
                          className="text-[11px] text-red-400 hover:text-red-600 transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : activeTab === "context" ? (
              /* Business Context tab */
              <BusinessContextManager
                showAddForm={showAddContextForm}
                onShowAddFormChange={setShowAddContextForm}
              />
            ) : (
              /* API Keys tab */
              <div className="space-y-4">
                <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04]">
                  <div className="px-5 py-3.5 border-b border-foreground/6">
                    <h3 className="!mb-0 text-sm font-medium text-foreground">API Keys</h3>
                    <p className="text-label-sm text-muted-foreground mt-0.5">
                      Manage API keys for MCP server and programmatic access to Prism.
                    </p>
                  </div>
                  {apiKeys && apiKeys.length > 0 ? (
                    <div className="divide-y divide-foreground/6">
                      {apiKeys.map((key) => (
                        <div key={key._id} className="px-5 py-3.5 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-body-sm font-medium text-foreground">
                              {key.name}
                              {key.revokedAt && (
                                <span className="text-[11px] text-red-400 bg-red-50 dark:bg-red-950/40 px-1.5 py-0.5 rounded ml-2">
                                  Revoked
                                </span>
                              )}
                            </p>
                            <p className="text-label-sm text-muted-foreground font-mono mt-0.5">
                              {key.keyPrefix}{"••••••••"}
                            </p>
                            {key.lastUsedAt && (
                              <p className="text-[11px] text-muted-foreground/50 mt-0.5">
                                Last used {new Date(key.lastUsedAt).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {!key.revokedAt ? (
                              <button
                                type="button"
                                onClick={() => setShowRevokeDialog(key._id)}
                                className="text-[11px] text-red-400 hover:text-red-600 transition-colors cursor-pointer"
                              >
                                Revoke
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await removeApiKey({ id: key._id as Id<"apiKeys"> });
                                    toast.success("Key removed");
                                  } catch {
                                    toast.error("Failed to remove key");
                                  }
                                }}
                                className="text-[11px] text-muted-foreground/40 hover:text-foreground transition-colors cursor-pointer"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-5 py-8 text-center">
                      <Key className="w-6 h-6 text-muted-foreground/20 mx-auto mb-2" />
                      <p className="text-body-sm text-muted-foreground">No API keys yet</p>
                      <p className="text-label-sm text-muted-foreground/50 mt-0.5">
                        Generate a key to connect AI agents via MCP.
                      </p>
                    </div>
                  )}
                </div>

                {/* MCP Setup Instructions */}
                <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04]">
                  <div className="px-5 py-3.5 border-b border-foreground/6">
                    <h3 className="!mb-0 text-sm font-medium text-foreground">MCP Server Setup</h3>
                  </div>
                  <div className="px-5 py-5 space-y-5">
                    <div>
                      <p className="text-body-sm font-medium text-foreground mb-1">Remote URL (Claude.ai, ChatGPT, etc.)</p>
                      <p className="text-body-sm text-muted-foreground mb-2">
                        Use this URL as the Remote MCP server URL in your connector settings. Pass your API key as a Bearer token in the Authorization header.
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-[12px] bg-foreground/[0.03] border border-foreground/6 rounded-lg px-3 py-2 text-muted-foreground select-all">
                          {(process.env.NEXT_PUBLIC_CONVEX_URL ?? "").replace(".cloud", ".site")}/mcp
                        </code>
                      </div>
                    </div>
                    <div className="border-t border-foreground/6 pt-4">
                      <p className="text-body-sm font-medium text-foreground mb-1">Local stdio (Claude Code, Cursor, etc.)</p>
                      <p className="text-body-sm text-muted-foreground mb-2">
                        Add this to your MCP config (<code className="text-[12px] bg-foreground/5 px-1 py-0.5 rounded">~/.claude/mcp.json</code>):
                      </p>
                      <pre className="text-[12px] bg-foreground/[0.03] border border-foreground/6 rounded-lg p-4 overflow-x-auto text-muted-foreground">
{JSON.stringify({
  mcpServers: {
    prism: {
      command: "node",
      args: ["<path-to-prism>/mcp-server/dist/index.js"],
      env: {
        PRISM_CONVEX_SITE_URL: (process.env.NEXT_PUBLIC_CONVEX_URL ?? "").replace(".cloud", ".site"),
        PRISM_API_KEY: "prism_...",
      },
    },
  },
}, null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </FadeIn>

      {/* Invite Dialog */}
      <Dialog open={showInviteDialog} onOpenChange={(v) => !v && setShowInviteDialog(false)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-muted-foreground" />
              Invite Team Member
            </DialogTitle>
            <DialogDescription>
              Send an invitation to join your organization. They&apos;ll receive an email with instructions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
              />
            </div>
            <div>
              <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                Role
              </label>
              <div className="flex gap-2">
                {(["member", "admin"] as const).map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setInviteRole(role)}
                    className={`flex-1 py-2 rounded-lg border text-body-sm font-medium transition-colors cursor-pointer ${
                      inviteRole === role
                        ? "border-foreground/15 bg-foreground/[0.03] text-foreground"
                        : "border-foreground/6 text-muted-foreground hover:border-foreground/10"
                    }`}
                  >
                    {role === "admin" ? "Admin" : "Member"}
                  </button>
                ))}
              </div>
              <p className="text-label-sm text-muted-foreground/50 mt-1.5">
                {inviteRole === "admin"
                  ? "Admins can manage connections, settings, and team members."
                  : "Members can view policies and use the agent, but can't manage connections or settings."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <PillButton variant="secondary" onClick={() => setShowInviteDialog(false)} disabled={inviting}>
              Cancel
            </PillButton>
            <PillButton onClick={handleInvite} disabled={inviting || !inviteEmail}>
              {inviting ? "Sending..." : "Send Invitation"}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Demo Dialog */}
      <Dialog open={showRemoveDemoDialog} onOpenChange={(v) => !v && setShowRemoveDemoDialog(false)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-amber-500" />
              Remove Demo Data
            </DialogTitle>
            <DialogDescription>
              This will delete all demo policies, emails, and connections. Your real data will not be affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <PillButton variant="secondary" onClick={() => setShowRemoveDemoDialog(false)} disabled={removingDemo}>
              Cancel
            </PillButton>
            <PillButton variant="destructive" onClick={handleRemoveDemo} disabled={removingDemo}>
              {removingDemo ? "Removing..." : "Yes, Remove Demo Data"}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate API Key Dialog */}
      <Dialog open={showGenerateKeyDialog} onOpenChange={(v) => { if (!v) { setShowGenerateKeyDialog(false); setGeneratedKey(null); } }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-5 h-5 text-muted-foreground" />
              {generatedKey ? "API Key Generated" : "Generate API Key"}
            </DialogTitle>
            <DialogDescription>
              {generatedKey
                ? "Copy this key now. You won't be able to see it again."
                : "Create a new API key for MCP server or programmatic access."}
            </DialogDescription>
          </DialogHeader>
          {generatedKey ? (
            <div className="py-2">
              <div className="flex items-center gap-2 bg-foreground/[0.03] border border-foreground/6 rounded-lg p-3">
                <code className="text-[12px] font-mono text-foreground flex-1 break-all select-all">
                  {generatedKey}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedKey);
                    setCopiedKey(true);
                    setTimeout(() => setCopiedKey(false), 2000);
                  }}
                  className="shrink-0 p-1.5 rounded hover:bg-foreground/5 transition-colors cursor-pointer"
                >
                  {copiedKey ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4 text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="py-2">
              <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                Key Name
              </label>
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g. Claude Code, Cursor"
                className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
              />
            </div>
          )}
          <DialogFooter>
            <PillButton variant="secondary" onClick={() => { setShowGenerateKeyDialog(false); setGeneratedKey(null); }} disabled={generatingKey}>
              {generatedKey ? "Done" : "Cancel"}
            </PillButton>
            {!generatedKey && (
              <PillButton
                onClick={async () => {
                  if (!newKeyName) return;
                  setGeneratingKey(true);
                  try {
                    const key = await generateApiKey({ name: newKeyName });
                    setGeneratedKey(key);
                    toast.success("API key generated");
                  } catch {
                    toast.error("Failed to generate key");
                  } finally {
                    setGeneratingKey(false);
                  }
                }}
                disabled={generatingKey || !newKeyName}
              >
                {generatingKey ? "Generating..." : "Generate"}
              </PillButton>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke API Key Dialog */}
      <Dialog open={!!showRevokeDialog} onOpenChange={(v) => !v && setShowRevokeDialog(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Revoke API Key
            </DialogTitle>
            <DialogDescription>
              This key will immediately stop working. Any MCP servers or integrations using it will lose access.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <PillButton variant="secondary" onClick={() => setShowRevokeDialog(null)}>
              Cancel
            </PillButton>
            <PillButton
              variant="destructive"
              onClick={async () => {
                if (!showRevokeDialog) return;
                try {
                  await revokeApiKey({ id: showRevokeDialog as Id<"apiKeys"> });
                  setShowRevokeDialog(null);
                  toast.success("API key revoked");
                } catch {
                  toast.error("Failed to revoke key");
                }
              }}
            >
              Yes, Revoke
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Dialog */}
      <Dialog open={showResetDialog} onOpenChange={(v) => !v && setShowResetDialog(false)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Reset Organization
            </DialogTitle>
            <DialogDescription>
              This will permanently delete all policies (including stored files), emails, connections, and conversations for your organization. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <PillButton variant="secondary" onClick={() => setShowResetDialog(false)} disabled={resetting}>
              Cancel
            </PillButton>
            <PillButton variant="destructive" onClick={handleReset} disabled={resetting}>
              {resetting ? "Resetting..." : "Yes, Reset Everything"}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
