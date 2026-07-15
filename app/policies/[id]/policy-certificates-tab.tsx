"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAction } from "convex/react";
import { isValidPhoneNumber } from "react-phone-number-input";
import { BadgeCheck, Copy, Eye, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelBody,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  CertificatesTable,
  CERTIFICATE_PANEL_CONTAINER_CLASS,
  formatCertificateTime,
  type PolicyCertificateRecord,
} from "@/components/certificates/certificate-workspace";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { AddressAutofillInput } from "@/components/ui/address-autofill-input";

import { usePdf } from "@/components/pdf-context";

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
  emailDraft?: BrokerEmailDraft;
};

type BrokerEmailDraft = {
  subject: string;
  body: string;
  recipientEmail?: string;
  recipientName?: string;
};

type HeldCertificateResult = {
  status: "held_policy_change_required";
  message?: string;
  requiredChanges?: string[];
  reasonMessage?: string;
  evidence?: Array<{ label?: string; excerpt?: string }>;
  emailDraft?: BrokerEmailDraft;
};

function labelForChange(value: string) {
  const labels: Record<string, string> = {
    additional_insured: "Additional insured",
    waiver_of_subrogation: "Waiver of subrogation",
    primary_non_contributory: "Primary & non-contributory",
    loss_payee: "Loss payee",
    mortgagee: "Mortgagee",
    named_insured: "Named insured",
    special_wording: "Special wording",
    policy_change: "Policy change",
  };
  return labels[value] ?? value.replace(/_/g, " ");
}

function brokerEmailDraft(value: unknown): BrokerEmailDraft | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.subject !== "string" || typeof record.body !== "string") {
    return undefined;
  }
  return {
    subject: record.subject,
    body: record.body,
    recipientEmail:
      typeof record.recipientEmail === "string" ? record.recipientEmail : undefined,
    recipientName:
      typeof record.recipientName === "string" ? record.recipientName : undefined,
  };
}

