"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api as _api } from "@/convex/_generated/api";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;
import { ArrowRight, Loader2 } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { usePassportSaver } from "./use-passport-saver";
import { toast } from "sonner";

function YesNo({
  value,
  onChange,
  label,
}: {
  value: boolean | undefined;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-label-sm font-medium text-muted-foreground">{label}</p>
      <div className="flex gap-3">
        {([true, false] as const).map((opt) => (
          <button
            key={String(opt)}
            type="button"
            onClick={() => onChange(opt)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
              value === opt
                ? "border-foreground bg-foreground text-background"
                : "border-foreground/8 bg-popover text-foreground hover:border-foreground/20"
            }`}
          >
            {opt ? "Yes" : "No"}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SectionDisclosures() {
  const router = useRouter();
  const passportData = useQuery(api.clientPassport.getFull, {});
  const { save, flush } = usePassportSaver();

  const passport = passportData?.passport;

  const [hasPriorBankruptcy, setHasPriorBankruptcy] = useState<boolean | undefined>(undefined);
  const [bankruptcyDetails, setBankruptcyDetails] = useState("");
  const [hasPriorCancellation, setHasPriorCancellation] = useState<boolean | undefined>(undefined);
  const [cancellationDetails, setCancellationDetails] = useState("");
  const [hasForeignOperations, setHasForeignOperations] = useState<boolean | undefined>(undefined);
  const [foreignDetails, setForeignDetails] = useState("");
  const [saving, setSaving] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current || !passportData) return;
    const p = passportData.passport;
    if (p?.hasPriorBankruptcy !== undefined) setHasPriorBankruptcy(p.hasPriorBankruptcy);
    if (p?.bankruptcyDetails) setBankruptcyDetails(p.bankruptcyDetails);
    if (p?.hasPriorCancellation !== undefined) setHasPriorCancellation(p.hasPriorCancellation);
    if (p?.cancellationDetails) setCancellationDetails(p.cancellationDetails);
    if (p?.hasForeignOperations !== undefined) setHasForeignOperations(p.hasForeignOperations);
    if (p?.foreignOperationsDetails) setForeignDetails(p.foreignOperationsDetails);
    hydratedRef.current = true;
  }, [passportData]);

  if (passportData === undefined) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  const canContinue =
    hasPriorBankruptcy !== undefined &&
    hasPriorCancellation !== undefined &&
    hasForeignOperations !== undefined;

  async function handleNext() {
    setSaving(true);
    try {
      flush();
      router.push("/onboarding/passport/ownership");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

  return (
    <div className="space-y-5">
      <YesNo value={hasPriorBankruptcy} onChange={(v) => { setHasPriorBankruptcy(v); save("hasPriorBankruptcy", v); }} label="Has the business declared bankruptcy in the past 5 years? *" />
      {hasPriorBankruptcy && (
        <div className="space-y-2">
          <label className="text-label-sm font-medium text-muted-foreground block">Bankruptcy details</label>
          <textarea value={bankruptcyDetails} onChange={(e) => { setBankruptcyDetails(e.target.value); save("bankruptcyDetails", e.target.value.trim() || undefined); }} rows={2} className={`${inputClass} min-h-20 resize-y`} />
        </div>
      )}

      <YesNo value={hasPriorCancellation} onChange={(v) => { setHasPriorCancellation(v); save("hasPriorCancellation", v); }} label="Has any policy been cancelled or non-renewed in the past 3 years? *" />
      {hasPriorCancellation && (
        <div className="space-y-2">
          <label className="text-label-sm font-medium text-muted-foreground block">Cancellation details</label>
          <textarea value={cancellationDetails} onChange={(e) => { setCancellationDetails(e.target.value); save("cancellationDetails", e.target.value.trim() || undefined); }} rows={2} className={`${inputClass} min-h-20 resize-y`} />
        </div>
      )}

      <YesNo value={hasForeignOperations} onChange={(v) => { setHasForeignOperations(v); save("hasForeignOperations", v); }} label="Does the business have foreign operations? *" />
      {hasForeignOperations && (
        <div className="space-y-2">
          <label className="text-label-sm font-medium text-muted-foreground block">Foreign operations details</label>
          <textarea value={foreignDetails} onChange={(e) => { setForeignDetails(e.target.value); save("foreignOperationsDetails", e.target.value.trim() || undefined); }} rows={2} className={`${inputClass} min-h-20 resize-y`} />
        </div>
      )}

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
