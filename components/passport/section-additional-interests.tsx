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

type Role = "mortgagee" | "loss_payee" | "additional_insured";

export function SectionAdditionalInterests() {
  const router = useRouter();
  const passportData = useQuery(api.clientPassport.getFull, {});
  const addAdditionalInterest = useMutation(api.passportSideTables.addAdditionalInterest);
  const removeAdditionalInterest = useMutation(api.passportSideTables.removeAdditionalInterest);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [relationship, setRelationship] = useState("");
  const [scope, setScope] = useState("");
  const [saving, setSaving] = useState(false);

  const interests = (passportData?.additionalInterests ?? []) as any[];

  const inputClass = "w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors";

  if (passportData === undefined) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  async function handleAdd() {
    if (!name.trim() || !role) return;
    setSaving(true);
    try {
      await addAdditionalInterest({
        name: name.trim(),
        role: role as Role,
        relationship: relationship.trim() || undefined,
        scope: scope.trim() || undefined,
      });
      setName(""); setRole(""); setRelationship(""); setScope("");
      setShowForm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  }

  const roleLabels: Record<Role, string> = {
    mortgagee: "Mortgagee",
    loss_payee: "Loss Payee",
    additional_insured: "Additional Insured",
  };

  return (
    <div className="space-y-4">
      {interests.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground">No additional interests added.</p>
      )}

      {interests.map((i: any) => (
        <div key={i._id} className="flex items-start justify-between rounded-xl border border-foreground/8 bg-popover/60 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">{i.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{roleLabels[i.role as Role] ?? i.role}</p>
            {i.relationship && <p className="mt-0.5 text-xs text-muted-foreground">{i.relationship}</p>}
          </div>
          <button
            type="button"
            onClick={() => void removeAdditionalInterest({ interestId: i._id })}
            className="ml-3 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}

      {showForm && (
        <div className="space-y-3 rounded-xl border border-foreground/8 bg-popover/60 p-4">
          <div className="space-y-1.5">
            <label className="text-label-sm font-medium text-muted-foreground block">Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="First National Bank" className={inputClass} />
          </div>
          <div className="space-y-1.5">
            <label className="text-label-sm font-medium text-muted-foreground block">Role *</label>
            <select value={role} onChange={(e) => setRole(e.target.value as Role | "")} className={inputClass}>
              <option value="">Select role...</option>
              <option value="mortgagee">Mortgagee</option>
              <option value="loss_payee">Loss Payee</option>
              <option value="additional_insured">Additional Insured</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-label-sm font-medium text-muted-foreground block">Relationship</label>
            <input type="text" value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="Lender, lessor, etc." className={inputClass} />
          </div>
          <button
            type="button"
            disabled={saving || !name.trim() || !role}
            onClick={() => void handleAdd()}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {saving ? "Saving..." : "Add interest"}
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
          Add interest
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
