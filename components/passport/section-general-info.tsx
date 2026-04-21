"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api as _api } from "@/convex/_generated/api";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;
import { ArrowRight, Loader2 } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
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

export function SectionGeneralInfo() {
  const router = useRouter();
  const passportData = useQuery(api.clientPassport.getFull, {});
  const upsertCore = useMutation(api.clientPassport.upsertCore);

  const passport = passportData?.passport;

  const [hasPriorBankruptcy, setHasPriorBankruptcy] = useState<boolean | undefined>(passport?.hasPriorBankruptcy);
  const [bankruptcyDetails, setBankruptcyDetails] = useState(passport?.bankruptcyDetails ?? "");
  const [hasPriorCancellation, setHasPriorCancellation] = useState<boolean | undefined>(passport?.hasPriorCancellation);
  const [cancellationDetails, setCancellationDetails] = useState(passport?.cancellationDetails ?? "");
  const [hasForeignOperations, setHasForeignOperations] = useState<boolean | undefined>(passport?.hasForeignOperations);
  const [foreignDetails, setForeignDetails] = useState(passport?.foreignOperationsDetails ?? "");
  const [ownershipNotes, setOwnershipNotes] = useState(passport?.ownershipNotes ?? "");
  const [saving, setSaving] = useState(false);

  if (passportData === undefined) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  const canContinue =
    hasPriorBankruptcy !== undefined &&
    hasPriorCancellation !== undefined &&
    hasForeignOperations !== undefined;

  async function handleFinishCore() {
    setSaving(true);
    try {
      await upsertCore({
        patch: {
          hasPriorBankruptcy,
          bankruptcyDetails: bankruptcyDetails.trim() || undefined,
          hasPriorCancellation,
          cancellationDetails: cancellationDetails.trim() || undefined,
          hasForeignOperations,
          foreignOperationsDetails: foreignDetails.trim() || undefined,
          ownershipNotes: ownershipNotes.trim() || undefined,
          markCoreComplete: true,
        },
      });
      router.push("/onboarding/passport/extended");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

  return (
    <div className="space-y-6">
      <YesNo value={hasPriorBankruptcy} onChange={setHasPriorBankruptcy} label="Has the business declared bankruptcy in the past 5 years? *" />
      {hasPriorBankruptcy && (
        <div className="space-y-2">
          <label className="text-label-sm font-medium text-muted-foreground block">Bankruptcy details</label>
          <textarea value={bankruptcyDetails} onChange={(e) => setBankruptcyDetails(e.target.value)} rows={2} className={inputClass} />
        </div>
      )}

      <YesNo value={hasPriorCancellation} onChange={setHasPriorCancellation} label="Has any policy been cancelled or non-renewed in the past 3 years? *" />
      {hasPriorCancellation && (
        <div className="space-y-2">
          <label className="text-label-sm font-medium text-muted-foreground block">Cancellation details</label>
          <textarea value={cancellationDetails} onChange={(e) => setCancellationDetails(e.target.value)} rows={2} className={inputClass} />
        </div>
      )}

      <YesNo value={hasForeignOperations} onChange={setHasForeignOperations} label="Does the business have foreign operations? *" />
      {hasForeignOperations && (
        <div className="space-y-2">
          <label className="text-label-sm font-medium text-muted-foreground block">Foreign operations details</label>
          <textarea value={foreignDetails} onChange={(e) => setForeignDetails(e.target.value)} rows={2} className={inputClass} />
        </div>
      )}

      <div className="space-y-2">
        <label className="text-label-sm font-medium text-muted-foreground block">Ownership notes</label>
        <textarea value={ownershipNotes} onChange={(e) => setOwnershipNotes(e.target.value)} rows={2} placeholder="Ownership structure, parent/subsidiary relationships..." className={inputClass} />
      </div>

      <PillButton type="button" onClick={handleFinishCore} disabled={!canContinue || saving} className="w-full justify-center text-sm shadow-none sm:w-auto">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Continue
        {!saving ? <ArrowRight className="h-4 w-4" /> : null}
      </PillButton>
    </div>
  );
}
