"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api as _api } from "@/convex/_generated/api";
import { ArrowLeft, ArrowRight, Loader2, Plus, Trash2 } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;

export function SectionLossHistory() {
  const router = useRouter();
  const passportData = useQuery(api.clientPassport.getFull, {});
  const addLoss = useMutation(api.passportSideTables.addLoss);
  const removeLoss = useMutation(api.passportSideTables.removeLoss);

  const [showForm, setShowForm] = useState(false);
  const [dateOfLoss, setDateOfLoss] = useState("");
  const [lineOfBusiness, setLineOfBusiness] = useState("");
  const [claimNumber, setClaimNumber] = useState("");
  const [description, setDescription] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [amountReserved, setAmountReserved] = useState("");
  const [status, setStatus] = useState<"open" | "closed" | "">("");
  const [saving, setSaving] = useState(false);

  const losses = (passportData?.losses ?? []) as Array<{
    _id: string;
    lineOfBusiness?: string;
    dateOfLoss?: string;
    description?: string;
    amountPaid?: string;
    confidence?: "suggested" | "confirmed";
  }>;

  const inputClass = "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

  if (passportData === undefined) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  async function handleAdd() {
    setSaving(true);
    try {
      await addLoss({
        dateOfLoss: dateOfLoss || undefined,
        lineOfBusiness: lineOfBusiness.trim() || undefined,
        claimNumber: claimNumber.trim() || undefined,
        description: description.trim() || undefined,
        amountPaid: amountPaid.trim() || undefined,
        amountReserved: amountReserved.trim() || undefined,
        status: (status as "open" | "closed") || undefined,
      });
      setDateOfLoss(""); setLineOfBusiness(""); setClaimNumber("");
      setDescription(""); setAmountPaid(""); setAmountReserved(""); setStatus("");
      setShowForm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {losses.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground">No losses recorded.</p>
      )}

      {losses.map((l) => (
        <div key={l._id} className="flex items-start justify-between rounded-xl border border-foreground/8 bg-popover/60 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              {l.lineOfBusiness ?? "Loss"} {l.dateOfLoss ? `— ${l.dateOfLoss}` : ""}
            </p>
            {l.description && <p className="mt-0.5 text-xs text-muted-foreground">{l.description}</p>}
            {l.amountPaid && <p className="mt-0.5 text-xs text-muted-foreground">Paid: {l.amountPaid}</p>}
            {l.confidence === "suggested" && (
              <span className="mt-1 inline-block rounded px-1.5 py-0.5 text-xs bg-foreground/8 text-muted-foreground">Suggested</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void removeLoss({ lossId: l._id })}
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
              <label className="text-label-sm font-medium text-muted-foreground block">Date of loss</label>
              <input type="date" value={dateOfLoss} onChange={(e) => setDateOfLoss(e.target.value)} className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label className="text-label-sm font-medium text-muted-foreground block">Line of business</label>
              <input type="text" value={lineOfBusiness} onChange={(e) => setLineOfBusiness(e.target.value)} placeholder="General Liability" className={inputClass} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-label-sm font-medium text-muted-foreground block">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Brief description of the loss..." className={`${inputClass} min-h-20 resize-y`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-label-sm font-medium text-muted-foreground block">Amount paid</label>
              <input type="text" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder="$25,000" className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label className="text-label-sm font-medium text-muted-foreground block">Status</label>
              <Select
                value={status || null}
                onValueChange={(value) => setStatus((value as "open" | "closed" | null) ?? "")}
              >
                <SelectTrigger className={inputClass}>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleAdd()}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {saving ? "Saving..." : "Add loss"}
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
          Add loss
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
