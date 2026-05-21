"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { useQuery, useMutation, useAction } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { useCurrentOrg } from "@/hooks/use-current-org";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Loader2, AlertTriangle, RotateCcw } from "lucide-react";
import { AccentColorPicker } from "@/components/ui/accent-color-picker";
import { INDUSTRIES } from "@/convex/lib/industries";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { HandleAvailability } from "@/components/settings/handle-availability";
import { getPublicAgentDomain } from "@/lib/domains";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { patchCachedViewerOrg } from "@/lib/sync/glass-cached-queries";

const WORKSPACE_DOMAIN = getPublicAgentDomain();

type OrganizationsApi = {
  organizations: {
    updateSlug: FunctionReference<"mutation">;
    updateBrokerBranding: FunctionReference<"mutation">;
    generateLogoUploadUrl: FunctionReference<"mutation">;
  };
};

const organizationsApi = api as unknown as OrganizationsApi;

type OrgSettingsArgs = {
  name?: string;
  website?: string;
  context?: string;
  industry?: string;
  industryVertical?: string;
  clientsContext?: string;
  vendorsContext?: string;
  insuranceContext?: string;
  investorsContext?: string;
  partnersContext?: string;
};

type BrandingSettingsArgs = {
  brokerOrgId: Id<"organizations">;
  whiteLabelingEnabled: boolean;
  brandingColor: string;
  brandingTextOnAccent: "auto";
};

