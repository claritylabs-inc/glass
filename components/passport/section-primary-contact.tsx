"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api as _api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;
import { ArrowRight, Loader2 } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { FieldWithProvenance } from "./field-with-provenance";
import { PhoneInput } from "@/components/ui/phone-input";
import { usePassportSaver } from "./use-passport-saver";
import { toast } from "sonner";

function toE164(value: string): string {
  if (!value) return "";
  if (value.startsWith("+")) return value;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return value;
}

export function SectionPrimaryContact({ clientOrgId }: { clientOrgId: string }) {
  const router = useRouter();
  const orgId = clientOrgId as Id<"organizations">;
  const passportData = useQuery(api.clientPassport.getFull, {});
  const viewer = useQuery(api.users.viewer);
  const acceptSuggestion = useMutation(api.passportSideTables.acceptSuggestion);
  const dismissSuggestion = useMutation(api.passportSideTables.dismissSuggestion);
  const { save, flush } = usePassportSaver();

  const passport = passportData?.passport;
  const provenance = passportData?.provenance ?? [];

  const getProvenance = (fieldPath: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provenance.find((p: any) => p.fieldPath === fieldPath);

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current || !passportData) return;
    const p = passportData.passport;
    if (p?.primaryContactName) setName(p.primaryContactName);
    else if (viewer?.name) setName(viewer.name);
    if (p?.primaryContactTitle) setTitle(p.primaryContactTitle);
    if (p?.primaryContactEmail) setEmail(p.primaryContactEmail);
    else if (viewer?.email) setEmail(viewer.email);
    if (p?.primaryContactPhone) setPhone(toE164(p.primaryContactPhone));
    hydratedRef.current = true;
  }, [passportData, viewer?.name, viewer?.email]);

  if (passportData === undefined) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }

  const canContinue = email.trim().length > 0;

  async function handleNext() {
    setSaving(true);
    try {
      flush();
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
    <div className="space-y-5">
      <FieldWithProvenance
        fieldPath="primaryContactName"
        currentValue={name}
        provenance={getProvenance("primaryContactName")}
        onAccept={() => {
          const p = getProvenance("primaryContactName");
          if (p?.suggestedValue) setName(String(p.suggestedValue));
          void acceptSuggestion({ clientOrgId: orgId, fieldPath: "primaryContactName" });
        }}
        onDismiss={() => void dismissSuggestion({ clientOrgId: orgId, fieldPath: "primaryContactName" })}
        label="Primary contact name"
      >
        <input type="text" value={name} onChange={(e) => { setName(e.target.value); save("primaryContactName", e.target.value.trim() || undefined); }} placeholder="Jane Smith" className={inputClass} />
      </FieldWithProvenance>

      <FieldWithProvenance fieldPath="primaryContactTitle" currentValue={title} label="Contact title">
        <input type="text" value={title} onChange={(e) => { setTitle(e.target.value); save("primaryContactTitle", e.target.value.trim() || undefined); }} placeholder="CFO" className={inputClass} />
      </FieldWithProvenance>

      <FieldWithProvenance
        fieldPath="primaryContactEmail"
        currentValue={email}
        provenance={getProvenance("primaryContactEmail")}
        onAccept={() => {
          const p = getProvenance("primaryContactEmail");
          if (p?.suggestedValue) setEmail(String(p.suggestedValue));
          void acceptSuggestion({ clientOrgId: orgId, fieldPath: "primaryContactEmail" });
        }}
        onDismiss={() => void dismissSuggestion({ clientOrgId: orgId, fieldPath: "primaryContactEmail" })}
        label="Contact email *"
      >
        <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); save("primaryContactEmail", e.target.value.trim() || undefined); }} placeholder="jane@acme.com" className={inputClass} />
      </FieldWithProvenance>

      <FieldWithProvenance fieldPath="primaryContactPhone" currentValue={phone} label="Contact phone">
        <PhoneInput
          defaultCountry="US"
          value={phone}
          onChange={(value) => { const v = value ?? ""; setPhone(v); save("primaryContactPhone", v.trim() || undefined); }}
          placeholder="Enter best contact number"
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
