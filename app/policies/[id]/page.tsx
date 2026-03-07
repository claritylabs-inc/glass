"use client";

import { use } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Nav } from "@/components/nav";
import { FadeIn } from "@/components/ui/fade-in";
import { ArrowLeft, Download, FileText, Calendar, Shield, DollarSign } from "lucide-react";
import Link from "next/link";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";

const TYPE_COLORS: Record<string, string> = {
  general_liability: "bg-blue-100 text-blue-700",
  workers_comp: "bg-orange-100 text-orange-700",
  commercial_auto: "bg-purple-100 text-purple-700",
  property: "bg-green-100 text-green-700",
  umbrella: "bg-sky-100 text-sky-700",
  professional_liability: "bg-amber-100 text-amber-700",
  cyber: "bg-red-100 text-red-700",
  epli: "bg-pink-100 text-pink-700",
  directors_officers: "bg-indigo-100 text-indigo-700",
  other: "bg-gray-100 text-gray-700",
};

export default function PolicyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const policy = useQuery(api.policies.get, {
    id: id as any,
  });

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

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <Link
              href="/policies"
              className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to policies
            </Link>

            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="!mb-0">{policy.policyNumber}</h1>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-label-sm font-medium ${
                      TYPE_COLORS[policy.policyType] || TYPE_COLORS.other
                    }`}
                  >
                    {POLICY_TYPE_LABELS[policy.policyType] || policy.policyType}
                  </span>
                  {policy.isRenewal && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium bg-amber-100 text-amber-700">
                      Renewal
                    </span>
                  )}
                </div>
                <p className="text-body-sm text-muted-foreground">
                  {policy.carrier} · {policy.insuredName}
                </p>
              </div>
              {policy.fileId && (
                <button
                  type="button"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-foreground/12 bg-white/80 text-label font-medium text-foreground hover:border-foreground/20 hover:bg-foreground/[0.03] transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download PDF
                </button>
              )}
            </div>
          </FadeIn>

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
                <div className="rounded-lg border border-foreground/6 bg-white/60 px-4 py-3">
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
    </div>
  );
}
