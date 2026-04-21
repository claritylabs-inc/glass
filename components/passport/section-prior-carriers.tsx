"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api as _api } from "@/convex/_generated/api";
import { ArrowLeft, ArrowRight, Loader2, Plus, Trash2 } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;

export function SectionPriorCarriers() {
  const router = useRouter();
  const passportData = useQuery(api.clientPassport.getFull, {});
  const addPriorCarrier = useMutation(api.passportSideTables.addPriorCarrier);
  const removePriorCarrier = useMutation(api.passportSideTables.removePriorCarrier);

  const [showForm, setShowForm] = useState(false);
  const [carrierName, setCarrierName] = useState("");
  const [lineOfBusiness, setLineOfBusiness] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [premium, setPremium] = useState("");
  const [saving, setSaving] = useState(false);

  const carriers = (passportData?.priorCarriers ?? []) as any[];

  const inputClass = "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

  if (passportData === undefined) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  async function handleAdd() {
    setSaving(true);
    try {
      await addPriorCarrier({
        carrierName: carrierName.trim() || undefined,
        lineOfBusiness: lineOfBusiness.trim() || undefined,
        policyNumber: policyNumber.trim() || undefined,
        effectiveDate: effectiveDate || undefined,
        expirationDate: expirationDate || undefined,
        premium: premium.trim() || undefined,
      });
      setCarrierName(""); setLineOfBusiness(""); setPolicyNumber("");
      setEffectiveDate(""); setExpirationDate(""); setPremium("");
      setShowForm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {carriers.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground">No prior carriers added.</p>
      )}

      {carriers.map((c: any) => (
        <div key={c._id} className="flex items-start justify-between rounded-xl border border-foreground/8 bg-popover/60 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">{c.carrierName ?? "Unnamed carrier"}</p>
            {c.lineOfBusiness && <p className="mt-0.5 text-xs text-muted-foreground">{c.lineOfBusiness}</p>}
            {c.policyNumber && <p className="mt-0.5 text-xs text-muted-foreground">Policy: {c.policyNumber}</p>}
          </div>
          <button
            type="button"
            onClick={() => void removePriorCarrier({ carrierId: c._id })}
            className="ml-3 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}

      {showForm && (
        <div className="space-y-3 rounded-xl border border-foreground/8 bg-popover/60 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-label-sm font-medium text-muted-foreground block">Carrier name</label>
              <input type="text" value={carrierName} onChange={(e) => setCarrierName(e.target.value)} placeholder="Acme Insurance Co." className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label className="text-label-sm font-medium text-muted-foreground block">Line of business</label>
              <input type="text" value={lineOfBusiness} onChange={(e) => setLineOfBusiness(e.target.value)} placeholder="General Liability" className={inputClass} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-label-sm font-medium text-muted-foreground block">Policy number</label>
              <input type="text" value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} placeholder="GL-12345" className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label className="text-label-sm font-medium text-muted-foreground block">Premium</label>
              <input type="text" value={premium} onChange={(e) => setPremium(e.target.value)} placeholder="$10,000" className={inputClass} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-label-sm font-medium text-muted-foreground block">Effective date</label>
              <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label className="text-label-sm font-medium text-muted-foreground block">Expiration date</label>
              <input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} className={inputClass} />
            </div>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleAdd()}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {saving ? "Saving..." : "Add carrier"}
          </button>
        </div>
      )}

      {!showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 text-sm font-medium text-foreground hover:opacity-70 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          Add carrier
        </button>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <PillButton type="button" onClick={() => router.push("/onboarding/passport/extended")} className="text-sm shadow-none">
          Done
          <ArrowRight className="h-4 w-4" />
        </PillButton>
      </div>
    </div>
  );
}