export function OrganizationSection() {
  const viewer = useQuery(api.users.viewer);
  const orgData = useQuery(api.orgs.viewerOrg, {});
  const updateOrg = useMutation(api.orgs.updateOrg);
  const resetAccount = useMutation(api.users.resetAccount);
  const restartOnboarding = useMutation(api.users.restartOnboarding);
  const extractCompanyInfo = useAction(
    api.actions.extractCompanyInfo.extractCompanyInfo,
  );
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
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const currentOrg = useCurrentOrg();
  const isBroker = currentOrg?.isBroker ?? false;
  const updateSlug = useMutation(organizationsApi.organizations.updateSlug);
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

  const [extracting, setExtracting] = useState(false);
  const hydratedRef = useRef(false);
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

  const { setActions, setRightPanel } = useSettingsActions();

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
      setSettingsHydrated(true);
    }
  }, [org]);

  useEffect(() => {
    autoResize();
  }, [context, autoResize]);

  const orgSettingsArgs: OrgSettingsArgs = {
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
  };

  const saveOrgSettings = useCallback(
    async (args: OrgSettingsArgs) => {
      await updateOrg(args);
    },
    [updateOrg],
  );

  const orgAutoSave = useLocalFirstAutoSave({
    mutationName: "settings.organization.updateOrg",
    args: orgSettingsArgs,
    enabled: settingsHydrated,
    applyLocal: (store, args) => patchCachedViewerOrg(store, args),
    flush: saveOrgSettings,
    onError: () => toast.error("Failed to save settings"),
  });

  const saving = orgAutoSave.saving;
  const savedAt = orgAutoSave.savedAt;

  useEffect(() => {
    setActions(
      <div className="flex items-center gap-3">
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
        <PillButton
          variant="secondary"
          size="compact"
          onClick={handleExtract}
          disabled={extracting || !website}
        >
          {extracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {extracting ? "Extracting…" : "Extract from website"}
        </PillButton>
      </div>,
    );
    return () => setActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, savedAt, extracting, website]);

  useEffect(() => {
    setRightPanel(
      <SettingsDrawer
        open={showResetDialog}
        onOpenChange={(v) => setShowResetDialog(v)}
        title="Reset organization"
        footer={
          <>
            <PillButton
              variant="secondary"
              onClick={() => setShowResetDialog(false)}
              disabled={resetting}
            >
              Cancel
            </PillButton>
            <PillButton
              variant="destructive"
              onClick={handleReset}
              disabled={resetting}
            >
              {resetting ? "Resetting…" : "Yes, reset everything"}
            </PillButton>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-body-sm text-muted-foreground">
            This will permanently delete all policies (including stored files),
            emails, connections, and conversations for your organization. This
            action cannot be undone.
          </p>
        </div>
      </SettingsDrawer>,
    );
    return () => setRightPanel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResetDialog, resetting]);

  async function handleExtract() {
    if (!website) return;
    setExtracting(true);
    try {
      let url = website;
      if (!url.startsWith("http")) url = "https://" + url;
      // Persist the current website immediately so the server-side extract
      // and the re-fetched org reflect what the user actually typed.
      await updateOrg({ website: url });
      setWebsite(url);
      // Synchronous await is intentional — website scrape typically < 5s.
      // Not a long-running pipeline; cl-pipelines not required here.
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
            <h3 className="mb-0! text-sm font-medium text-foreground">
              Organization
            </h3>
          </div>
          <div className="px-5 py-5 space-y-4">
            <div>
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

            {isBroker && (
              <div>
                <label className="text-label-sm font-medium text-muted-foreground block mb-1.5">
                  Workspace link
                </label>
                <div className="flex items-stretch gap-0">
                  <span className="inline-flex items-center rounded-l-lg border border-r-0 border-foreground/8 bg-foreground/3 px-3 text-body-sm text-muted-foreground select-none whitespace-nowrap">
                    {WORKSPACE_DOMAIN}/
                  </span>
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
                <HandleAvailability
                  saving={savingSlug}
                  checking={slugChecking}
                  input={slug}
                  current={currentSlug}
                  availability={slug === debouncedSlug ? slugCheck : undefined}
                  currentLabel="Current workspace link"
                  renderAvailablePreview={(s) =>
                    `${WORKSPACE_DOMAIN}/${s} is available`
                  }
                />
              </div>
            )}

            <div>
              <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
                Website
              </label>
              <input
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://yourcompany.com"
                className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
              />
            </div>

            {!isBroker && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
                    Industry
                  </label>
                  <SearchableSelect
                    options={INDUSTRIES.map((ind) => ({
                      value: ind.value,
                      label: ind.label,
                    }))}
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
                    options={
                      INDUSTRIES.find(
                        (i) => i.value === industry,
                      )?.verticals.map((v) => ({
                        value: v.value,
                        label: v.label,
                      })) ?? []
                    }
                    value={industryVertical}
                    onChange={setIndustryVertical}
                    placeholder="Select vertical..."
                    disabled={!industry}
                  />
                </div>
              </div>
            )}

            {!isBroker && (
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
            )}
          </div>
        </div>

        {isBroker && <BrandingCard website={website} />}

        {/* Relationship Context section — client orgs only */}
        {!isBroker && (
          <div className="rounded-lg border border-foreground/6 bg-card mb-4">
            <div className="px-5 py-3.5 border-b border-foreground/6">
              <h3 className="mb-0! text-sm font-medium text-foreground">
                Relationship Context
              </h3>
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
        )}
      </div>

      {/* Onboarding section */}
      <div className="rounded-lg border border-foreground/6 bg-card">
        <div className="px-5 py-3.5 border-b border-foreground/6">
          <h3 className="mb-0! text-sm font-medium text-foreground">
            Onboarding
          </h3>
        </div>
        <div className="px-5 py-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-body-sm font-medium text-foreground">
                Re-run Setup
              </p>
              <p className="text-label-sm text-muted-foreground mt-0.5">
                Walk through the onboarding steps again. Your existing data will
                not be affected.
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
              <h3 className="mb-0! text-sm font-medium text-red-900 dark:text-red-400">
                Danger Zone
              </h3>
            </div>
            <div className="px-5 py-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-body-sm font-medium text-foreground">
                    Reset Organization
                  </p>
                  <p className="text-label-sm text-muted-foreground mt-0.5">
                    Delete all policies, emails, connections, and conversations.
                    This cannot be undone.
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
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Branding card (broker only)
// ─────────────────────────────────────────────────────────────────────────────

const brandingLabelClass =
  "text-label-sm font-medium text-muted-foreground block mb-1.5";

type BrandingMode = "light" | "dark";
type TextOnAccent = "light" | "dark" | "auto";

function BrandingCard({ website }: { website: string }) {
  const currentOrg = useCurrentOrg();
  const org = currentOrg?.org as
    | {
        brandingColor?: string;
        whiteLabelingEnabled?: boolean;
        brandingMode?: BrandingMode;
        brandingTextOnAccent?: TextOnAccent;
        iconStorageId?: string;
        iconUrl?: string | null;
      }
    | undefined;
  const orgId = currentOrg?.orgId as Id<"organizations"> | undefined;

  const updateBranding = useMutation(
    organizationsApi.organizations.updateBrokerBranding,
  );
  const generateUploadUrl = useMutation(
    organizationsApi.organizations.generateLogoUploadUrl,
  );

  const [brandingColor, setBrandingColor] = useState("#1E293B");
  const [whiteLabelingEnabled, setWhiteLabelingEnabled] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hydratedRef = useRef(false);
  const [brandingHydrated, setBrandingHydrated] = useState(false);

  useEffect(() => {
    if (org && !hydratedRef.current) {
      setBrandingColor(org.brandingColor ?? "#1E293B");
      setWhiteLabelingEnabled(org.whiteLabelingEnabled !== false);
      hydratedRef.current = true;
      setBrandingHydrated(true);
    }
  }, [org]);

  const brandingArgs: BrandingSettingsArgs | null = orgId
    ? {
        brokerOrgId: orgId,
        whiteLabelingEnabled,
        brandingColor,
        brandingTextOnAccent: "auto",
      }
    : null;

  const saveBranding = useCallback(
    async (args: BrandingSettingsArgs) => {
      await updateBranding(args);
    },
    [updateBranding],
  );

  useLocalFirstAutoSave({
    mutationName: "settings.organization.updateBranding",
    args: brandingArgs ?? {
      brokerOrgId: "" as Id<"organizations">,
      whiteLabelingEnabled,
      brandingColor,
      brandingTextOnAccent: "auto",
    },
    enabled: brandingHydrated,
    canSave: !!brandingArgs,
    applyLocal: (store, args) =>
      patchCachedViewerOrg(store, {
        whiteLabelingEnabled: args.whiteLabelingEnabled,
        brandingColor: args.brandingColor,
        brandingTextOnAccent: args.brandingTextOnAccent,
      }),
    flush: saveBranding,
    onError: () => toast.error("Failed to save branding"),
  });

  async function handleLogoUpload(file: File) {
    if (!orgId) return;
    try {
      const uploadUrl = await generateUploadUrl({ brokerOrgId: orgId });
      const res = await fetch(uploadUrl, {
        method: "POST",
        body: file,
        headers: { "Content-Type": file.type },
      });
      const { storageId } = await res.json();
      await updateBranding({ brokerOrgId: orgId, logoStorageId: storageId });
    } catch {
      toast.error("Failed to upload logo");
    }
  }

  const logoUrl = org?.iconUrl
    ? org.iconUrl
    : org?.iconStorageId
      ? `/api/storage/${org.iconStorageId}`
      : null;

  return (
    <div className="rounded-lg border border-foreground/6 bg-card mb-4">
      <div className="px-5 py-3.5 border-b border-foreground/6">
        <h3 className="mb-0! text-sm font-medium text-foreground">Brand</h3>
      </div>
      <div className="px-5 py-5 space-y-5">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-foreground/6 bg-popover px-4 py-3">
          <div>
            <p className="text-body-sm font-medium text-foreground">
              White labeling
            </p>
            <p className="text-label-sm text-muted-foreground/60 mt-0.5 max-w-md">
              Apply your broker logo, accent color, agent name, and branded
              emails to client-facing surfaces.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setWhiteLabelingEnabled((v) => !v)}
            role="switch"
            aria-checked={whiteLabelingEnabled}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/10 shrink-0 ml-4 ${
              whiteLabelingEnabled ? "bg-foreground" : "bg-foreground/15"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                whiteLabelingEnabled ? "translate-x-4.5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {/* Logo */}
        <div className={!whiteLabelingEnabled ? "opacity-50" : undefined}>
          <label className={brandingLabelClass}>Logo</label>
          <button
            type="button"
            disabled={!whiteLabelingEnabled}
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleLogoUpload(file);
            }}
            className={`flex w-full items-center gap-4 rounded-lg border border-dashed px-4 py-3 text-left transition-colors ${
              whiteLabelingEnabled ? "" : "cursor-not-allowed"
            } ${
              dragActive && whiteLabelingEnabled
                ? "border-foreground/30 bg-foreground/3"
                : "border-foreground/12 bg-popover hover:border-foreground/20"
            }`}
          >
            <div className="h-10 w-10 rounded-md border border-foreground/8 bg-white flex items-center justify-center overflow-hidden shrink-0">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt="Logo"
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="text-label-sm text-muted-foreground/60">
                  —
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-body-sm font-medium text-foreground">
                {logoUrl ? "Replace logo" : "Upload logo"}
              </div>
              <div className="text-label-sm text-muted-foreground/70">
                Drop an image, or click to browse. Auto-filled from your
                website.
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleLogoUpload(file);
              }}
            />
          </button>
        </div>

        {/* Accent color */}
        <div
          className={
            !whiteLabelingEnabled ? "pointer-events-none opacity-50" : undefined
          }
        >
          <label className={brandingLabelClass}>Accent color</label>
          <AccentColorPicker
            value={brandingColor}
            onChange={setBrandingColor}
            website={website}
          />
        </div>
      </div>
    </div>
  );
}
