"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSettingsActions } from "@/app/settings/page";
import { useQuery, useMutation, useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import {
  Loader2,
  Sparkles,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { INDUSTRIES } from "@/convex/lib/industries";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PillButton } from "@/components/ui/pill-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export function OrganizationSection() {
  const viewer = useQuery(api.users.viewer);
  const orgData = useQuery(api.orgs.viewerOrg);
  const updateOrg = useMutation(api.orgs.updateOrg);
  const setDomainJoinPolicy = useMutation(api.orgs.setDomainJoinPolicy);
  const restartOnboarding = useMutation(api.users.restartOnboarding);
  const removeDemoData = useMutation(api.seed.removeDemoData);
  const hasDemoDataResult = useQuery(api.seed.hasDemoData);
  const extractCompanyInfo = useAction(api.actions.extractCompanyInfo.extractCompanyInfo);
  const router = useRouter();

  const org = orgData?.org;

  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [context, setContext] = useState("");
  const [industry, setIndustry] = useState("");
  const [industryVertical, setIndustryVertical] = useState("");
  const [clientsContext, setClientsContext] = useState("");
  const [vendorsContext, setVendorsContext] = useState("");
  const [insuranceContext, setInsuranceContext] = useState("");
  const [investorsContext, setInvestorsContext] = useState("");
  const [partnersContext, setPartnersContext] = useState("");
  const [insuranceBroker, setInsuranceBroker] = useState("");
  const [brokerContactName, setBrokerContactName] = useState("");
  const [brokerContactEmail, setBrokerContactEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [removingDemo, setRemovingDemo] = useState(false);
  const [showRemoveDemoDialog, setShowRemoveDemoDialog] = useState(false);

  const { setActions } = useSettingsActions();

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
      setClientsContext(org.clientsContext ?? "");
      setVendorsContext(org.vendorsContext ?? "");
      setInsuranceContext(org.insuranceContext ?? "");
      setInvestorsContext(org.investorsContext ?? "");
      setPartnersContext(org.partnersContext ?? "");
      setInsuranceBroker(org.insuranceBroker ?? "");
      setBrokerContactName(org.brokerContactName ?? "");
      setBrokerContactEmail(org.brokerContactEmail ?? "");
    }
  }, [org]);

  useEffect(() => { autoResize(); }, [context, autoResize]);

  useEffect(() => {
    setActions(
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
    return () => setActions(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving]);

  const hasDemo = hasDemoDataResult === true;

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
        clientsContext: clientsContext || undefined,
        vendorsContext: vendorsContext || undefined,
        insuranceContext: insuranceContext || undefined,
        investorsContext: investorsContext || undefined,
        partnersContext: partnersContext || undefined,
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
      if (result.clientsContext) setClientsContext(result.clientsContext);
      if (result.vendorsContext) setVendorsContext(result.vendorsContext);
      if (result.insuranceContext) setInsuranceContext(result.insuranceContext);
      if (result.investorsContext) setInvestorsContext(result.investorsContext);
      if (result.partnersContext) setPartnersContext(result.partnersContext);
      toast.success("Company info extracted");
    } catch {
      toast.error("Failed to extract company info");
    } finally {
      setExtracting(false);
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

  if (viewer === undefined || orgData === undefined) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Organization info */}
      <form onSubmit={handleSave}>
        <div className="rounded-lg border border-foreground/6 bg-card mb-4">
          <div className="px-5 py-3.5 border-b border-foreground/6">
            <h3 className="!mb-0 text-sm font-medium text-foreground">Organization</h3>
          </div>
          <div className="px-5 py-5 space-y-4">
            <div>
              <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
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
              <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
                Website
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://yourcompany.com"
                    className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
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

        {/* Relationship Context section */}
        <div className="rounded-lg border border-foreground/6 bg-card mb-4">
          <div className="px-5 py-3.5 border-b border-foreground/6">
            <h3 className="!mb-0 text-sm font-medium text-foreground">Relationship Context</h3>
          </div>
          <div className="px-5 py-5 space-y-4">
            <div>
              <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
                Clients &amp; Customers
              </label>
              <input
                type="text"
                value={clientsContext}
                onChange={(e) => setClientsContext(e.target.value)}
                placeholder="e.g. Small to mid-size restaurants in the Bay Area"
                className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
              />
            </div>
            <div>
              <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
                Vendors &amp; Service Providers
              </label>
              <input
                type="text"
                value={vendorsContext}
                onChange={(e) => setVendorsContext(e.target.value)}
                placeholder="e.g. AWS for cloud, Stripe for payments, WeWork for office space"
                className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
              />
            </div>
            <div>
              <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
                Insurance Relationships
              </label>
              <input
                type="text"
                value={insuranceContext}
                onChange={(e) => setInsuranceContext(e.target.value)}
                placeholder="e.g. Marsh as broker, Hartford and Travelers as carriers"
                className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
                  Investors &amp; Shareholders
                </label>
                <input
                  type="text"
                  value={investorsContext}
                  onChange={(e) => setInvestorsContext(e.target.value)}
                  placeholder="e.g. Series A from Sequoia, angel investors"
                  className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                />
              </div>
              <div>
                <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
                  Partners &amp; Affiliates
                </label>
                <input
                  type="text"
                  value={partnersContext}
                  onChange={(e) => setPartnersContext(e.target.value)}
                  placeholder="e.g. Joint venture with ABC Corp, reseller agreement with XYZ"
                  className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Insurance Broker section */}
        <div className="rounded-lg border border-foreground/6 bg-card mb-4">
          <div className="px-5 py-3.5 border-b border-foreground/6">
            <h3 className="!mb-0 text-sm font-medium text-foreground">Insurance Broker</h3>
          </div>
          <div className="px-5 py-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
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
                <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
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
                <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
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

        {/* Domain join policy — admin only */}
        {orgData?.membership?.role === "admin" && (
          <div className="rounded-lg border border-foreground/6 bg-card mb-4">
            <div className="px-5 py-3.5 border-b border-foreground/6">
              <h3 className="!mb-0 text-sm font-medium text-foreground">Member access</h3>
            </div>
            <div className="px-5 py-5">
              <label className="text-label-sm font-medium text-muted-foreground block mb-2">
                Domain join policy
              </label>
              <p className="text-label-sm text-muted-foreground/60 mb-3">
                Controls how new users with a matching email domain join this organization.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                {(
                  [
                    { value: "approval", label: "Require approval", description: "New users must be approved by an admin." },
                    { value: "auto", label: "Auto-join", description: "Anyone with a matching domain joins automatically." },
                    { value: "off", label: "Off", description: "Domain matching disabled; invite-only." },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={async () => {
                      try {
                        await setDomainJoinPolicy({ policy: option.value });
                        toast.success("Domain join policy updated");
                      } catch {
                        toast.error("Failed to update policy");
                      }
                    }}
                    className={`flex-1 text-left px-3 py-2.5 rounded-lg border text-body-sm transition-colors cursor-pointer ${
                      org?.domainJoinPolicy === option.value
                        ? "border-foreground/15 bg-foreground/[0.03] text-foreground"
                        : "border-foreground/6 text-muted-foreground hover:border-foreground/10"
                    }`}
                  >
                    <span className="font-medium block">{option.label}</span>
                    <span className="text-label-sm text-muted-foreground/60">{option.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </form>

      {/* Onboarding section */}
      <div className="rounded-lg border border-foreground/6 bg-card">
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

    </div>
  );
}
