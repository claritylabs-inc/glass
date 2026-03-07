"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Nav } from "@/components/nav";
import { FadeIn } from "@/components/ui/fade-in";
import { Loader2, Globe, Sparkles, Check } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";

export default function ProfilePage() {
  const viewer = useQuery(api.users.viewer);
  const updateProfile = useMutation(api.users.updateProfile);
  const extractCompanyInfo = useAction(api.actions.extractCompanyInfo.extractCompanyInfo);

  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [insuranceBroker, setInsuranceBroker] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [companyContext, setCompanyContext] = useState("");
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (viewer) {
      setName(viewer.name ?? "");
      setCompanyName(viewer.companyName ?? "");
      setInsuranceBroker(viewer.insuranceBroker ?? "");
      setCompanyWebsite(viewer.companyWebsite ?? "");
      setCompanyContext(viewer.companyContext ?? "");
    }
  }, [viewer]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile({
        name: name || undefined,
        companyName: companyName || undefined,
        insuranceBroker: insuranceBroker || undefined,
        companyWebsite: companyWebsite || undefined,
        companyContext: companyContext || undefined,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
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
      }
    } finally {
      setExtracting(false);
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

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <div className="mb-6">
              <h1 className="!mb-1">Profile Settings</h1>
              <p className="text-body-sm text-muted-foreground">
                Manage your account and company information
              </p>
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                        Insurance Broker
                      </label>
                      <input
                        type="text"
                        value={insuranceBroker}
                        onChange={(e) => setInsuranceBroker(e.target.value)}
                        placeholder="Your broker name"
                        className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                      />
                    </div>
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
                      value={companyContext}
                      onChange={(e) => setCompanyContext(e.target.value)}
                      placeholder="Brief description of your company, industry, and insurance needs..."
                      rows={4}
                      className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors resize-y"
                    />
                    <p className="text-label-sm text-muted-foreground/50 mt-1.5">
                      Used to provide context to the AI during policy extraction
                    </p>
                  </div>
                </div>
              </div>

              {/* Save bar */}
              <div className="flex items-center justify-end gap-3 pt-2">
                {saved && (
                  <span className="flex items-center gap-1.5 text-label font-medium text-success">
                    <Check className="w-3.5 h-3.5" />
                    Saved
                  </span>
                )}
                <PillButton type="submit" disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Profile"
                  )}
                </PillButton>
              </div>
            </form>
          </FadeIn>
        </div>
      </main>
    </div>
  );
}
