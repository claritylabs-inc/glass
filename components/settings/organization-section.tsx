"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { useQuery, useMutation, useAction } from "convex/react";
import type { FunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import { useCurrentOrg } from "@/hooks/use-current-org";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { AccentColorPicker } from "@/components/ui/accent-color-picker";
import { INDUSTRIES } from "@/convex/lib/industries";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { HandleAvailability } from "@/components/settings/handle-availability";
import { getPublicAgentDomain } from "@/lib/domains";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import {
  patchCachedViewerOrg,
  useCachedViewerOrg,
} from "@/lib/sync/glass-cached-queries";
import { useSyncStore } from "@claritylabs/cl-sync";
import {
  AutoSaveStatus,
  combineAutoSaveStatuses,
} from "@/components/ui/auto-save-status";
import type { AutoSaveStatus as AutoSaveStatusValue } from "@/lib/sync/use-local-first-auto-save";
import {
  OrganizationInsuranceProfile,
  type OrganizationInsuranceProfileRecord,
} from "@/components/settings/organization-insurance-profile";

const WORKSPACE_DOMAIN = getPublicAgentDomain();

type OrganizationsApi = {
  organizations: {
    updateSlug: FunctionReference<"mutation">;
    updateBrokerBranding: FunctionReference<"mutation">;
    updateOrgLogo: FunctionReference<"mutation">;
    generateOrgLogoUploadUrl: FunctionReference<"mutation">;
  };
};

const organizationsApi = api as unknown as OrganizationsApi;

type OrgSettingsArgs = {
  name?: string;
  website?: string;
  context?: string;
  industry?: string;
  industryVertical?: string;
  relatedLegalEntities?: RelatedLegalEntity[];
};

type RelatedLegalEntity = {
  legalName: string;
};

type BrandingSettingsArgs = {
  brokerOrgId: Id<"organizations">;
  whiteLabelingEnabled: boolean;
  brandingColor: string;
  brandingTextOnAccent: "auto";
};

export function OrganizationSection() {
  const orgData = useCachedViewerOrg();
  const store = useSyncStore();
  const updateOrg = useMutation(api.orgs.updateOrg);
  const extractCompanyInfo = useAction(
    api.actions.extractCompanyInfo.extractCompanyInfo,
  );

  const org = orgData?.org;

  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [industryVertical, setIndustryVertical] = useState("");
  const [relatedLegalEntities, setRelatedLegalEntities] = useState<
    RelatedLegalEntity[]
  >([]);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [profileAutoSaveStatus, setProfileAutoSaveStatus] =
    useState<AutoSaveStatusValue>("saved");
  const [brandingAutoSaveStatus, setBrandingAutoSaveStatus] =
    useState<AutoSaveStatusValue>("saved");
  const [profileCanReset, setProfileCanReset] = useState(false);
  const [restoringProfile, setRestoringProfile] = useState(false);
  const profileResetRef = useRef<(() => Promise<void>) | null>(null);
  const handleProfileAutoSaveChange = useCallback((status: AutoSaveStatusValue) => {
    setProfileAutoSaveStatus(status);
  }, []);
  const handleBrandingAutoSaveChange = useCallback((status: AutoSaveStatusValue) => {
    setBrandingAutoSaveStatus(status);
  }, []);
  const handleProfileResetActionChange = useCallback((
    resetToExtracted: (() => Promise<void>) | null,
  ) => {
    profileResetRef.current = resetToExtracted;
    setProfileCanReset(Boolean(resetToExtracted));
  }, []);
  const currentOrg = useCurrentOrg();
  const isBroker = currentOrg?.isBroker ?? false;
  const updateSlug = useMutation(organizationsApi.organizations.updateSlug);
  const currentSlug =
    (currentOrg?.org as { slug?: string } | undefined)?.slug ?? "";
  const [slug, setSlug] = useState(currentSlug);
  const [debouncedSlug, setDebouncedSlug] = useState(currentSlug);
  const [slugFocused, setSlugFocused] = useState(false);
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

  const slugAutoSave = useLocalFirstAutoSave({
    mutationName: "settings.organization.updateSlug",
    args: {
      brokerOrgId: currentOrg?.orgId as Id<"organizations">,
      slug,
    },
    valueKey: slug,
    enabled: isBroker && !!currentOrg?.orgId && settingsHydrated,
    canSave:
      slug === currentSlug ||
      (debouncedSlug.length >= 3 &&
        slug === debouncedSlug &&
        slugCheck?.available === true),
    autoSave: !slugFocused,
    delayMs: 0,
    flush: (args) => updateSlug(args),
    onFlushed: (normalized, args) => {
      const savedSlug = normalized ?? args.slug;
      setSlug(savedSlug);
      setDebouncedSlug(savedSlug);
      patchCachedViewerOrg(store, { slug: savedSlug });
    },
    errorMessage: (error) =>
      error instanceof Error ? error.message : "The workspace link could not be saved.",
  });

  const { setActions } = useSettingsActions();

  useEffect(() => {
    if (org && !hydratedRef.current) {
      setName(org.name ?? "");
      setWebsite(org.website ?? "");
      setIndustry(org.industry ?? "");
      setIndustryVertical(org.industryVertical ?? "");
      setRelatedLegalEntities(org.relatedLegalEntities ?? []);
      hydratedRef.current = true;
      setSettingsHydrated(true);
    }
  }, [org]);

  const orgSettingsArgs: OrgSettingsArgs = {
    name: name || undefined,
    website: website || undefined,
    industry: industry || undefined,
    industryVertical: industryVertical || undefined,
    relatedLegalEntities: relatedLegalEntities
      .map((entity) => ({
        legalName: entity.legalName.trim(),
      }))
      .filter((entity) => entity.legalName),
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
    autoSave: false,
    applyLocal: (store, args) => patchCachedViewerOrg(store, args),
    flush: saveOrgSettings,
    errorMessage: "Organization settings could not be saved.",
  });
  const saveOrgSettingsNow = orgAutoSave.saveNow;

  const saveOrgSettingsAfterChange = useCallback(() => {
    requestAnimationFrame(() => {
      void saveOrgSettingsNow();
    });
  }, [saveOrgSettingsNow]);

  const organizationSaveStatus = combineAutoSaveStatuses(
    orgAutoSave.status,
    slugAutoSave.status,
    profileAutoSaveStatus,
    brandingAutoSaveStatus,
  );

  const handleUseExtracted = useCallback(async () => {
    const resetToExtracted = profileResetRef.current;
    if (!resetToExtracted) return;
    setRestoringProfile(true);
    try {
      await resetToExtracted();
    } catch {
      toast.error("Extracted profile could not be restored");
    } finally {
      setRestoringProfile(false);
    }
  }, []);

  useEffect(() => {
    setActions(
      <div className="flex items-center gap-3">
        <AutoSaveStatus status={organizationSaveStatus} />
        {profileCanReset ? (
          <PillButton
            type="button"
            variant="secondary"
            size="compact"
            onClick={() => void handleUseExtracted()}
            disabled={restoringProfile || profileAutoSaveStatus === "saving"}
          >
            {restoringProfile ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RotateCcw className="size-3.5" />
            )}
            {restoringProfile ? "Restoring…" : "Use extracted"}
          </PillButton>
        ) : null}
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
  }, [
    organizationSaveStatus,
    extracting,
    handleUseExtracted,
    profileAutoSaveStatus,
    profileCanReset,
    restoringProfile,
    website,
  ]);

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
      const extractedFields: OrgSettingsArgs = {
        context: result.companyContext || undefined,
        industry: result.industry || undefined,
        industryVertical: result.industryVertical || undefined,
      };
      await updateOrg(extractedFields);
      patchCachedViewerOrg(store, extractedFields);
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

  function updateRelatedLegalEntity(
    index: number,
    patch: Partial<RelatedLegalEntity>,
  ) {
    setRelatedLegalEntities((current) =>
      current.map((entity, entityIndex) =>
        entityIndex === index ? { ...entity, ...patch } : entity,
      ),
    );
  }

  function addRelatedLegalEntity() {
    setRelatedLegalEntities((current) => [
      ...current,
      { legalName: "" },
    ]);
  }

  function removeRelatedLegalEntity(index: number) {
    setRelatedLegalEntities((current) =>
      current.filter((_, entityIndex) => entityIndex !== index),
    );
    saveOrgSettingsAfterChange();
  }

  if (orgData === undefined) {
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
        <>
          <OperationalPanel className="mb-4">
            <OperationalPanelHeader title="Organization" className="px-5 py-3.5" />
            <OperationalPanelBody className="space-y-4 px-5 py-5">
            <div>
              <label className="text-label font-medium text-muted-foreground block mb-1.5">
                Organization Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => void saveOrgSettingsNow()}
                placeholder="Acme Corp"
                className="h-9 w-full rounded-lg border border-foreground/8 bg-popover px-3 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
              />
            </div>

            {isBroker && (
              <div>
                <label className="text-label font-medium text-muted-foreground block mb-1.5">
                  Workspace link
                </label>
                <div className="flex items-stretch gap-0">
                  <span className="inline-flex items-center rounded-l-lg border border-r-0 border-foreground/8 bg-foreground/3 px-3 text-base text-muted-foreground select-none whitespace-nowrap">
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
                    onFocus={() => setSlugFocused(true)}
                    onBlur={() => setSlugFocused(false)}
                    placeholder="my-brokerage"
                    className="h-9 flex-1 min-w-0 rounded-r-lg border border-foreground/8 bg-popover px-3 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                  />
                </div>
                <HandleAvailability
                  saving={slugAutoSave.saving}
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
              <label className="text-label font-medium text-muted-foreground  block mb-1.5">
                Website
              </label>
              <input
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                onBlur={() => void saveOrgSettingsNow()}
                placeholder="https://yourcompany.com"
                className="h-9 w-full rounded-lg border border-foreground/8 bg-popover px-3 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
              />
            </div>

            <div className="space-y-3 rounded-lg border border-foreground/6 bg-popover px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label className="text-label font-medium text-muted-foreground block">
                    Legal names and related entities
                  </label>
                </div>
                <PillButton
                  type="button"
                  size="compact"
                  variant="secondary"
                  onClick={addRelatedLegalEntity}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </PillButton>
              </div>
              {relatedLegalEntities.length === 0 ? (
                <p className="text-base text-muted-foreground/70">
                  No related legal entities listed.
                </p>
              ) : (
                <div className="space-y-3">
                  {relatedLegalEntities.map((entity, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={entity.legalName}
                        onChange={(event) =>
                          updateRelatedLegalEntity(index, {
                            legalName: event.target.value,
                          })
                        }
                        onBlur={() => void saveOrgSettingsNow()}
                        placeholder="Alternate legal name, DBA, FKA, parent, subsidiary, or affiliate"
                        className="h-9 min-w-0 flex-1 rounded-lg border border-foreground/8 bg-popover px-3 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => removeRelatedLegalEntity(index)}
                        className="inline-flex h-9 w-10 items-center justify-center rounded-lg border border-foreground/8 text-muted-foreground transition-colors hover:bg-foreground/4 hover:text-foreground"
                        aria-label="Remove legal entity"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!isBroker && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-label font-medium text-muted-foreground  block mb-1.5">
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
                      saveOrgSettingsAfterChange();
                    }}
                    placeholder="Select industry..."
                  />
                </div>
                <div>
                  <label className="text-label font-medium text-muted-foreground  block mb-1.5">
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
                    onChange={(value) => {
                      setIndustryVertical(value);
                      saveOrgSettingsAfterChange();
                    }}
                    placeholder="Select vertical..."
                    disabled={!industry}
                  />
                </div>
              </div>
            )}

            {!isBroker && org ? (
              <OrganizationInsuranceProfile
                key={String(org._id)}
                org={org as unknown as OrganizationInsuranceProfileRecord}
                disabled={orgData.membership.role !== "admin"}
                onAutoSaveChange={handleProfileAutoSaveChange}
                onResetActionChange={handleProfileResetActionChange}
              />
            ) : null}

            </OperationalPanelBody>
          </OperationalPanel>

          <BrandingCard
            website={website}
            onAutoSaveChange={handleBrandingAutoSaveChange}
          />
        </>

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Branding card
// ─────────────────────────────────────────────────────────────────────────────

const brandingLabelClass =
  "text-label font-medium text-muted-foreground block mb-1.5";

type BrandingMode = "light" | "dark";
type TextOnAccent = "light" | "dark" | "auto";

function BrandingCard({
  website,
  onAutoSaveChange,
}: {
  website: string;
  onAutoSaveChange: (
    status: AutoSaveStatusValue,
    saveNow: (() => Promise<boolean>) | null,
  ) => void;
}) {
  const currentOrg = useCurrentOrg();
  const store = useSyncStore();
  const isBroker = currentOrg?.isBroker ?? false;
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
    organizationsApi.organizations.generateOrgLogoUploadUrl,
  );
  const updateOrgLogo = useMutation(organizationsApi.organizations.updateOrgLogo);
  const importOrgLogo = useAction(
    api.actions.extractCompanyInfo.importOrgLogoFromWebsite,
  );

  const [brandingColor, setBrandingColor] = useState("#1E293B");
  const [whiteLabelingEnabled, setWhiteLabelingEnabled] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [importingLogo, setImportingLogo] = useState(false);
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

  const brandingArgs: BrandingSettingsArgs | null = orgId && isBroker
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

  const brandingAutoSave = useLocalFirstAutoSave({
    mutationName: "settings.organization.updateBranding",
    args: brandingArgs ?? {
      brokerOrgId: "" as Id<"organizations">,
      whiteLabelingEnabled,
      brandingColor,
      brandingTextOnAccent: "auto",
    },
    enabled: brandingHydrated && isBroker,
    canSave: !!brandingArgs,
    applyLocal: (store, args) =>
      patchCachedViewerOrg(store, {
        whiteLabelingEnabled: args.whiteLabelingEnabled,
        brandingColor: args.brandingColor,
        brandingTextOnAccent: args.brandingTextOnAccent,
    }),
    flush: saveBranding,
    errorMessage: "Brand settings could not be saved.",
  });

  useEffect(() => {
    onAutoSaveChange(brandingAutoSave.status, brandingAutoSave.saveNow);
    return () => onAutoSaveChange("saved", null);
  }, [brandingAutoSave.saveNow, brandingAutoSave.status, onAutoSaveChange]);

  async function handleLogoUpload(file: File) {
    if (!orgId) return;
    try {
      const uploadUrl = await generateUploadUrl({ orgId });
      const res = await fetch(uploadUrl, {
        method: "POST",
        body: file,
        headers: { "Content-Type": file.type },
      });
      const { storageId } = await res.json();
      await updateOrgLogo({ orgId, logoStorageId: storageId });
      patchCachedViewerOrg(store, { iconStorageId: storageId });
    } catch {
      toast.error("Failed to upload logo");
    }
  }

  async function handlePullLogo() {
    if (!orgId || !website.trim()) {
      toast.error("Add a website first");
      return;
    }
    setImportingLogo(true);
    try {
      const result = await importOrgLogo({ orgId, url: website });
      if (!result.success || !result.iconStorageId) {
        throw new Error(result.error ?? "Logo not found");
      }
      patchCachedViewerOrg(store, { iconStorageId: result.iconStorageId });
      toast.success("Logo pulled from website");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to pull logo");
    } finally {
      setImportingLogo(false);
    }
  }

  const logoUrl = org?.iconUrl
    ? org.iconUrl
    : org?.iconStorageId
      ? `/api/storage/${org.iconStorageId}`
      : null;

  return (
    <OperationalPanel as="div" className="mb-4">
      <OperationalPanelHeader
        title="Brand"
        className="px-5 py-3.5"
      />
      <OperationalPanelBody className="space-y-5 px-5 py-5">
        {isBroker && (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-foreground/6 bg-popover px-4 py-3">
            <div>
              <p className="text-base font-medium text-foreground">
                White labeling
              </p>
              <p className="text-label text-muted-foreground/60 mt-0.5 max-w-md">
                Apply your broker logo, accent color, agent name, and branded
                emails to client-facing surfaces.
              </p>
            </div>
            <SettingsSwitch
              checked={whiteLabelingEnabled}
              onCheckedChange={() => setWhiteLabelingEnabled((v) => !v)}
              label="Enable white labeling"
              className="ml-4"
            />
          </div>
        )}

        {/* Logo */}
        <div className={isBroker && !whiteLabelingEnabled ? "opacity-50" : undefined}>
          <label className={brandingLabelClass}>Logo</label>
          <button
            type="button"
            disabled={isBroker && !whiteLabelingEnabled}
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
              isBroker && !whiteLabelingEnabled ? "cursor-not-allowed" : ""
            } ${
              dragActive && (!isBroker || whiteLabelingEnabled)
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
                <span className="text-label text-muted-foreground/60">
                  —
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-medium text-foreground">
                {logoUrl ? "Replace logo" : "Upload logo"}
              </div>
              <div className="text-label text-muted-foreground/70">
                Drop an image, click to browse, or pull it from the website.
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
          <div className="mt-3">
            <PillButton
              variant="secondary"
              onClick={handlePullLogo}
              disabled={importingLogo || (isBroker && !whiteLabelingEnabled)}
            >
              {importingLogo ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              Pull from website
            </PillButton>
          </div>
        </div>

        {/* Accent color */}
        {isBroker && (
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
        )}
      </OperationalPanelBody>
    </OperationalPanel>
  );
}
