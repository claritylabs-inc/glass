"use client";

import { useCallback, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { useAction } from "convex/react";
import type { AddressAutofillRetrieveResponse } from "@mapbox/search-js-core";
import type { Theme as MapboxSearchTheme } from "@mapbox/search-js-web";
import { BadgeCheck, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelBody,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  CertificatePolicyGroupCard,
  CERTIFICATE_PANEL_CONTAINER_CLASS,
  formatCertificateTime,
  groupCertificatesByPolicy,
  type PolicyCertificateRecord,
} from "@/components/certificates/certificate-workspace";
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

type CertificateHoldRow = Record<string, unknown> & {
  _id: Id<"certificateRequestHolds">;
  createdAt: number;
  holderName?: string;
  certificateHolderName?: string;
  certificateHolder?: string;
  reasonMessage?: string;
  source?: string;
};

export function CertificateCreatePanel({
  open,
  onOpenChange,
  policyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: Id<"policies">;
}) {
  const generateCertificate = useAction(api.certificates.generateForPolicy);
  const { openWithUrl } = usePdf();
  const [holderName, setHolderName] = useState("");
  const [holderContactName, setHolderContactName] = useState("");
  const [holderEmail, setHolderEmail] = useState("");
  const [holderPhone, setHolderPhone] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [includeAdditionalInsured, setIncludeAdditionalInsured] = useState(false);
  const [additionalInsuredName, setAdditionalInsuredName] = useState("");
  const [generating, setGenerating] = useState(false);

  const reset = () => {
    setHolderName("");
    setHolderContactName("");
    setHolderEmail("");
    setHolderPhone("");
    setAddressLine1("");
    setAddressLine2("");
    setCity("");
    setState("");
    setPostalCode("");
    setIncludeAdditionalInsured(false);
    setAdditionalInsuredName("");
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!holderName.trim()) {
      toast.error("Certificate holder is required");
      return;
    }
    if (includeAdditionalInsured && !additionalInsuredName.trim()) {
      toast.error("Additional insured name is required");
      return;
    }

    setGenerating(true);
    try {
      const additionalInsured = includeAdditionalInsured
        ? additionalInsuredName.trim()
        : undefined;
      const result = await generateCertificate({
        policyId,
        holderName: holderName.trim(),
        holderContactName: holderContactName.trim() || undefined,
        holderEmail: holderEmail.trim() || undefined,
        holderPhone: holderPhone.trim() || undefined,
        addressLine1: addressLine1.trim() || undefined,
        addressLine2: addressLine2.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
        requestedEndorsements:
          additionalInsured ? ["additional_insured"] : undefined,
        additionalInsuredName: additionalInsured,
        requestText:
          additionalInsured
            ? `Generate certificate for ${holderName.trim()} showing ${additionalInsured} as an additional insured.`
            : undefined,
      });
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
        (result as { status?: string }).status === "source_tree_rebuild_required" ||
        (result as { status?: string }).status === "extraction_in_progress"
      ) {
        toast.message(
          (result as { message?: string }).message ??
            "Policy extraction is still preparing certificate evidence",
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
      toast.success("Certificate generated");
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
            disabled={generating || !holderName.trim()}
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

          <div className="space-y-2">
            <Label htmlFor="certificate-holder-contact">Holder contact</Label>
            <Input
              id="certificate-holder-contact"
              value={holderContactName}
              onChange={(event) => setHolderContactName(event.target.value)}
              placeholder="Attention contact"
              autoComplete="name"
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

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-base text-foreground">
              <input
                type="checkbox"
                checked={includeAdditionalInsured}
                disabled={generating}
                onChange={(event) => {
                  setIncludeAdditionalInsured(event.target.checked);
                  if (!event.target.checked) setAdditionalInsuredName("");
                }}
                className="size-4 accent-foreground"
              />
              Include additional insured
            </label>
            {includeAdditionalInsured ? (
              <div className="space-y-2">
                <Label htmlFor="certificate-additional-insured">
                  Additional insured
                </Label>
                <Input
                  id="certificate-additional-insured"
                  value={additionalInsuredName}
                  onChange={(event) =>
                    setAdditionalInsuredName(event.target.value)
                  }
                  placeholder="Additional insured name"
                  disabled={generating}
                />
              </div>
            ) : null}
          </div>
        </form>
      </div>
    </SettingsDrawer>
  );
}

function CertificateHoldActivityRow({ row }: { row: CertificateHoldRow }) {
  const holderName = String(
    row.certificateHolderName ??
      row.holderName ??
      "Certificate holder",
  );
  const reason = String(
    row.reasonMessage ??
      row.certificateHolder ??
      "Certificate request is on hold",
  );
  return (
    <OperationalItem>
      <div className="flex min-w-0 flex-col gap-2 @xl/certificates-panel:flex-row @xl/certificates-panel:items-start @xl/certificates-panel:justify-between">
        <div className="min-w-0 max-w-3xl">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 max-w-full truncate text-base font-medium text-foreground">
              {holderName}
            </p>
            <Badge variant="outline" className="text-label">
              Held
            </Badge>
          </div>
          <p className="mt-1 text-base leading-5 text-muted-foreground">
            {reason}
          </p>
        </div>
        <p className="shrink-0 text-label text-muted-foreground/70 @xl/certificates-panel:pt-0.5">
          {formatCertificateTime(row.createdAt)}
        </p>
      </div>
    </OperationalItem>
  );
}

export function CertificatesTab({
  policyId,
  selectedCertificateId,
  onSelectCertificate,
}: {
  policyId: Id<"policies">;
  selectedCertificateId?: Id<"policyCertificates"> | null;
  onSelectCertificate?: (certificate: PolicyCertificateRecord | null) => void;
}) {
  const certificates = useCachedQuery(
    "certificateLifecycle.listByPolicy",
    api.certificateLifecycle.listByPolicy,
    { policyId },
  ) as PolicyCertificateRecord[] | undefined;
  const activity = useCachedQuery(
    "certificates.listActivityByPolicy",
    api.certificates.listActivityByPolicy,
    { policyId },
  );

  if (certificates === undefined || activity === undefined) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const activeCertificates = certificates
    .filter((row) => row.status === "active")
    .sort(
      (left, right) =>
        Number(right.lastIssuedAt ?? right.currentVersion?.createdAt ?? 0) -
        Number(left.lastIssuedAt ?? left.currentVersion?.createdAt ?? 0),
    );
  const activeCertificateGroups = groupCertificatesByPolicy(activeCertificates);
  const holds = ((activity.holds ?? []) as CertificateHoldRow[]).sort(
    (left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0),
  );

  if (activeCertificateGroups.length === 0 && holds.length === 0) {
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
    <div className="space-y-3">
      {activeCertificateGroups.map((group) => (
        <CertificatePolicyGroupCard
          key={group.key}
          group={group}
          selectedCertificateId={selectedCertificateId}
          showPolicyHeader={false}
          onSelectCertificate={(row) => onSelectCertificate?.(row)}
        />
      ))}
      {holds.length > 0 ? (
        <OperationalPanel as="div" className={CERTIFICATE_PANEL_CONTAINER_CLASS}>
          {holds.map((row) => (
            <CertificateHoldActivityRow key={row._id} row={row} />
          ))}
        </OperationalPanel>
      ) : null}
    </div>
  );
}
