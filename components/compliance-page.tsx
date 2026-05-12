"use client";

import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CheckCircle2, ClipboardCheck, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";
import { useCurrentOrg } from "@/lib/hooks/use-current-org";

type Category = "general_liability" | "auto" | "workers_comp" | "umbrella" | "professional" | "cyber" | "property" | "other";

type ComplianceApi = {
  compliance: {
    listRequirements: FunctionReference<"query">;
    upsertRequirement: FunctionReference<"mutation">;
    archiveRequirement: FunctionReference<"mutation">;
    listVendorCompliance: FunctionReference<"query">;
    getVendorChecklist: FunctionReference<"query">;
  };
};

const complianceApi = api as unknown as ComplianceApi;

const CATEGORIES: Array<{ value: Category; label: string }> = [
  { value: "general_liability", label: "General liability" },
  { value: "auto", label: "Commercial auto" },
  { value: "workers_comp", label: "Workers comp" },
  { value: "umbrella", label: "Umbrella / excess" },
  { value: "professional", label: "Professional liability" },
  { value: "cyber", label: "Cyber" },
  { value: "property", label: "Property" },
  { value: "other", label: "Other" },
];

type Requirement = {
  _id: Id<"insuranceRequirements">;
  title: string;
  category: Category;
  requirementText: string;
  appliesTo: "vendors" | "own_org" | "both";
  updatedAt: number;
};

type VendorComplianceRow = {
  relationshipId: Id<"connectedOrgRelationships">;
  vendorOrg: { _id: Id<"organizations">; name: string; website?: string } | null;
  status: "compliant" | "non_compliant" | "attention" | "no_requirements";
  requirementCount: number;
  metCount: number;
  missingCount: number;
  expiringSoonCount: number;
  checks: Array<{
    requirementId: Id<"insuranceRequirements">;
    status: "met" | "missing" | "expiring_soon" | "expired";
    notes: string;
    expiresAt?: string;
    daysUntilExpiration?: number;
  }>;
};

type VendorChecklist = Array<{
  clientOrg: { _id: Id<"organizations">; name: string; website?: string } | null;
  checks: Array<{
    requirement: Requirement;
    status: "met" | "missing" | "expiring_soon" | "expired";
    notes: string;
    expiresAt?: string;
  }>;
}>;

function statusClasses(status: string) {
  if (status === "compliant" || status === "met") return "border-emerald-500/15 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300";
  if (status === "attention" || status === "expiring_soon") return "border-amber-500/15 bg-amber-500/8 text-amber-700 dark:text-amber-300";
  if (status === "non_compliant" || status === "missing" || status === "expired") return "border-red-500/15 bg-red-500/8 text-red-700 dark:text-red-300";
  return "border-foreground/10 bg-foreground/[0.03] text-muted-foreground";
}

function StatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, " ");
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${statusClasses(status)}`}>{label}</span>;
}

export function CompliancePage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.orgId as Id<"organizations"> | undefined;
  const requirements = useQuery(complianceApi.compliance.listRequirements, orgId ? { orgId } : "skip") as Requirement[] | undefined;
  const vendorCompliance = useQuery(complianceApi.compliance.listVendorCompliance, orgId ? { clientOrgId: orgId } : "skip") as VendorComplianceRow[] | undefined;
  const vendorChecklist = useQuery(complianceApi.compliance.getVendorChecklist, orgId ? { vendorOrgId: orgId } : "skip") as VendorChecklist | undefined;
  const upsertRequirement = useMutation(complianceApi.compliance.upsertRequirement);
  const archiveRequirement = useMutation(complianceApi.compliance.archiveRequirement);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("general_liability");
  const [requirementText, setRequirementText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const summary = useMemo(() => {
    const rows = vendorCompliance ?? [];
    return {
      vendors: rows.length,
      compliant: rows.filter((row) => row.status === "compliant").length,
      attention: rows.filter((row) => row.status === "attention").length,
      nonCompliant: rows.filter((row) => row.status === "non_compliant").length,
    };
  }, [vendorCompliance]);

  async function submitRequirement(event: FormEvent) {
    event.preventDefault();
    if (!orgId) return;
    setSubmitting(true);
    try {
      await upsertRequirement({ orgId, title, category, requirementText, appliesTo: "vendors", minimumRequired: true });
      toast.success("Compliance requirement saved");
      setTitle("");
      setRequirementText("");
      setCategory("general_liability");
      setShowForm(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save requirement");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeRequirement(requirementId: Id<"insuranceRequirements">) {
    if (!orgId) return;
    try {
      await archiveRequirement({ orgId, requirementId });
      toast.success("Requirement archived");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to archive requirement");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-foreground/8 bg-foreground/[0.03] px-3 py-1 text-xs text-muted-foreground">
            <ClipboardCheck className="h-3.5 w-3.5" /> Compliance
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Insurance compliance</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Set plain-language insurance requirements once, then monitor connected contractors against uploaded policies and expiration dates.
          </p>
        </div>
        <PillButton onClick={() => setShowForm((open) => !open)}>
          <Plus className="h-4 w-4" /> Add requirement
        </PillButton>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Connected vendors", summary.vendors],
          ["Compliant", summary.compliant],
          ["Needs attention", summary.attention],
          ["Non-compliant", summary.nonCompliant],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-foreground/8 bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
          </div>
        ))}
      </div>

      {showForm ? (
        <form onSubmit={submitRequirement} className="rounded-2xl border border-foreground/8 bg-card p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-[1fr_220px]">
            <label className="space-y-1.5 text-sm font-medium text-foreground">
              Requirement title
              <input className="w-full rounded-xl border border-foreground/10 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="General liability minimum" required />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-foreground">
              Category
              <select className="w-full rounded-xl border border-foreground/10 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30" value={category} onChange={(event) => setCategory(event.target.value as Category)}>
                {CATEGORIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
          <label className="mt-4 block space-y-1.5 text-sm font-medium text-foreground">
            Plain-language requirement
            <textarea className="min-h-24 w-full rounded-xl border border-foreground/10 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30" value={requirementText} onChange={(event) => setRequirementText(event.target.value)} placeholder="Contractors must carry active CGL with at least $1M per occurrence and $2M aggregate." required />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <PillButton type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</PillButton>
            <PillButton type="submit" disabled={submitting}>{submitting ? "Saving…" : "Save requirement"}</PillButton>
          </div>
        </form>
      ) : null}

      <section className="rounded-2xl border border-foreground/8 bg-card shadow-sm">
        <div className="border-b border-foreground/8 px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Requirements</h2>
          <p className="mt-1 text-xs text-muted-foreground">Client requirements establish the minimum standard vendors must satisfy.</p>
        </div>
        {(requirements ?? []).length === 0 ? (
          <div className="px-5 py-8 text-sm text-muted-foreground">No requirements yet. Add the first checklist item for your contractors.</div>
        ) : requirements?.map((requirement) => (
          <div key={requirement._id} className="flex items-start justify-between gap-4 border-b border-foreground/6 px-5 py-4 last:border-b-0">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-foreground">{requirement.title}</p>
                <StatusBadge status={requirement.category} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{requirement.requirementText}</p>
            </div>
            <PillButton size="compact" variant="secondary" onClick={() => removeRequirement(requirement._id)}>
              <Trash2 className="h-3.5 w-3.5" /> Archive
            </PillButton>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-foreground/8 bg-card shadow-sm">
        <div className="border-b border-foreground/8 px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Connected vendor monitoring</h2>
          <p className="mt-1 text-xs text-muted-foreground">Each active Connect vendor is checked against your requirements using extracted policy data.</p>
        </div>
        {(vendorCompliance ?? []).length === 0 ? (
          <div className="px-5 py-8 text-sm text-muted-foreground">No active vendors yet. Invite contractors from Connect → Clients.</div>
        ) : vendorCompliance?.map((row) => (
          <div key={row.relationshipId} className="border-b border-foreground/6 px-5 py-4 last:border-b-0">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{row.vendorOrg?.name ?? "Unknown vendor"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{row.metCount}/{row.requirementCount} requirements met · {row.missingCount} missing/expired · {row.expiringSoonCount} expiring soon</p>
              </div>
              <StatusBadge status={row.status} />
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {row.checks.map((check) => (
                <div key={check.requirementId} className="rounded-xl border border-foreground/8 bg-background/50 p-3">
                  <div className="flex items-center gap-2"><StatusBadge status={check.status} /></div>
                  <p className="mt-2 text-xs text-muted-foreground">{check.notes}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-foreground/8 bg-card shadow-sm">
        <div className="border-b border-foreground/8 px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">My contractor checklist</h2>
          <p className="mt-1 text-xs text-muted-foreground">If clients monitor your organization, this shows what they need from your uploaded policies.</p>
        </div>
        {(vendorChecklist ?? []).length === 0 ? (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground"><ShieldAlert className="h-4 w-4" /> No active client checklists for this org.</div>
        ) : vendorChecklist?.map((row, index) => (
          <div key={row.clientOrg?._id ?? index} className="border-b border-foreground/6 px-5 py-4 last:border-b-0">
            <p className="text-sm font-medium text-foreground">{row.clientOrg?.name ?? "Client"}</p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {row.checks.map((check) => (
                <div key={check.requirement._id} className="rounded-xl border border-foreground/8 bg-background/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{check.requirement.title}</p>
                    <StatusBadge status={check.status} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{check.requirement.requirementText}</p>
                  <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5" /> {check.notes}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
