"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Nav } from "@/components/nav";
import { FadeIn } from "@/components/ui/fade-in";
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
} from "lucide-react";
import { INDUSTRIES } from "@/convex/lib/industries";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PillButton } from "@/components/ui/pill-button";
import { FixedMobileFooter } from "@/components/ui/fixed-mobile-footer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Id } from "@/convex/_generated/dataModel";

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
      <>
        <Nav />
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex flex-col">
        <Nav />
        <main className="flex-1">
          <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
            <div className="rounded-lg border border-foreground/6 bg-white/60 p-8 text-center">
              <Shield className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
              <h2 className="!mb-2 text-lg font-semibold">Admin Access Required</h2>
              <p className="text-body-sm text-muted-foreground">
                Only organization admins can access settings.
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const saveButton = (
    <PillButton onClick={handleSave} disabled={saving}>
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

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 pb-12 md:pb-0">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <div className="flex items-start justify-between mb-6">
              <div>
                <h1 className="!mb-1">Organization Settings</h1>
                <p className="text-body-sm text-muted-foreground">
                  Your organization, team, and preferences
                </p>
              </div>
              <div className="hidden md:flex items-center gap-3">
                {saveButton}
              </div>
            </div>
          </FadeIn>

          <FadeIn when={true} staggerIndex={1} duration={0.6}>
            <form onSubmit={handleSave}>
              {/* Organization info */}
              <div className="rounded-lg border border-foreground/6 bg-white/60 mb-4">
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
                      className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
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
                          className="w-full rounded-lg border border-foreground/8 bg-white pl-8.5 pr-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleExtract}
                        disabled={extracting || !website}
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
                      className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors resize-none overflow-hidden"
                    />
                  </div>
                </div>
              </div>

              {/* Insurance Broker section */}
              <div className="rounded-lg border border-foreground/6 bg-white/60 mb-4">
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
                        className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
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
                        className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
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
                        className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </FadeIn>

          {/* Team Members section */}
          <FadeIn when={true} staggerIndex={2} duration={0.6}>
            <div className="rounded-lg border border-foreground/6 bg-white/60 mb-4">
              <div className="px-5 py-3.5 border-b border-foreground/6 flex items-center justify-between">
                <h3 className="!mb-0 text-sm font-medium text-foreground">Team Members</h3>
                <PillButton variant="secondary" onClick={() => setShowInviteDialog(true)}>
                  <UserPlus className="w-3.5 h-3.5" />
                  Invite
                </PillButton>
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
                        <span className="text-[11px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
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
          </FadeIn>

          {/* Onboarding section */}
          <FadeIn when={true} staggerIndex={3} duration={0.6}>
            <div className="rounded-lg border border-foreground/6 bg-white/60 mb-4">
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
          </FadeIn>

          {/* Demo Data section */}
          {hasDemo && (
            <FadeIn when={true} staggerIndex={4} duration={0.6}>
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 mb-4">
                <div className="px-5 py-3.5 border-b border-amber-200">
                  <h3 className="!mb-0 text-sm font-medium text-amber-900">Demo Data</h3>
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
            </FadeIn>
          )}

          {/* Danger Zone */}
          {viewer?.isAdmin && (
            <FadeIn when={true} staggerIndex={5} duration={0.6}>
              <div className="mt-8">
                <div className="rounded-lg border border-red-200 bg-red-50/50 mb-4">
                  <div className="px-5 py-3.5 border-b border-red-200">
                    <h3 className="!mb-0 text-sm font-medium text-red-900">Danger Zone</h3>
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
            </FadeIn>
          )}
        </div>
      </main>

      <FixedMobileFooter>
        {saveButton}
      </FixedMobileFooter>

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
                className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
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
    </div>
  );
}
