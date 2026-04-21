"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api as _api } from "@/convex/_generated/api";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;
import { ArrowRight, Loader2 } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { FieldWithProvenance } from "./field-with-provenance";
import { toast } from "sonner";

export function SectionApplicantInfo({ clientOrgId }: { clientOrgId: string }) {
  const router = useRouter();
  const passportData = useQuery(api.clientPassport.getFull, {});
  const upsertCore = useMutation(api.clientPassport.upsertCore);
  const acceptSuggestion = useMutation(api.passportSideTables.acceptSuggestion);
  const dismissSuggestion = useMutation(api.passportSideTables.dismissSuggestion);

  const passport = passportData?.passport;
  const provenance = passportData?.provenance ?? [];

  const getProvenance = (fieldPath: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provenance.find((p: any) => p.fieldPath === fieldPath);

  const [legalName, setLegalName] = useState(passport?.legalName ?? "");
  const [dba, setDba] = useState(passport?.dba ?? "");
  const [entityType, setEntityType] = useState(passport?.entityType ?? "");
  const [fein, setFein] = useState(passport?.fein ?? "");
  const [website, setWebsite] = useState(passport?.website ?? "");
  const [primaryContactName, setPrimaryContactName] = useState(passport?.primaryContactName ?? "");
  const [primaryContactTitle, setPrimaryContactTitle] = useState(passport?.primaryContactTitle ?? "");
  const [primaryContactEmail, setPrimaryContactEmail] = useState(passport?.primaryContactEmail ?? "");
  const [primaryContactPhone, setPrimaryContactPhone] = useState(passport?.primaryContactPhone ?? "");
  const [saving, setSaving] = useState(false);

  if (passportData === undefined) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }

  const canContinue = legalName.trim().length > 0 && primaryContactEmail.trim().length > 0;

  async function handleNext() {
    setSaving(true);
    try {
      await upsertCore({
        patch: {
          legalName: legalName.trim() || undefined,
          dba: dba.trim() || undefined,
          entityType: entityType || undefined,
          fein: fein.trim() || undefined,
          website: website.trim() || undefined,
          primaryContactName: primaryContactName.trim() || undefined,
          primaryContactTitle: primaryContactTitle.trim() || undefined,
          primaryContactEmail: primaryContactEmail.trim() || undefined,
          primaryContactPhone: primaryContactPhone.trim() || undefined,
        },
      });
      router.push("/onboarding/passport/business");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

  return (
    <div className="space-y-6">
      <FieldWithProvenance
        fieldPath="legalName"
        currentValue={legalName}
        provenance={getProvenance("legalName")}
        onAccept={() => {
          const p = getProvenance("legalName");
          if (p?.suggestedValue) setLegalName(String(p.suggestedValue));
          void acceptSuggestion({ clientOrgId: clientOrgId as any, fieldPath: "legalName" });
        }}
        onDismiss={() => void dismissSuggestion({ clientOrgId: clientOrgId as any, fieldPath: "legalName" })}
        label="Legal name *"
      >
        <input
          type="text"
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          placeholder="Acme Corporation"
          className={inputClass}
        />
      </FieldWithProvenance>

      <FieldWithProvenance fieldPath="dba" currentValue={dba} label="DBA (if different)">
        <input type="text" value={dba} onChange={(e) => setDba(e.target.value)} placeholder="Trading As" className={inputClass} />
      </FieldWithProvenance>

      <FieldWithProvenance fieldPath="entityType" currentValue={entityType} label="Entity type">
        <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className={inputClass}>
          <option value="">Select...</option>
          <option value="corporation">Corporation</option>
          <option value="llc">LLC</option>
          <option value="partnership">Partnership</option>
          <option value="sole_proprietor">Sole Proprietor</option>
          <option value="nonprofit">Nonprofit</option>
          <option value="government">Government</option>
          <option value="other">Other</option>
        </select>
      </FieldWithProvenance>

      <FieldWithProvenance fieldPath="fein" currentValue={fein} label="FEIN">
        <input type="text" value={fein} onChange={(e) => setFein(e.target.value)} placeholder="12-3456789" className={inputClass} />
      </FieldWithProvenance>

      <FieldWithProvenance
        fieldPath="website"
        currentValue={website}
        provenance={getProvenance("website")}
        onAccept={() => {
          const p = getProvenance("website");
          if (p?.suggestedValue) setWebsite(String(p.suggestedValue));
          void acceptSuggestion({ clientOrgId: clientOrgId as any, fieldPath: "website" });
        }}
        onDismiss={() => void dismissSuggestion({ clientOrgId: clientOrgId as any, fieldPath: "website" })}
        label="Website"
      >
        <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://example.com" className={inputClass} />
      </FieldWithProvenance>

      <FieldWithProvenance
        fieldPath="primaryContactName"
        currentValue={primaryContactName}
        provenance={getProvenance("primaryContactName")}
        onAccept={() => {
          const p = getProvenance("primaryContactName");
          if (p?.suggestedValue) setPrimaryContactName(String(p.suggestedValue));
          void acceptSuggestion({ clientOrgId: clientOrgId as any, fieldPath: "primaryContactName" });
        }}
        onDismiss={() => void dismissSuggestion({ clientOrgId: clientOrgId as any, fieldPath: "primaryContactName" })}
        label="Primary contact name"
      >
        <input type="text" value={primaryContactName} onChange={(e) => setPrimaryContactName(e.target.value)} placeholder="Jane Smith" className={inputClass} />
      </FieldWithProvenance>

      <FieldWithProvenance fieldPath="primaryContactTitle" currentValue={primaryContactTitle} label="Contact title">
        <input type="text" value={primaryContactTitle} onChange={(e) => setPrimaryContactTitle(e.target.value)} placeholder="CFO" className={inputClass} />
      </FieldWithProvenance>

      <FieldWithProvenance
        fieldPath="primaryContactEmail"
        currentValue={primaryContactEmail}
        provenance={getProvenance("primaryContactEmail")}
        onAccept={() => {
          const p = getProvenance("primaryContactEmail");
          if (p?.suggestedValue) setPrimaryContactEmail(String(p.suggestedValue));
          void acceptSuggestion({ clientOrgId: clientOrgId as any, fieldPath: "primaryContactEmail" });
        }}
        onDismiss={() => void dismissSuggestion({ clientOrgId: clientOrgId as any, fieldPath: "primaryContactEmail" })}
        label="Contact email *"
      >
        <input type="email" value={primaryContactEmail} onChange={(e) => setPrimaryContactEmail(e.target.value)} placeholder="jane@acme.com" className={inputClass} />
      </FieldWithProvenance>

      <FieldWithProvenance fieldPath="primaryContactPhone" currentValue={primaryContactPhone} label="Contact phone">
        <input type="tel" value={primaryContactPhone} onChange={(e) => setPrimaryContactPhone(e.target.value)} placeholder="+1 (555) 000-0000" className={inputClass} />
      </FieldWithProvenance>

      <PillButton
        type="button"
        onClick={handleNext}
        disabled={!canContinue || saving}
        className="w-full justify-center text-sm shadow-none sm:w-auto"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Continue
        {!saving ? <ArrowRight className="h-4 w-4" /> : null}
      </PillButton>
    </div>
  );
}
