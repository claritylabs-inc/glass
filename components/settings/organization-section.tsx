"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSettingsActions } from "@/app/settings/page";
import { useQuery, useMutation, useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { useCurrentOrg } from "@/hooks/use-current-org";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Loader2,
  Sparkles,
  AlertTriangle,
  RotateCcw,
  Check,
  X,
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

const WORKSPACE_DOMAIN =
  process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "glass.claritylabs.inc";

export function OrganizationSection() {
  const viewer = useQuery(api.users.viewer);
  const orgData = useQuery(api.orgs.viewerOrg, {});
  const updateOrg = useMutation(api.orgs.updateOrg);
  const resetAccount = useMutation(api.users.resetAccount);
  const restartOnboarding = useMutation(api.users.restartOnboarding);
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
  const currentOrg = useCurrentOrg();
  const isBroker = currentOrg?.isBroker ?? false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateSlug = useMutation((api as any).organizations.updateSlug);
  const currentSlug =
    (currentOrg?.org as { slug?: string } | undefined)?.slug ?? "";
  const [slug, setSlug] = useState(currentSlug);
  const [debouncedSlug, setDebouncedSlug] = useState(currentSlug);
  const [savingSlug, setSavingSlug] = useState(false);
  const slugHydratedRef = useRef(false);

  useEffect(() => {
    if (!slugHydratedRef.current && currentSlug) {
      setSlug(currentSlug);
      setDebouncedSlug(currentSlug);
      slugHydratedRef.current = true;
    }
  }, [currentSlug]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSlug(slug), 300);
    return () => clearTimeout(t);
  }, [slug]);

  const slugCheck = useQuery(
    api.orgs.checkSlugAvailability,
    debouncedSlug.length >= 3 && debouncedSlug !== currentSlug
      ? { slug: debouncedSlug }
      : "skip",
  );
  const slugChecking =
    isBroker &&
    slug.length >= 3 &&
    slug !== currentSlug &&
    (slug !== debouncedSlug || slugCheck === undefined);

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [extracting, setExtracting] = useState(false);
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Auto-save slug when debounced value is valid, available, and differs from current.
  useEffect(() => {
    if (!isBroker) return;
    if (!currentOrg?.orgId) return;
    if (debouncedSlug.length < 3) return;
    if (debouncedSlug === currentSlug) return;
    if (slug !== debouncedSlug) return;
    if (!slugCheck || !slugCheck.available) return;
    let cancelled = false;
    (async () => {
      setSavingSlug(true);
      try {
        const normalized = await updateSlug({
          brokerOrgId: currentOrg.orgId as Id<"organizations">,
          slug: debouncedSlug,
        });
        if (!cancelled) {
          setSlug(normalized);
          setDebouncedSlug(normalized);
          toast.success("Slug saved");
        }
      } catch (err) {
        if (!cancelled) toast.error(String(err));
      } finally {
        if (!cancelled) setSavingSlug(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isBroker,
    debouncedSlug,
    slug,
    currentSlug,
    slugCheck,
    currentOrg?.orgId,
    updateSlug,
  ]);

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
    if (org && !hydratedRef.current) {
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
      hydratedRef.current = true;
    }
  }, [org]);

  useEffect(() => { autoResize(); }, [context, autoResize]);

  const saveNow = useCallback(async () => {
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
      });
      setSavedAt(Date.now());
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }, [
    updateOrg,
    name, website, context, industry, industryVertical,
    clientsContext, vendorsContext, insuranceContext, investorsContext, partnersContext,
  ]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { void saveNow(); }, 600);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [saveNow]);

  useEffect(() => {
    setActions(
      <span className="text-label-sm text-muted-foreground flex items-center gap-1.5">
        {saving ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" />
            Saving
          </>
        ) : savedAt ? (
          "Saved"
        ) : null}
      </span>
    );
    return () => setActions(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, savedAt]);

  async function handleExtract() {
    if (!website) return;
    setExtracting(true);
    try {
      let url = website;
      if (!url.startsWith("http")) url = "https://" + url;
      // Persist the current website immediately so the server-side extract
      // and the re-fetched org reflect what the user actually typed.
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      await updateOrg({ website: url });
      setWebsite(url);
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
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Organization info */}
      <div>
        <div className="rounded-lg border border-foreground/6 bg-card mb-4">
          <div className="px-5 py-3.5 border-b border-foreground/6">
            <h3 className="!mb-0 text-sm font-medium text-foreground">Organization</h3>
          </div>
          <div className="px-5 py-5 space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-[3.75rem] h-[3.75rem] rounded-lg border border-foreground/8 bg-popover flex items-center justify-center overflow-hidden shrink-0">
                {org?.iconUrl ? (
                  <img src={org.iconUrl} alt="" className="w-full h-full object-contain bg-white" />
                ) : (
                  <span className="text-body-sm font-medium text-muted-foreground/60">
                    {(name || "?").slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex-1">
                <label className="text-label-sm font-medium text-muted-foreground block mb-1.5">
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
            </div>

            {isBroker && (
              <div>
                <label className="text-label-sm font-medium text-muted-foreground block mb-1.5">
                  Workspace link
                </label>
                <div className="flex items-stretch gap-0 max-w-md">
                  <div className="flex items-center rounded-l-lg border border-r-0 border-foreground/8 bg-foreground/[0.02] px-3 py-2 text-label-sm text-muted-foreground/60 select-none whitespace-nowrap">
                    {WORKSPACE_DOMAIN}/
                  </div>
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) =>
                      setSlug(
                        e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                      )
                    }
                    placeholder="my-brokerage"
                    className="flex-1 min-w-0 rounded-r-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                  />
                </div>
                <div className="flex items-center gap-2 min-h-[20px] pt-1">
                  {savingSlug ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                      <span className="text-label-sm text-muted-foreground">Saving…</span>
                    </>
                  ) : slugChecking ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                      <span className="text-label-sm text-muted-foreground">Checking…</span>
                    </>
                  ) : slug.length >= 3 &&
                    slug === currentSlug ? (
                    <span className="text-label-sm text-muted-foreground/60">
                      Current workspace link
                    </span>
                  ) : !slugChecking &&
                    debouncedSlug.length >= 3 &&
                    debouncedSlug !== currentSlug &&
                    slugCheck?.available ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-body-sm text-emerald-600">
                        {WORKSPACE_DOMAIN}/{debouncedSlug} is available
                      </span>
                    </>
                  ) : !slugChecking &&
                    debouncedSlug.length >= 3 &&
                    debouncedSlug !== currentSlug &&
                    slugCheck &&
                    !slugCheck.available ? (
                    <>
                      <X className="w-3.5 h-3.5 text-red-500" />
                      <span className="text-body-sm text-red-500">
                        {slugCheck.reason ?? "Not available"}
                      </span>
                    </>
                  ) : slug.length > 0 && slug.length < 3 ? (
                    <span className="text-body-sm text-muted-foreground/50">
                      Minimum 3 characters
                    </span>
                  ) : null}
                </div>
              </div>
            )}

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

      </div>

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
