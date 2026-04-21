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

export function SectionNatureOfBusiness({ clientOrgId }: { clientOrgId: string }) {
  const router = useRouter();
  const passportData = useQuery(api.clientPassport.getFull, {});
  const upsertCore = useMutation(api.clientPassport.upsertCore);
  const acceptSuggestion = useMutation(api.passportSideTables.acceptSuggestion);
  const dismissSuggestion = useMutation(api.passportSideTables.dismissSuggestion);

  const passport = passportData?.passport;
  const provenance = passportData?.provenance ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getP = (fp: string) => provenance.find((p: any) => p.fieldPath === fp);

  const [businessDescription, setBusinessDescription] = useState(passport?.businessDescription ?? "");
  const [naicsCode, setNaicsCode] = useState(passport?.naicsCode ?? "");
  const [yearsInBusiness, setYearsInBusiness] = useState(passport?.yearsInBusiness?.toString() ?? "");
  const [numberOfEmployees, setNumberOfEmployees] = useState(passport?.numberOfEmployees?.toString() ?? "");
  const [annualRevenue, setAnnualRevenue] = useState(passport?.annualRevenue ?? "");
  const [operationsSummary, setOperationsSummary] = useState(passport?.operationsSummary ?? "");
  const [saving, setSaving] = useState(false);

  if (passportData === undefined) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  const canContinue = businessDescription.trim().length > 0;

  async function handleNext() {
    setSaving(true);
    try {
      await upsertCore({
        patch: {
          businessDescription: businessDescription.trim() || undefined,
          naicsCode: naicsCode.trim() || undefined,
          yearsInBusiness: yearsInBusiness ? parseInt(yearsInBusiness, 10) : undefined,
          numberOfEmployees: numberOfEmployees ? parseInt(numberOfEmployees, 10) : undefined,
          annualRevenue: annualRevenue.trim() || undefined,
          operationsSummary: operationsSummary.trim() || undefined,
        },
      });
      router.push("/onboarding/passport/locations");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

  return (
    <div className="space-y-6">
      <FieldWithProvenance
        fieldPath="businessDescription"
        currentValue={businessDescription}
        provenance={getP("businessDescription")}
        onAccept={() => {
          const p = getP("businessDescription");
          if (p?.suggestedValue) setBusinessDescription(String(p.suggestedValue));
          void acceptSuggestion({ clientOrgId: clientOrgId as any, fieldPath: "businessDescription" });
        }}
        onDismiss={() => void dismissSuggestion({ clientOrgId: clientOrgId as any, fieldPath: "businessDescription" })}
        label="Business description *"
      >
        <textarea value={businessDescription} onChange={(e) => setBusinessDescription(e.target.value)} rows={3} placeholder="Describe the business..." className={inputClass} />
      </FieldWithProvenance>

      <FieldWithProvenance
        fieldPath="naicsCode"
        currentValue={naicsCode}
        provenance={getP("naicsCode")}
        onAccept={() => {
          const p = getP("naicsCode");
          if (p?.suggestedValue) setNaicsCode(String(p.suggestedValue));
          void acceptSuggestion({ clientOrgId: clientOrgId as any, fieldPath: "naicsCode" });
        }}
        onDismiss={() => void dismissSuggestion({ clientOrgId: clientOrgId as any, fieldPath: "naicsCode" })}
        label="NAICS code"
      >
        <input type="text" value={naicsCode} onChange={(e) => setNaicsCode(e.target.value)} placeholder="e.g. 541511" className={inputClass} />
      </FieldWithProvenance>

      <div className="grid grid-cols-2 gap-4">
        <FieldWithProvenance fieldPath="yearsInBusiness" currentValue={yearsInBusiness} label="Years in business">
          <input type="number" value={yearsInBusiness} onChange={(e) => setYearsInBusiness(e.target.value)} placeholder="12" className={inputClass} />
        </FieldWithProvenance>
        <FieldWithProvenance
          fieldPath="numberOfEmployees"
          currentValue={numberOfEmployees}
          provenance={getP("numberOfEmployees")}
          onAccept={() => {
            const p = getP("numberOfEmployees");
            if (p?.suggestedValue) setNumberOfEmployees(String(p.suggestedValue));
            void acceptSuggestion({ clientOrgId: clientOrgId as any, fieldPath: "numberOfEmployees" });
          }}
          onDismiss={() => void dismissSuggestion({ clientOrgId: clientOrgId as any, fieldPath: "numberOfEmployees" })}
          label="Employees"
        >
          <input type="number" value={numberOfEmployees} onChange={(e) => setNumberOfEmployees(e.target.value)} placeholder="50" className={inputClass} />
        </FieldWithProvenance>
      </div>

      <FieldWithProvenance
        fieldPath="annualRevenue"
        currentValue={annualRevenue}
        provenance={getP("annualRevenue")}
        onAccept={() => {
          const p = getP("annualRevenue");
          if (p?.suggestedValue) setAnnualRevenue(String(p.suggestedValue));
          void acceptSuggestion({ clientOrgId: clientOrgId as any, fieldPath: "annualRevenue" });
        }}
        onDismiss={() => void dismissSuggestion({ clientOrgId: clientOrgId as any, fieldPath: "annualRevenue" })}
        label="Annual revenue"
      >
        <input type="text" value={annualRevenue} onChange={(e) => setAnnualRevenue(e.target.value)} placeholder="$5,000,000" className={inputClass} />
      </FieldWithProvenance>

      <FieldWithProvenance fieldPath="operationsSummary" currentValue={operationsSummary} label="Operations summary">
        <textarea value={operationsSummary} onChange={(e) => setOperationsSummary(e.target.value)} rows={2} placeholder="Key operations, locations served, special risks..." className={inputClass} />
      </FieldWithProvenance>

      <PillButton type="button" onClick={handleNext} disabled={!canContinue || saving} className="w-full justify-center text-sm shadow-none sm:w-auto">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Continue
        {!saving ? <ArrowRight className="h-4 w-4" /> : null}
      </PillButton>
    </div>
  );
}
