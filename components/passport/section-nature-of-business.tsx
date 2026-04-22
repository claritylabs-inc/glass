"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api as _api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ArrowRight, Loader2 } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { FieldWithProvenance } from "./field-with-provenance";
import { usePassportSaver } from "./use-passport-saver";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;

const BUSINESS_FIELDS = [
  "businessDescription",
  "naicsCode",
  "yearsInBusiness",
  "numberOfEmployees",
  "annualRevenue",
] as const;

type BusinessField = (typeof BUSINESS_FIELDS)[number];

type ProvenanceRow = {
  fieldPath: string;
  confidence: "confirmed" | "suggested";
  suggestedValue?: unknown;
};

type DraftState = Record<BusinessField, string>;
type TouchedState = Record<BusinessField, boolean>;

const EMPTY_DRAFT: DraftState = {
  businessDescription: "",
  naicsCode: "",
  yearsInBusiness: "",
  numberOfEmployees: "",
  annualRevenue: "",
};

const EMPTY_TOUCHED: TouchedState = {
  businessDescription: false,
  naicsCode: false,
  yearsInBusiness: false,
  numberOfEmployees: false,
  annualRevenue: false,
};

function fromUnknown(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export function SectionNatureOfBusiness({ clientOrgId }: { clientOrgId: string }) {
  const router = useRouter();
  const orgId = clientOrgId as Id<"organizations">;
  const passportData = useQuery(api.clientPassport.getFull, {});
  const acceptSuggestion = useMutation(api.passportSideTables.acceptSuggestion);
  const dismissSuggestion = useMutation(api.passportSideTables.dismissSuggestion);
  const { save, flush } = usePassportSaver();

  const passport = passportData?.passport ?? null;
  const provenance = useMemo(
    () => (passportData?.provenance ?? []) as ProvenanceRow[],
    [passportData?.provenance],
  );

  const suggestedValues = useMemo(() => {
    const out: Partial<Record<BusinessField, string>> = {};
    for (const field of BUSINESS_FIELDS) {
      const row = provenance.find((p) => p.fieldPath === field);
      const value = fromUnknown(row?.suggestedValue);
      if (value) out[field] = value;
    }
    return out;
  }, [provenance]);

  const getProvenance = useMemo(
    () => (fieldPath: BusinessField) => provenance.find((p) => p.fieldPath === fieldPath),
    [provenance],
  );

  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [touched, setTouched] = useState<TouchedState>(EMPTY_TOUCHED);
  const [saving, setSaving] = useState(false);
  const descRef = useRef<HTMLTextAreaElement | null>(null);

  const setField = (field: BusinessField, value: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setDraft((prev) => ({ ...prev, [field]: value }));
    const trimmed = value.trim();
    if (field === "yearsInBusiness" || field === "numberOfEmployees") {
      const n = parseInt(trimmed, 10);
      save(field, Number.isFinite(n) ? n : undefined);
    } else {
      save(field, trimmed || undefined);
    }
  };

  const resolved = {
    businessDescription: touched.businessDescription
      ? draft.businessDescription
      : (passport?.businessDescription ?? suggestedValues.businessDescription ?? ""),
    naicsCode: touched.naicsCode
      ? draft.naicsCode
      : (passport?.naicsCode ?? suggestedValues.naicsCode ?? ""),
    yearsInBusiness: touched.yearsInBusiness
      ? draft.yearsInBusiness
      : (passport?.yearsInBusiness?.toString() ?? suggestedValues.yearsInBusiness ?? ""),
    numberOfEmployees: touched.numberOfEmployees
      ? draft.numberOfEmployees
      : (passport?.numberOfEmployees?.toString() ?? suggestedValues.numberOfEmployees ?? ""),
    annualRevenue: touched.annualRevenue
      ? draft.annualRevenue
      : (passport?.annualRevenue ?? suggestedValues.annualRevenue ?? ""),
  };

  const autoSizeTextarea = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    autoSizeTextarea(descRef.current);
  }, [resolved.businessDescription]);

  if (passportData === undefined) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }

  const canContinue = resolved.businessDescription.trim().length > 0;

  async function handleNext() {
    setSaving(true);
    try {
      flush();
      router.push("/onboarding/passport/operations");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

  return (
    <div className="space-y-5">
      <FieldWithProvenance
        fieldPath="businessDescription"
        currentValue={resolved.businessDescription}
        provenance={getProvenance("businessDescription")}
        onAccept={() => {
          const p = getProvenance("businessDescription");
          if (p?.suggestedValue !== undefined) setField("businessDescription", String(p.suggestedValue));
          void acceptSuggestion({ clientOrgId: orgId, fieldPath: "businessDescription" });
        }}
        onDismiss={() => void dismissSuggestion({ clientOrgId: orgId, fieldPath: "businessDescription" })}
        label="Business description *"
      >
        <textarea
          ref={descRef}
          value={resolved.businessDescription}
          onChange={(e) => setField("businessDescription", e.target.value)}
          onInput={(e) => autoSizeTextarea(e.currentTarget)}
          rows={3}
          placeholder="Describe the business..."
          className={`${inputClass} min-h-28 resize-none overflow-hidden`}
        />
      </FieldWithProvenance>

      <FieldWithProvenance
        fieldPath="naicsCode"
        currentValue={resolved.naicsCode}
        provenance={getProvenance("naicsCode")}
        onAccept={() => {
          const p = getProvenance("naicsCode");
          if (p?.suggestedValue !== undefined) setField("naicsCode", String(p.suggestedValue));
          void acceptSuggestion({ clientOrgId: orgId, fieldPath: "naicsCode" });
        }}
        onDismiss={() => void dismissSuggestion({ clientOrgId: orgId, fieldPath: "naicsCode" })}
        label="NAICS code"
      >
        <input
          type="text"
          value={resolved.naicsCode}
          onChange={(e) => setField("naicsCode", e.target.value)}
          placeholder="e.g. 541511"
          className={inputClass}
        />
      </FieldWithProvenance>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FieldWithProvenance
          fieldPath="yearsInBusiness"
          currentValue={resolved.yearsInBusiness}
          provenance={getProvenance("yearsInBusiness")}
          onAccept={() => {
            const p = getProvenance("yearsInBusiness");
            if (p?.suggestedValue !== undefined) setField("yearsInBusiness", String(p.suggestedValue));
            void acceptSuggestion({ clientOrgId: orgId, fieldPath: "yearsInBusiness" });
          }}
          onDismiss={() => void dismissSuggestion({ clientOrgId: orgId, fieldPath: "yearsInBusiness" })}
          label="Years in business"
        >
          <input
            type="number"
            value={resolved.yearsInBusiness}
            onChange={(e) => setField("yearsInBusiness", e.target.value)}
            placeholder="12"
            className={inputClass}
          />
        </FieldWithProvenance>

        <FieldWithProvenance
          fieldPath="numberOfEmployees"
          currentValue={resolved.numberOfEmployees}
          provenance={getProvenance("numberOfEmployees")}
          onAccept={() => {
            const p = getProvenance("numberOfEmployees");
            if (p?.suggestedValue !== undefined) setField("numberOfEmployees", String(p.suggestedValue));
            void acceptSuggestion({ clientOrgId: orgId, fieldPath: "numberOfEmployees" });
          }}
          onDismiss={() => void dismissSuggestion({ clientOrgId: orgId, fieldPath: "numberOfEmployees" })}
          label="Employees"
        >
          <input
            type="number"
            value={resolved.numberOfEmployees}
            onChange={(e) => setField("numberOfEmployees", e.target.value)}
            placeholder="50"
            className={inputClass}
          />
        </FieldWithProvenance>
      </div>

      <FieldWithProvenance
        fieldPath="annualRevenue"
        currentValue={resolved.annualRevenue}
        provenance={getProvenance("annualRevenue")}
        onAccept={() => {
          const p = getProvenance("annualRevenue");
          if (p?.suggestedValue !== undefined) setField("annualRevenue", String(p.suggestedValue));
          void acceptSuggestion({ clientOrgId: orgId, fieldPath: "annualRevenue" });
        }}
        onDismiss={() => void dismissSuggestion({ clientOrgId: orgId, fieldPath: "annualRevenue" })}
        label="Annual revenue"
      >
        <input
          type="text"
          value={resolved.annualRevenue}
          onChange={(e) => setField("annualRevenue", e.target.value)}
          placeholder="$5,000,000"
          className={inputClass}
        />
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
