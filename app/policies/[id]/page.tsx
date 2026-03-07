"use client";

import { use, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Nav } from "@/components/nav";
import { FadeIn } from "@/components/ui/fade-in";
import { ArrowLeft, Download, FileText, Calendar, Shield, DollarSign, Trash2 } from "lucide-react";
import { FixedMobileFooter } from "@/components/ui/fixed-mobile-footer";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { PillButton } from "@/components/ui/pill-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const TYPE_COLORS: Record<string, string> = {
  general_liability: "bg-blue-100 text-blue-700",
  workers_comp: "bg-orange-100 text-orange-700",
  commercial_auto: "bg-purple-100 text-purple-700",
  non_owned_auto: "bg-violet-100 text-violet-700",
  property: "bg-green-100 text-green-700",
  umbrella: "bg-sky-100 text-sky-700",
  professional_liability: "bg-amber-100 text-amber-700",
  cyber: "bg-red-100 text-red-700",
  epli: "bg-pink-100 text-pink-700",
  directors_officers: "bg-indigo-100 text-indigo-700",
  other: "bg-gray-100 text-gray-700",
};

const MAX_VISIBLE_TAGS = 3;

function PolicyTypeTags({ types }: { types: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? types : types.slice(0, MAX_VISIBLE_TAGS);
  const overflow = types.length - MAX_VISIBLE_TAGS;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2 max-w-xl items-center">
      {visible.map((t) => (
        <span
          key={t}
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-label-sm font-medium ${
            TYPE_COLORS[t] || TYPE_COLORS.other
          }`}
        >
          {POLICY_TYPE_LABELS[t] || t}
        </span>
      ))}
      {overflow > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-foreground/5 text-muted-foreground hover:bg-foreground/10 transition-colors cursor-pointer"
        >
          +{overflow} more
        </button>
      )}
    </div>
  );
}

export default function PolicyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const policy = useQuery(api.policies.get, {
    id: id as any,
  });

  const fileUrl = useQuery(
    api.policies.getFileUrl,
    policy?.fileId ? { fileId: policy.fileId as Id<"_storage"> } : "skip"
  );

  const softDelete = useMutation(api.policies.softDelete);
  const restorePolicy = useMutation(api.policies.restore);
  const router = useRouter();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (policy === undefined) {
    return (
      <div className="min-h-screen flex flex-col">
        <Nav />
        <main className="flex-1 flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </main>
      </div>
    );
  }

  if (policy === null) {
    return (
      <div className="min-h-screen flex flex-col">
        <Nav />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-muted-foreground mb-2">Policy not found</p>
            <Link
              href="/policies"
              className="text-primary hover:underline text-body-sm"
            >
              Back to policies
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const policyTypes: string[] = (policy as any).policyTypes ?? [(policy as any).policyType ?? "other"];
  const documentType: string = (policy as any).documentType ?? "policy";
  const mga: string | undefined = (policy as any).mga;
  const broker: string | undefined = (policy as any).broker;
  const isDeleted = !!(policy as any).deletedAt;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await softDelete({ id: policy._id });
      setShowDeleteDialog(false);
      router.push("/policies");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 pb-20 md:pb-0">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <Link
              href="/policies"
              className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to policies
            </Link>

            {isDeleted && (
              <div className="flex items-center gap-3 mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5">
                <p className="text-body-sm text-red-700 flex-1">This policy has been deleted.</p>
                <Button
                  variant="outline"
                  onClick={() => restorePolicy({ id: policy._id })}
                  className="text-label-sm"
                >
                  Restore
                </Button>
              </div>
            )}

            <div className="flex items-start justify-between mb-6">
              <div className="min-w-0 flex-1 mr-4">
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="!mb-0">{policy.policyNumber}</h1>
                  {documentType === "quote" && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-label-sm font-medium bg-yellow-100 text-yellow-800">
                      Quote
                    </span>
                  )}
                  {policy.isRenewal && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-amber-100 text-amber-700">
                      Renewal
                    </span>
                  )}
                </div>
                <PolicyTypeTags types={policyTypes} />

                <div className="mt-4 space-y-1">
                  {mga && (
                    <p className="text-body-sm text-foreground">
                      <span className="text-muted-foreground">MGA:</span> {mga}
                    </p>
                  )}
                  <p className="text-body-sm text-foreground">
                    <span className="text-muted-foreground">{mga ? "Carrier:" : "Carrier:"}</span> {policy.carrier}
                  </p>
                  <p className="text-body-sm text-foreground">
                    <span className="text-muted-foreground">Insured:</span> {policy.insuredName}
                  </p>
                  {broker && (
                    <p className="text-body-sm text-foreground">
                      <span className="text-muted-foreground">Broker:</span> {broker}
                    </p>
                  )}
                </div>
              </div>
              <div className="hidden md:flex items-center gap-2">
                {policy.fileId && (
                  <button
                    type="button"
                    onClick={() => {
                      if (fileUrl) window.open(fileUrl, "_blank");
                    }}
                    disabled={!fileUrl}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-foreground/12 bg-white/80 text-label font-medium text-foreground hover:border-foreground/20 hover:bg-foreground/[0.03] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download PDF
                  </button>
                )}
                {!isDeleted && (
                  <button
                    type="button"
                    onClick={() => setShowDeleteDialog(true)}
                    className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </FadeIn>

          <Dialog open={showDeleteDialog} onOpenChange={(v) => !v && setShowDeleteDialog(false)}>
            <DialogContent showCloseButton={false}>
              <DialogHeader>
                <DialogTitle>Delete Policy</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete <strong>{policy.policyNumber}</strong>? The policy can be restored later.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <PillButton variant="secondary" onClick={() => setShowDeleteDialog(false)} disabled={deleting}>
                  Cancel
                </PillButton>
                <PillButton variant="destructive" onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Deleting..." : "Delete"}
                </PillButton>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Info grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {[
              {
                icon: Calendar,
                label: "Policy Period",
                value: `${policy.effectiveDate} – ${policy.expirationDate}`,
                sub: `Policy Year: ${policy.policyYear}`,
              },
              {
                icon: DollarSign,
                label: "Premium",
                value: policy.premium || "—",
                sub: "Annual premium",
                mono: true,
                large: true,
              },
              {
                icon: Shield,
                label: "Carrier",
                value: policy.carrier,
                sub: `Status: ${policy.extractionStatus}`,
              },
            ].map((card, i) => (
              <FadeIn key={card.label} when={true} staggerIndex={i + 1} duration={0.6}>
                <div className="rounded-lg border border-foreground/6 bg-white/60 px-4 py-3 h-full">
                  <div className="flex items-center gap-2 mb-2">
                    <card.icon className="w-4 h-4 text-muted-foreground" />
                    <p className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider">
                      {card.label}
                    </p>
                  </div>
                  <p
                    className={
                      card.large
                        ? "text-lg font-semibold font-mono text-foreground-highlight"
                        : `text-body-sm font-medium text-foreground ${card.mono ? "font-mono" : ""}`
                    }
                  >
                    {card.value}
                  </p>
                  <p className="text-label-sm text-muted-foreground/60 mt-1">
                    {card.sub}
                  </p>
                </div>
              </FadeIn>
            ))}
          </div>

          {/* Summary */}
          {policy.summary && (
            <FadeIn when={true} delay={0.5} duration={0.6}>
              <div className="rounded-lg border border-foreground/6 bg-white/60 px-4 py-3 mb-6">
                <p className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Summary
                </p>
                <p className="text-body-sm text-foreground leading-relaxed">
                  {policy.summary}
                </p>
              </div>
            </FadeIn>
          )}

          {/* Coverages table */}
          <FadeIn when={true} delay={0.6} duration={0.6}>
            <div className="rounded-lg border border-foreground/6 bg-white/60 overflow-hidden">
              <div className="px-4 py-2.5 bg-foreground/[0.02] border-b border-foreground/4">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <p className="text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    Coverage Details
                  </p>
                </div>
              </div>
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-foreground/[0.02]">
                    <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider">
                      Coverage
                    </th>
                    <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider text-right">
                      Limit
                    </th>
                    <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider text-right">
                      Deductible
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {policy.coverages.map((cov, i) => (
                    <FadeIn
                      key={i}
                      as="tr"
                      when={true}
                      delay={0.65 + i * 0.02}
                      duration={0.35}
                      direction="none"
                      className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors"
                    >
                      <td className="px-4 py-2.5 text-body-sm text-foreground">
                        {cov.name}
                      </td>
                      <td className="px-4 py-2.5 text-body-sm font-mono font-medium text-foreground text-right">
                        {cov.limit}
                      </td>
                      <td className="px-4 py-2.5 text-body-sm font-mono text-muted-foreground text-right">
                        {cov.deductible || "—"}
                      </td>
                    </FadeIn>
                  ))}
                </tbody>
              </table>
            </div>
          </FadeIn>
        </div>
      </main>

      <FixedMobileFooter>
        {!isDeleted && (
          <PillButton
            variant="secondary"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </PillButton>
        )}
        {policy.fileId && (
          <PillButton
            variant="primary"
            onClick={() => { if (fileUrl) window.open(fileUrl, "_blank"); }}
            disabled={!fileUrl}
          >
            <Download className="w-3.5 h-3.5" />
            Download PDF
          </PillButton>
        )}
      </FixedMobileFooter>
    </div>
  );
}
