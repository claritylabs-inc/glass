"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { useAction } from "convex/react";
import type { AddressAutofillRetrieveResponse } from "@mapbox/search-js-core";
import type { Theme as MapboxSearchTheme } from "@mapbox/search-js-web";
import dayjs from "dayjs";
import { BadgeCheck, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OperationalPanel, OperationalPanelBody } from "@/components/ui/operational-panel";
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

export function CertificateCreatePanel({
  open,
  onOpenChange,
  policyId,
  initialProgram,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: Id<"policies">;
  initialProgram?: ProgramMatchCandidate | null;
}) {
  const generateCertificate = useAction(api.certificates.generateForPolicy);
  const previewCertificateAuthority = useAction(
    api.certificates.previewAuthorityForPolicy,
  );
  const { openWithUrl } = usePdf();
  const initialProgramCandidate = useMemo(
    () => normalizeProgramMatchCandidate(initialProgram ?? {}),
    [initialProgram],
  );
  const [holderName, setHolderName] = useState("");
  const [holderEmail, setHolderEmail] = useState("");
  const [holderPhone, setHolderPhone] = useState("");
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
    setHolderEmail("");
    setHolderPhone("");
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

    setGenerating(true);
    try {
      const result = await generateCertificate({
        policyId,
        holderName: holderName.trim(),
        holderEmail: holderEmail.trim() || undefined,
        holderPhone: holderPhone.trim() || undefined,
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
      if ((result as { status?: string }).status === "existing") {
        toast.success("Existing certificate returned for this holder");
        onOpenChange(false);
        reset();
        if (result.url) openWithUrl(result.url);
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
            Generate
          </PillButton>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-base text-muted-foreground">
          Create a certificate from this policy and list the certificate holder
          on the PDF.
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
            <Input
              id="certificate-holder-name"
              value={holderName}
              onChange={(event) => setHolderName(event.target.value)}
              placeholder="Company or individual name"
              autoComplete="organization"
              autoFocus
              disabled={generating}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="certificate-holder-email">Holder email</Label>
              <Input
                id="certificate-holder-email"
                type="email"
                value={holderEmail}
                onChange={(event) => setHolderEmail(event.target.value)}
                placeholder="certificates@example.com"
                autoComplete="email"
                disabled={generating}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="certificate-holder-phone">Holder phone</Label>
              <Input
                id="certificate-holder-phone"
                type="tel"
                value={holderPhone}
                onChange={(event) => setHolderPhone(event.target.value)}
                placeholder="Optional"
                autoComplete="tel"
                disabled={generating}
              />
            </div>
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

export function CertificatesTab({ policyId }: { policyId: Id<"policies"> }) {
  const activity = useCachedQuery(
    "certificates.listActivityByPolicy",
    api.certificates.listActivityByPolicy,
    { policyId },
  );
  const { openWithUrl } = usePdf();

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

  if (rows.length === 0) {
    return (
      <OperationalPanel as="div">
        <OperationalPanelBody className="px-4 py-8 text-center">
          <BadgeCheck className="mx-auto mb-3 h-5 w-5 text-muted-foreground/50" />
          <p className="text-base font-medium text-foreground">
            No certificates yet
          </p>
          <p className="mt-1 text-label text-muted-foreground">
            Generate a COI from the page header to store it here.
          </p>
        </OperationalPanelBody>
      </OperationalPanel>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <OperationalPanel
          key={String(row._id)}
          as="div"
          className="px-4 py-3"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-base font-medium text-foreground truncate">
                {String(
                  row.certificateHolderName ??
                    row.holderName ??
                    "Certificate of Insurance",
                )}
              </p>
              <p className="mt-1 whitespace-pre-line text-label text-muted-foreground">
                {String(
                  row.certificateHolder ??
                    row.reasonMessage ??
                    "No certificate holder recorded",
                )}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-label text-muted-foreground">
                <span>{formatCertificateTimestamp(Number(row.createdAt))}</span>
                {typeof row.source === "string" && row.source ? (
                  <span>{String(row.source).replace("_", " ")}</span>
                ) : null}
                {row.activityType === "hold" ? (
                  <span>on hold</span>
                ) : (
                  <span>
                    {typeof row.certificateVersionNumber === "number"
                      ? `version ${row.certificateVersionNumber} · `
                      : ""}
                    {row.authorityType === "certified"
                      ? "certified"
                      : "non-binding"}
                  </span>
                )}
                {row.certificationStatus === "pending" && (
                  <span>pending approval</span>
                )}
              </div>
            </div>
            {row.activityType === "hold" ? (
              <Badge variant="outline" className="h-6 shrink-0 capitalize">
                Held
              </Badge>
            ) : (
              <PillButton
                variant="secondary"
                size="compact"
                disabled={!row.url}
                onClick={() =>
                  typeof row.url === "string" && openWithUrl(row.url)
                }
              >
                <Eye className="w-3.5 h-3.5" />
                PDF
              </PillButton>
            )}
          </div>
        </OperationalPanel>
      ))}
    </div>
  );
}