function mailtoHref(draft: BrokerEmailDraft) {
  return `mailto:${encodeURIComponent(draft.recipientEmail ?? "")}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
}

function copyDraft(draft: BrokerEmailDraft) {
  void navigator.clipboard?.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
  toast.success("Broker email copied");
}

function CertificateHoldState({
  hold,
}: {
  hold: HeldCertificateResult;
}) {
  const draft = brokerEmailDraft(hold.emailDraft);
  const evidence = (hold.evidence ?? []).slice(0, 3);
  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-base font-medium text-foreground">
            Certificate not issued
          </p>
          <Badge variant="outline">Broker action</Badge>
        </div>
        <p className="mt-2 text-base leading-5 text-muted-foreground">
          {hold.reasonMessage ??
            hold.message ??
            "This certificate needs a policy endorsement before it can be issued."}
        </p>
      </div>

      {(hold.requiredChanges ?? []).length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {(hold.requiredChanges ?? []).map((change) => (
            <span
              key={change}
              className="rounded-full border border-foreground/10 px-2 py-0.5 text-tag text-muted-foreground"
            >
              {labelForChange(change)}
            </span>
          ))}
        </div>
      ) : null}

      {evidence.length > 0 ? (
        <div className="space-y-2 rounded-md border border-foreground/8 p-3">
          <p className="text-label font-medium text-muted-foreground">
            Evidence checked
          </p>
          {evidence.map((item, index) => (
            <p
              key={`${item.label ?? "evidence"}-${index}`}
              className="text-base leading-5 text-muted-foreground"
            >
              {item.label ? `${item.label}: ` : ""}
              {item.excerpt}
            </p>
          ))}
        </div>
      ) : null}

      {draft ? (
        <div className="rounded-md border border-foreground/8 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-label font-medium text-muted-foreground">
                Broker email draft
              </p>
              <p className="mt-1 break-words text-base font-medium leading-5 text-foreground">
                {draft.subject}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <PillButton
                type="button"
                size="compact"
                variant="secondary"
                onClick={() => copyDraft(draft)}
              >
                <Copy className="size-3.5" />
                Copy
              </PillButton>
              <PillButton href={mailtoHref(draft)} size="compact" variant="ghost">
                <Mail className="size-3.5" />
                Email
              </PillButton>
            </div>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-base leading-5 text-muted-foreground">
            {draft.body}
          </p>
        </div>
      ) : null}
    </div>
  );
}

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
  const [country, setCountry] = useState("");
  const [holdResult, setHoldResult] = useState<HeldCertificateResult | null>(
    null,
  );
  const [generating, setGenerating] = useState(false);
  const holderPhoneInvalid = Boolean(
    holderPhone.trim() && !isValidPhoneNumber(holderPhone),
  );

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
    setCountry("");
    setHoldResult(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!holderName.trim()) {
      toast.error("Certificate holder is required");
      return;
    }
    if (holderPhoneInvalid) {
      toast.error("Enter a valid holder phone number");
      return;
    }
    setGenerating(true);
    try {
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
        country: country.trim() || undefined,
      });
      if (
        (result as { status?: string }).status === "held_policy_change_required"
      ) {
        setHoldResult(result as HeldCertificateResult);
        return;
      }
      if ((result as { status?: string }).status === "ambiguous_certificate_holder") {
        toast.message(
          (result as { message?: string }).message ??
            "Choose the existing certificate to reissue or provide the exact holder address.",
        );
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
      footer={holdResult ? (
        <>
          <PillButton
            variant="secondary"
            size="compact"
            onClick={() => setHoldResult(null)}
          >
            Back to form
          </PillButton>
          <PillButton
            size="compact"
            onClick={() => {
              onOpenChange(false);
              reset();
            }}
          >
            Done
          </PillButton>
        </>
      ) : (
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
      )}
    >
      <div className="space-y-4">
        {holdResult ? (
          <CertificateHoldState hold={holdResult} />
        ) : (
          <>
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
            <PhoneInput
              id="certificate-holder-phone"
              value={holderPhone || undefined}
              onChange={(value) => setHolderPhone(value ?? "")}
              defaultCountry="US"
              placeholder="Enter phone number"
              autoComplete="tel"
              disabled={generating}
              aria-invalid={holderPhoneInvalid}
            />
            {holderPhoneInvalid ? (
              <p className="text-label text-destructive">
                Enter a valid phone number with country code.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="certificate-address-1">Address</Label>
            <AddressAutofillInput
              id="certificate-address-1"
              value={{
                street1: addressLine1,
                street2: addressLine2,
                city,
                state,
                zip: postalCode,
                country,
              }}
              onChange={(address) => {
                setAddressLine1(address.street1 ?? "");
                setAddressLine2(address.street2 ?? "");
                setCity(address.city ?? "");
                setState(address.state ?? "");
                setPostalCode(address.zip ?? "");
                setCountry(address.country ?? "");
              }}
              display="street1"
              placeholder="Search for an address"
              autoComplete="section-certificate address-line1"
              disabled={generating}
            />
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
            <Label htmlFor="certificate-country">Country</Label>
            <Input
              id="certificate-country"
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              autoComplete="section-certificate country-name"
              placeholder="United States"
              disabled={generating}
            />
          </div>

        </form>
          </>
        )}
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
  const draft = brokerEmailDraft(row.emailDraft);
  return (
    <OperationalItem>
      <div className="flex min-w-0 flex-col gap-2 @xl/certificates-panel:flex-row @xl/certificates-panel:items-start @xl/certificates-panel:justify-between">
        <div className="min-w-0 max-w-3xl">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 max-w-full truncate text-base font-medium text-foreground">
              {holderName}
            </p>
            <Badge variant="outline">
              Held
            </Badge>
          </div>
          <p className="mt-1 text-base leading-5 text-muted-foreground">
            {reason}
          </p>
          {draft ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <PillButton
                type="button"
                size="compact"
                variant="secondary"
                onClick={() => copyDraft(draft)}
              >
                <Copy className="size-3.5" />
                Copy broker email
              </PillButton>
              <PillButton href={mailtoHref(draft)} size="compact" variant="ghost">
                <Mail className="size-3.5" />
                Email
              </PillButton>
            </div>
          ) : null}
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

  useEffect(() => {
    if (!certificates || !selectedCertificateId) return;
    const selected = certificates.find((row) => row._id === selectedCertificateId);
    if (selected) onSelectCertificate?.(selected);
  }, [certificates, onSelectCertificate, selectedCertificateId]);

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
  const holds = ((activity.holds ?? []) as CertificateHoldRow[]).sort(
    (left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0),
  );

  if (activeCertificates.length === 0 && holds.length === 0) {
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
      {activeCertificates.length > 0 ? (
        <CertificatesTable
          rows={activeCertificates}
          selectedCertificateId={selectedCertificateId}
          showPolicyColumn={false}
          onSelectCertificate={(row) => onSelectCertificate?.(row)}
        />
      ) : null}
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
