"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Nav } from "@/components/nav";
import { FadeIn } from "@/components/ui/fade-in";
import { Loader2, Globe, Sparkles, AlertTriangle } from "lucide-react";
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

export default function ProfilePage() {
  const viewer = useQuery(api.users.viewer);
  const updateProfile = useMutation(api.users.updateProfile);
  const resetAccount = useMutation(api.users.resetAccount);
  const extractCompanyInfo = useAction(api.actions.extractCompanyInfo.extractCompanyInfo);
  const router = useRouter();

  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [insuranceBroker, setInsuranceBroker] = useState("");
  const [brokerContactName, setBrokerContactName] = useState("");
  const [brokerContactEmail, setBrokerContactEmail] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [companyContext, setCompanyContext] = useState("");
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetting, setResetting] = useState(false);

  const contextRef = useRef<HTMLTextAreaElement>(null);
  const autoResize = useCallback(() => {
    const el = contextRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, []);

  useEffect(() => {
    if (viewer) {
      setName(viewer.name ?? "");
      setCompanyName(viewer.companyName ?? "");
      setInsuranceBroker(viewer.insuranceBroker ?? "");
      setBrokerContactName(viewer.brokerContactName ?? "");
      setBrokerContactEmail(viewer.brokerContactEmail ?? "");
      setCompanyWebsite(viewer.companyWebsite ?? "");
      setCompanyContext(viewer.companyContext ?? "");
    }
  }, [viewer]);

  useEffect(() => { autoResize(); }, [companyContext, autoResize]);

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    try {
      await updateProfile({
        name: name || undefined,
        companyName: companyName || undefined,
        insuranceBroker: insuranceBroker || undefined,
        brokerContactName: brokerContactName || undefined,
        brokerContactEmail: brokerContactEmail || undefined,
        companyWebsite: companyWebsite || undefined,
        companyContext: companyContext || undefined,
      });
      toast.success("Profile saved");
    } catch {
      toast.error("Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  async function handleExtract() {
    if (!companyWebsite) return;
    setExtracting(true);
    try {
      let url = companyWebsite;
      if (!url.startsWith("http")) url = "https://" + url;
      const result = await extractCompanyInfo({ url });
      if (result.companyContext) {
        setCompanyContext(result.companyContext);
        toast.success("Company info extracted");
      }
    } catch {
      toast.error("Failed to extract company info");
    } finally {
      setExtracting(false);
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

  if (viewer === undefined) {
    return (
      <>
        <Nav />
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </>
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
        "Save Profile"
      )}
    </PillButton>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 pb-20 md:pb-0">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <div className="flex items-start justify-between mb-6">
              <div>
                <h1 className="!mb-1">Profile Settings</h1>
                <p className="text-body-sm text-muted-foreground">
                  Manage your account and company information
                </p>
              </div>
              <div className="hidden md:flex items-center gap-3">
                {saveButton}
              </div>
            </div>
          </FadeIn>

          <FadeIn when={true} staggerIndex={1} duration={0.6}>
            <form onSubmit={handleSave}>
              {/* Account section */}
              <div className="rounded-lg border border-foreground/6 bg-white/60 mb-4">
                <div className="px-5 py-3.5 border-b border-foreground/6">
                  <h3 className="!mb-0 text-sm font-medium text-foreground">Account</h3>
                </div>
                <div className="px-5 py-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                        Name
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name"
                        className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                        Email
                      </label>
                      <input
                        type="email"
                        value={viewer?.email ?? ""}
                        disabled
                        className="w-full rounded-lg border border-foreground/8 bg-foreground/[0.02] px-3 py-2 text-body-sm text-muted-foreground/60 cursor-not-allowed"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Company section */}
              <div className="rounded-lg border border-foreground/6 bg-white/60 mb-4">
                <div className="px-5 py-3.5 border-b border-foreground/6">
                  <h3 className="!mb-0 text-sm font-medium text-foreground">Company</h3>
                </div>
                <div className="px-5 py-5 space-y-4">
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
                    <p className="text-label-sm text-muted-foreground/50 mt-1.5">
                      Enter your website URL and click Extract to auto-fill company context with AI
                    </p>
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
                      rows={4}
                      className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors resize-none overflow-hidden"
                    />
                    <p className="text-label-sm text-muted-foreground/50 mt-1.5">
                      Used to provide context to the AI during policy extraction
                    </p>
                  </div>
                </div>
              </div>

              {/* Insurance Broker section */}
              <div className="rounded-lg border border-foreground/6 bg-white/60 mb-4">
                <div className="px-5 py-3.5 border-b border-foreground/6">
                  <h3 className="!mb-0 text-sm font-medium text-foreground">Insurance Broker</h3>
                </div>
                <div className="px-5 py-5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

          {/* Danger Zone — admin only */}
          {viewer?.isAdmin && (
            <FadeIn when={true} staggerIndex={2} duration={0.6}>
              <div className="mt-8">
                <div className="rounded-lg border border-red-200 bg-red-50/50 mb-4">
                  <div className="px-5 py-3.5 border-b border-red-200">
                    <h3 className="!mb-0 text-sm font-medium text-red-900">Danger Zone</h3>
                  </div>
                  <div className="px-5 py-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-body-sm font-medium text-foreground">Reset Account</p>
                        <p className="text-label-sm text-muted-foreground mt-0.5">
                          Delete all policies, emails, and connections. This cannot be undone.
                        </p>
                      </div>
                      <PillButton
                        variant="destructive"
                        onClick={() => setShowResetDialog(true)}
                      >
                        Reset Account
                      </PillButton>
                    </div>
                  </div>
                </div>
              </div>

              <Dialog open={showResetDialog} onOpenChange={(v) => !v && setShowResetDialog(false)}>
                <DialogContent showCloseButton={false}>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-red-500" />
                      Reset Account
                    </DialogTitle>
                    <DialogDescription>
                      This will permanently delete all your policies (including stored files), emails, and connections. Your profile will be reset and you&apos;ll go through onboarding again. This action cannot be undone.
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
            </FadeIn>
          )}
        </div>
      </main>

      <FixedMobileFooter>
        {saveButton}
      </FixedMobileFooter>
    </div>
  );
}
