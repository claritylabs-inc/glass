"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useAction } from "convex/react";
import type { AddressAutofillRetrieveResponse } from "@mapbox/search-js-core";
import type { Theme as MapboxSearchTheme } from "@mapbox/search-js-web";
import dayjs from "dayjs";
import { BadgeCheck, Eye, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  OperationalPanel,
  OperationalPanelBody,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

import { usePdf } from "@/components/pdf-context";

const AddressAutofill = dynamic(
  () =>
    import("@mapbox/search-js-react").then((module) => ({
      default: module.AddressAutofill,
    })),
  { ssr: false },
);

const MAPBOX_ACCESS_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const MAPBOX_ADDRESS_AUTOFILL_THEME = {
  variables: {
    unit: "14px",
    minWidth: "min(388px, calc(100vw - 32px))",
    spacing: "0",
    padding: "8px",
    paddingFooterLabel: "8px 10px",
    colorText: "var(--popover-foreground)",
    colorPrimary: "var(--primary)",
    colorSecondary: "var(--muted-foreground)",
    colorBackground: "var(--popover)",
    colorBackgroundHover: "var(--accent)",
    colorBackgroundActive: "var(--secondary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow: "0 16px 40px rgba(0, 0, 0, 0.35)",
    fontFamily: "inherit",
    fontWeight: "400",
    fontWeightSemibold: "500",
    fontWeightBold: "500",
    lineHeight: "1.35",
  },
  cssText: `
    .MapboxSearchListbox {
      overflow: hidden;
    }

    .MapboxSearchListbox * {
      letter-spacing: 0;
    }
  `,
} satisfies MapboxSearchTheme;

const US_STATE_ABBREVIATIONS: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

function normalizeUsState(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return US_STATE_ABBREVIATIONS[trimmed.toLowerCase()] ?? trimmed;
}

function firstMapboxAddressFeature(response: AddressAutofillRetrieveResponse) {
  return response.features[0]?.properties;
}

export function ViewPdfButton({
  url,
  disabled = false,
}: {
  url?: string | null;
  disabled?: boolean;
}) {
  const { isPdfOpen, togglePdf, openWithUrl } = usePdf();
  if (!url) return null;
  return (
    <PillButton
      variant="icon"
      size="compact"
      label={isPdfOpen ? "Hide PDF" : "View PDF"}
      disabled={disabled}
      onClick={() => (isPdfOpen ? togglePdf() : openWithUrl(url))}
      className="hidden lg:inline-flex"
    >
      <Eye className="size-4 shrink-0" />
    </PillButton>
  );
}

function formatCertificateTimestamp(value: number) {
  return dayjs(value).format("MMM D, YYYY h:mm A");
}

export type ProgramMatchCandidate = {
  programId?: Id<"partnerPrograms">;
  programName?: string;
  _id?: Id<"partnerPrograms">;
  name?: string;
  categoryLabels?: string[];
  approvalMode?: string;
  score?: number;
};

const CERTIFICATE_ENDORSEMENT_OPTIONS = [
  { value: "additional_insured", label: "Additional insured" },
  { value: "waiver_of_subrogation", label: "Waiver" },
  { value: "primary_non_contributory", label: "Primary/non-contributory" },
  { value: "loss_payee", label: "Loss payee" },
  { value: "mortgagee", label: "Mortgagee" },
];

function normalizeProgramMatchCandidate(candidate: ProgramMatchCandidate) {
  const programId = candidate.programId ?? candidate._id;
  if (!programId) return null;
  return {
    ...candidate,
    programId,
    programName: candidate.programName ?? candidate.name ?? "Program",
  };
}

export type InitialCertificateHolder = {
  holderName?: string;
  certificateHolder?: string;
  explicitReissue?: boolean;
};

function holderKey(value: string | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function CertificateCreatePanel({
  open,
  onOpenChange,
  policyId,
  initialProgram,
  initialHolder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: Id<"policies">;
  initialProgram?: ProgramMatchCandidate | null;
  initialHolder?: InitialCertificateHolder | null;
}) {
  const generateCertificate = useAction(api.certificates.generateForPolicy);
  const previewCertificateAuthority = useAction(
    api.certificates.previewAuthorityForPolicy,
  );
  const { openWithUrl } = usePdf();
  const holderCandidates = useCachedQuery(
    "certificates.listHolderCandidatesForPolicy",
    api.certificates.listHolderCandidatesForPolicy,
    open ? { policyId } : "skip",
  ) as Array<Record<string, unknown>> | undefined;
  const initialProgramCandidate = useMemo(
    () => normalizeProgramMatchCandidate(initialProgram ?? {}),
    [initialProgram],
  );
  const [holderName, setHolderName] = useState(initialHolder?.holderName ?? "");
  const [holderSearchFocused, setHolderSearchFocused] = useState(false);
  const [explicitReissue, setExplicitReissue] = useState(
    Boolean(initialHolder?.explicitReissue),
  );
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [selectedPartnerProgramId, setSelectedPartnerProgramId] = useState<
    Id<"partnerPrograms"> | undefined
  >(initialProgramCandidate?.programId);
  const [requestedEndorsements, setRequestedEndorsements] = useState<string[]>(
    [],
  );
  const [programCandidates, setProgramCandidates] = useState<
    ProgramMatchCandidate[]
  >(() => (initialProgramCandidate ? [initialProgramCandidate] : []));
  const [resolvingProgram, setResolvingProgram] = useState(false);
  const [generating, setGenerating] = useState(false);

  const reset = () => {
    setHolderName("");
    setHolderSearchFocused(false);
    setExplicitReissue(false);
    setAddressLine1("");
    setAddressLine2("");
    setCity("");
    setState("");
    setPostalCode("");
    setRequestedEndorsements([]);
    setSelectedPartnerProgramId(initialProgramCandidate?.programId);
    setProgramCandidates(
      initialProgramCandidate ? [initialProgramCandidate] : [],
    );
    setResolvingProgram(false);
  };

  const holderMatches = useMemo(() => {
    const query = holderKey(holderName);
    return (holderCandidates ?? [])
      .filter((candidate) => {
        const text = holderKey(
          `${String(candidate.holderName ?? "")} ${String(candidate.certificateHolder ?? "")}`,
        );
        return !query || text.includes(query);
      })
      .slice(0, 6);
  }, [holderCandidates, holderName]);

  const existingForCurrentPolicy = useMemo(() => {
    const key = holderKey(holderName);
    if (!key) return null;
    return (
      (holderCandidates ?? []).find(
        (candidate) =>
          candidate.hasCertificateForPolicy &&
          holderKey(
            String(candidate.holderName ?? candidate.certificateHolder ?? ""),
          ) === key,
      ) ?? null
    );
  }, [holderCandidates, holderName]);

  const applyHolderCandidate = (candidate: Record<string, unknown>) => {
    const nextHolderName = String(candidate.holderName ?? "");
    setHolderName(nextHolderName);
    setHolderSearchFocused(false);
    const lines = String(candidate.certificateHolder ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim());
    const [, line1, line2, cityStateZip] = lines;
    setAddressLine1(line1 ?? "");
    setAddressLine2(line2 ?? "");
    const match = cityStateZip?.match(/^(.+?),\s*([A-Za-z]{2})\s*(.*)$/);
    setCity(match?.[1] ?? "");
    setState(match?.[2] ?? "");
    setPostalCode(match?.[3] ?? "");
    setExplicitReissue(false);
  };

  const handleAddressRetrieve = useCallback(
    (response: AddressAutofillRetrieveResponse) => {
      const address = firstMapboxAddressFeature(response);
      if (!address) return;

      const nextAddressLine1 =
        address.address_line1 ?? address.address ?? address.feature_name ?? "";
      const nextAddressLine2 = address.address_line2 ?? "";
      const nextCity = address.address_level2 ?? address.address_level3 ?? "";
      const nextState = normalizeUsState(address.address_level1);
      const nextPostalCode = address.postcode ?? "";

      if (nextAddressLine1) setAddressLine1(nextAddressLine1);
      setAddressLine2(nextAddressLine2);
      if (nextCity) setCity(nextCity);
      if (nextState) setState(nextState);
      if (nextPostalCode) setPostalCode(nextPostalCode);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    if (initialProgramCandidate) return;
    let cancelled = false;

    void Promise.resolve()
      .then(() => {
        if (cancelled) return;
        setResolvingProgram(true);
        setSelectedPartnerProgramId(undefined);
        setProgramCandidates([]);
        return previewCertificateAuthority({ policyId });
      })
      .then((result) => {
        if (cancelled || !result) return;
        const selectedProgram = normalizeProgramMatchCandidate(
          (result as { selectedProgram?: ProgramMatchCandidate | null })
            .selectedProgram ?? {},
        );
        const candidates = (
          (result as { matchCandidates?: ProgramMatchCandidate[] })
            .matchCandidates ?? []
        )
          .map(normalizeProgramMatchCandidate)
          .filter(Boolean) as Array<
          ProgramMatchCandidate & {
            programId: Id<"partnerPrograms">;
            programName: string;
          }
        >;
        const nextCandidates = selectedProgram ? [selectedProgram] : candidates;
        setProgramCandidates(nextCandidates);
        setSelectedPartnerProgramId(nextCandidates[0]?.programId);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not check certificate program",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setResolvingProgram(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initialProgramCandidate, open, policyId, previewCertificateAuthority]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!holderName.trim()) {
      toast.error("Certificate holder is required");
      return;
    }

    if (existingForCurrentPolicy && !explicitReissue) {
      toast.message(
        "A certificate already exists for this holder and policy. Open it or choose Reissue anyway.",
      );
      return;
    }

    setGenerating(true);
    try {
      const result = await generateCertificate({
        policyId,
        holderName: holderName.trim(),
        addressLine1: addressLine1.trim() || undefined,
        addressLine2: addressLine2.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
        selectedPartnerProgramId,
        requestedEndorsements:
          requestedEndorsements.length > 0 ? requestedEndorsements : undefined,
        requestText:
          requestedEndorsements.length > 0
            ? `Generate certificate for ${holderName.trim()} with ${requestedEndorsements.join(", ")}.`
            : undefined,
      });
      if ((result as { status?: string }).status === "pending_approval") {
        toast.success("Certified COI sent for program administrator approval");
        onOpenChange(false);
        reset();
        return;
      }
      if (
        (result as { status?: string }).status === "held_policy_change_required"
      ) {
        toast.message(
          (result as { message?: string }).message ??
            "Certificate request is on hold for broker review",
        );
        onOpenChange(false);
        reset();
        return;
      }
      if (
        (result as { status?: string }).status === "needs_program_selection"
      ) {
        const candidates = (
          (result as { matchCandidates?: ProgramMatchCandidate[] })
            .matchCandidates ?? []
        )
          .map(normalizeProgramMatchCandidate)
          .filter(Boolean) as Array<
          ProgramMatchCandidate & {
            programId: Id<"partnerPrograms">;
            programName: string;
          }
        >;
        setProgramCandidates(candidates);
        setSelectedPartnerProgramId(candidates[0]?.programId);
        toast.message(
          "Confirm the correct program before generating this certified COI",
        );
        return;
      }
      toast.success(
        (result as { authorityType?: string }).authorityType === "certified"
          ? "Certified certificate generated"
          : "Non-binding certificate generated",
      );
      onOpenChange(false);
      reset();
      if (result.url) openWithUrl(result.url);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not generate certificate",
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={(value) => {
        if (generating) return;
        onOpenChange(value);
        if (!value) reset();
      }}
      title="Generate COI"
      footer={
        <>
          <PillButton
            variant="secondary"
            size="compact"
            onClick={() => onOpenChange(false)}
            disabled={generating}
          >
            Cancel
          </PillButton>
          <PillButton
            type="submit"
            form="certificate-create-form"
            size="compact"
            disabled={generating || resolvingProgram || !holderName.trim()}
          >
            {generating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <BadgeCheck className="w-3.5 h-3.5" />
            )}
            {explicitReissue ? "Reissue" : "Generate"}
          </PillButton>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-base text-muted-foreground">
          Search existing certificate holders, reuse the saved holder address,
          or enter a new holder with Mapbox address lookup.
        </p>

        <form
          id="certificate-create-form"
          onSubmit={handleSubmit}
          className="space-y-4"
        >
          {resolvingProgram || programCandidates.length > 0 ? (
            <div className="rounded-lg border border-foreground/8 bg-card p-3">
              <p className="text-base font-medium text-foreground">
                {programCandidates.length > 1 ? "Choose program" : "Program"}
              </p>
              <div className="mt-3 grid gap-2">
                {resolvingProgram ? (
                  <div className="rounded-md border border-foreground/8 px-3 py-2">
                    <div className="flex items-center gap-2 text-base text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      Checking policy program...
                    </div>
                  </div>
                ) : (
                  programCandidates.map((candidate) => {
                    const selected =
                      selectedPartnerProgramId === candidate.programId;
                    return (
                      <button
                        key={candidate.programId}
                        type="button"
                        className={`rounded-md border px-3 py-2 text-left transition-colors ${
                          selected
                            ? "border-foreground/30 bg-foreground/5"
                            : "border-foreground/8 hover:bg-foreground/[0.03]"
                        }`}
                        onClick={() =>
                          setSelectedPartnerProgramId(candidate.programId)
                        }
                        disabled={generating}
                        aria-pressed={selected}
                      >
                        <span className="block text-base font-medium text-foreground">
                          {candidate.programName}
                        </span>
                        <span className="mt-0.5 block text-label text-muted-foreground/70">
                          {[
                            candidate.categoryLabels?.join(", "),
                            candidate.approvalMode,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Program administrator program"}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="certificate-holder-name">Certificate holder</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                id="certificate-holder-name"
                value={holderName}
                onFocus={() => setHolderSearchFocused(true)}
                onChange={(event) => {
                  setHolderName(event.target.value);
                  setExplicitReissue(false);
                }}
                placeholder="Search or enter holder name"
                autoComplete="organization"
                autoFocus
                disabled={generating}
                className="pl-8"
              />
              {holderSearchFocused && holderMatches.length > 0 ? (
                <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-foreground/10 bg-popover p-1 shadow-xl">
                  {holderMatches.map((candidate) => (
                    <button
                      key={String(candidate.holderKey)}
                      type="button"
                      className="w-full rounded-md px-2 py-2 text-left hover:bg-foreground/5"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyHolderCandidate(candidate)}
                    >
                      <span className="block text-base font-medium text-foreground">
                        {String(candidate.holderName ?? "Certificate holder")}
                      </span>
                      <span className="mt-0.5 block whitespace-pre-line text-label text-muted-foreground/70">
                        {String(
                          candidate.certificateHolder ??
                            (candidate.hasCertificateForPolicy
                              ? "Existing policy certificate"
                              : "Saved holder"),
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {existingForCurrentPolicy ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="text-base font-medium">
                  Existing certificate found
                </p>
                <p className="mt-1 text-label opacity-80">
                  Glass already has a certificate for this holder on the current
                  policy. Open the latest version or explicitly reissue.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <PillButton
                    type="button"
                    variant="secondary"
                    size="compact"
                    disabled={!existingForCurrentPolicy.latestCertificateUrl}
                    onClick={() => {
                      const url = existingForCurrentPolicy.latestCertificateUrl;
                      if (typeof url === "string") openWithUrl(url);
                    }}
                    className="w-full sm:w-auto"
                  >
                    <Eye className="size-3.5" />
                    Open latest
                  </PillButton>
                  <PillButton
                    type="button"
                    size="compact"
                    onClick={() => setExplicitReissue(true)}
                    className="w-full sm:w-auto"
                  >
                    <RefreshCw className="size-3.5" />
                    Reissue anyway
                  </PillButton>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="certificate-address-1">Address line 1</Label>
            {MAPBOX_ACCESS_TOKEN ? (
              <AddressAutofill
                accessToken={MAPBOX_ACCESS_TOKEN}
                options={{ country: "US", language: "en", proximity: "ip" }}
                theme={MAPBOX_ADDRESS_AUTOFILL_THEME}
                popoverOptions={{
                  placement: "bottom-start",
                  flip: true,
                  offset: 6,
                }}
                onRetrieve={handleAddressRetrieve}
              >
                <Input
                  id="certificate-address-1"
                  value={addressLine1}
                  onChange={(event) => setAddressLine1(event.target.value)}
                  placeholder="Street address"
                  autoComplete="section-certificate address-line1"
                  disabled={generating}
                />
              </AddressAutofill>
            ) : (
              <Input
                id="certificate-address-1"
                value={addressLine1}
                onChange={(event) => setAddressLine1(event.target.value)}
                placeholder="Street address"
                autoComplete="section-certificate address-line1"
                disabled={generating}
              />
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="certificate-address-2">Address line 2</Label>
            <Input
              id="certificate-address-2"
              value={addressLine2}
              onChange={(event) => setAddressLine2(event.target.value)}
              placeholder="Suite, floor, attention line"
              autoComplete="section-certificate address-line2"
              disabled={generating}
            />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_72px_96px] gap-2">
            <div className="space-y-2">
              <Label htmlFor="certificate-city">City</Label>
              <Input
                id="certificate-city"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                autoComplete="section-certificate address-level2"
                disabled={generating}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="certificate-state">State</Label>
              <Input
                id="certificate-state"
                value={state}
                onChange={(event) => setState(event.target.value)}
                autoComplete="section-certificate address-level1"
                disabled={generating}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="certificate-postal-code">ZIP</Label>
              <Input
                id="certificate-postal-code"
                value={postalCode}
                onChange={(event) => setPostalCode(event.target.value)}
                autoComplete="section-certificate postal-code"
                disabled={generating}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Requested endorsements</Label>
            <div className="flex flex-wrap gap-2">
              {CERTIFICATE_ENDORSEMENT_OPTIONS.map((option) => {
                const selected = requestedEndorsements.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    disabled={generating}
                    onClick={() =>
                      setRequestedEndorsements((current) =>
                        selected
                          ? current.filter((value) => value !== option.value)
                          : [...current, option.value],
                      )
                    }
                    className={`rounded-md border px-2.5 py-1.5 text-label capitalize transition-colors ${
                      selected
                        ? "border-foreground/25 bg-foreground/[0.04] text-foreground"
                        : "border-foreground/8 bg-popover text-muted-foreground hover:border-foreground/15"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="text-label text-muted-foreground/60">
              Endorsement-bearing requests are checked against policy wording
              before Glass issues a certificate.
            </p>
          </div>
        </form>
      </div>
    </SettingsDrawer>
  );
}

function certificateHolderName(row: Record<string, unknown>) {
  const firstAddressLine = String(row.certificateHolder ?? "")
    .split(/\r?\n/)[0]
    ?.trim();
  return String(
    row.certificateHolderName ??
      row.holderName ??
      firstAddressLine ??
      "Certificate of Insurance",
  );
}

export function CertificateActivityList({
  rows,
  showPolicyColumn = false,
  onReissue,
}: {
  rows: Array<Record<string, unknown>>;
  showPolicyColumn?: boolean;
  onReissue?: (holder: InitialCertificateHolder) => void;
}) {
  const { openWithUrl } = usePdf();

  if (rows.length === 0) {
    return (
      <OperationalPanel as="div">
        <OperationalPanelBody className="px-4 py-8 text-center">
          <BadgeCheck className="mx-auto mb-3 h-5 w-5 text-muted-foreground/50" />
          <p className="text-base font-medium text-foreground">
            No certificates yet
          </p>
          <p className="mt-1 text-label text-muted-foreground">
            Generate a COI to store issued versions here.
          </p>
        </OperationalPanelBody>
      </OperationalPanel>
    );
  }

  const certificateRows = rows.filter((row) => row.activityType !== "hold");
  const holdRows = rows.filter((row) => row.activityType === "hold");
  const groups = Array.from(
    certificateRows.reduce((map, row) => {
      const key = holderKey(certificateHolderName(row));
      const current = map.get(key) ?? [];
      current.push(row);
      map.set(key, current);
      return map;
    }, new Map<string, Array<Record<string, unknown>>>()),
  ).map(([key, versions]) => ({
    key,
    versions: versions.sort(
      (left, right) =>
        Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0),
    ),
  }));

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const latest = group.versions[0];
        const policy = latest.policy as Record<string, unknown> | undefined;
        return (
          <OperationalPanel key={group.key} as="div" className="px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-medium text-foreground">
                    {certificateHolderName(latest)}
                  </p>
                  <Badge variant="outline" className="h-6 shrink-0">
                    {group.versions.length} version
                    {group.versions.length === 1 ? "" : "s"}
                  </Badge>
                </div>
                {showPolicyColumn && policy ? (
                  <Link
                    href={`/policies/${String(policy._id)}?tab=certificates`}
                    className="mt-1 block text-label text-primary hover:underline"
                  >
                    {String(policy.displayName ?? "Policy")}
                  </Link>
                ) : null}
                <p className="mt-2 whitespace-pre-line text-label text-muted-foreground">
                  {String(
                    latest.certificateHolder ??
                      "No certificate holder address recorded",
                  )}
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                {onReissue ? (
                  <PillButton
                    type="button"
                    size="compact"
                    variant="secondary"
                    className="w-full sm:w-auto"
                    onClick={() =>
                      onReissue({
                        holderName: certificateHolderName(latest),
                        certificateHolder: String(
                          latest.certificateHolder ?? "",
                        ),
                        explicitReissue: true,
                      })
                    }
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Reissue
                  </PillButton>
                ) : null}
                <PillButton
                  variant="secondary"
                  size="compact"
                  disabled={!latest.url}
                  className="w-full sm:w-auto"
                  onClick={() =>
                    typeof latest.url === "string" && openWithUrl(latest.url)
                  }
                >
                  <Eye className="w-3.5 h-3.5" />
                  Latest PDF
                </PillButton>
              </div>
            </div>
            <div className="mt-3 border-t border-foreground/6 pt-3">
              <p className="mb-2 text-label font-medium text-muted-foreground">
                Version history
              </p>
              <div className="grid gap-2">
                {group.versions.map((version, index) => (
                  <div
                    key={String(version._id)}
                    className="flex flex-col gap-2 rounded-md border border-foreground/6 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-base text-foreground">
                        {index === 0
                          ? "Latest issued version"
                          : `Version ${group.versions.length - index}`}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-2 text-label text-muted-foreground">
                        <span>
                          {formatCertificateTimestamp(
                            Number(version.createdAt),
                          )}
                        </span>
                        {typeof version.source === "string" &&
                        version.source ? (
                          <span>
                            {String(version.source).replace("_", " ")}
                          </span>
                        ) : null}
                        <span>
                          {version.authorityType === "certified"
                            ? "certified"
                            : "non-binding"}
                        </span>
                        {version.certificationStatus === "pending" ? (
                          <span>pending approval</span>
                        ) : null}
                      </div>
                    </div>
                    <PillButton
                      variant="secondary"
                      size="compact"
                      disabled={!version.url}
                      className="w-full sm:w-auto"
                      onClick={() =>
                        typeof version.url === "string" &&
                        openWithUrl(version.url)
                      }
                    >
                      <Eye className="w-3.5 h-3.5" />
                      PDF
                    </PillButton>
                  </div>
                ))}
              </div>
            </div>
          </OperationalPanel>
        );
      })}

      {holdRows.length > 0 ? (
        <OperationalPanel as="div" className="px-4 py-3">
          <p className="text-base font-medium text-foreground">
            Held certificate requests
          </p>
          <div className="mt-3 grid gap-2">
            {holdRows.map((row) => {
              const policy = row.policy as Record<string, unknown> | undefined;
              return (
                <div
                  key={String(row._id)}
                  className="rounded-md border border-foreground/6 px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-medium text-foreground">
                        {certificateHolderName(row)}
                      </p>
                      {showPolicyColumn && policy ? (
                        <Link
                          href={`/policies/${String(policy._id)}?tab=certificates`}
                          className="mt-1 block text-label text-primary hover:underline"
                        >
                          {String(policy.displayName ?? "Policy")}
                        </Link>
                      ) : null}
                      <p className="mt-1 text-label text-muted-foreground">
                        {String(
                          row.reasonMessage ?? "Certificate request is on hold",
                        )}
                      </p>
                      <p className="mt-1 text-label text-muted-foreground/70">
                        {formatCertificateTimestamp(Number(row.createdAt))}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className="h-6 shrink-0 capitalize"
                    >
                      Held
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </OperationalPanel>
      ) : null}
    </div>
  );
}

export function CertificatesTab({
  policyId,
  onReissue,
}: {
  policyId: Id<"policies">;
  onReissue?: (holder: InitialCertificateHolder) => void;
}) {
  const activity = useCachedQuery(
    "certificates.listActivityByPolicy",
    api.certificates.listActivityByPolicy,
    { policyId },
  );

  if (activity === undefined) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const rows = [
    ...((activity.certificates ?? []) as Array<Record<string, unknown>>),
    ...((activity.holds ?? []) as Array<Record<string, unknown>>),
  ].sort(
    (left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0),
  );

  return <CertificateActivityList rows={rows} onReissue={onReissue} />;
}
