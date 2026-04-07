"use client";

import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import { FadeIn } from "@/components/ui/fade-in";
import { Skeleton } from "@/components/ui/skeleton";

interface Policy {
  _id: string;
  carrier: string;
  policyNumber: string;
  policyTypes: string[];
  policyType?: string;
  documentType?: string;
  policyYear: number;
  effectiveDate: string;
  expirationDate: string;
  isRenewal: boolean;
  premium?: string;
  insuredName: string;
  extractionStatus: string;
  isDemo?: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  general_liability: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
  commercial_property: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400",
  commercial_auto: "bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400",
  non_owned_auto: "bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400",
  workers_comp: "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400",
  umbrella: "bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400",
  excess_liability: "bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-400",
  professional_liability: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400",
  cyber: "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400",
  epli: "bg-pink-100 dark:bg-pink-950/40 text-pink-700 dark:text-pink-400",
  directors_officers: "bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400",
  fiduciary_liability: "bg-fuchsia-100 dark:bg-fuchsia-950/40 text-fuchsia-700 dark:text-fuchsia-400",
  crime_fidelity: "bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400",
  inland_marine: "bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400",
  builders_risk: "bg-yellow-100 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400",
  environmental: "bg-lime-100 dark:bg-lime-950/40 text-lime-700 dark:text-lime-400",
  ocean_marine: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
  surety: "bg-stone-100 dark:bg-stone-950/40 text-stone-700 dark:text-stone-400",
  product_liability: "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400",
  bop: "bg-slate-100 dark:bg-slate-950/40 text-slate-700 dark:text-slate-400",
  management_liability_package: "bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400",
  property: "bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400",
  other: "bg-gray-100 dark:bg-gray-800/40 text-gray-700 dark:text-gray-400",
};

function SkeletonRows() {
  return (
    <tbody>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} className="border-t border-foreground/4">
          <td className="px-4 py-2.5">
            <Skeleton className="h-4 w-32 mb-1.5" />
            <Skeleton className="h-3 w-24" />
          </td>
          <td className="px-4 py-2.5 hidden sm:table-cell">
            <Skeleton className="h-5 w-20 rounded-full" />
          </td>
          <td className="px-4 py-2.5 hidden md:table-cell">
            <Skeleton className="h-4 w-28" />
          </td>
          <td className="px-4 py-2.5 text-right">
            <Skeleton className="h-4 w-16 ml-auto" />
          </td>
          <td className="px-4 py-2.5 hidden md:table-cell text-right">
            <Skeleton className="h-4 w-32 ml-auto" />
          </td>
          <td className="px-4 py-2.5 hidden md:table-cell text-right">
            <Skeleton className="h-7 w-12 ml-auto rounded-md" />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

export function PolicyTable({ policies }: { policies: Policy[] | undefined }) {
  const router = useRouter();

  if (policies === undefined) {
    return (
      <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-left md:min-w-[700px]">
            <thead>
              <tr className="bg-foreground/[0.02]">
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Policy</th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap hidden sm:table-cell">Type</th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap hidden md:table-cell">Producer</th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right">Premium</th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right hidden md:table-cell">Period</th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right hidden md:table-cell">Actions</th>
              </tr>
            </thead>
            <SkeletonRows />
          </table>
        </div>
      </div>
    );
  }

  if (policies.length === 0) {
    return (
      <FadeIn when={true} duration={0.6}>
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-6 py-8 text-center">
          <p className="text-body-sm text-muted-foreground/60">No policies found</p>
        </div>
      </FadeIn>
    );
  }

  return (
    <FadeIn when={true} delay={0.2} duration={0.6}>
      <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-left md:min-w-[700px]">
            <thead>
              <tr className="bg-foreground/[0.02]">
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  Policy
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap hidden sm:table-cell">
                  Type
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap hidden md:table-cell">
                  Producer
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right">
                  Premium
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right hidden md:table-cell">
                  Period
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right hidden md:table-cell">
                  Actions
                </th>
              </tr>
            </thead>
            <AnimatePresence mode="wait">
              <motion.tbody
                key={policies.map((p) => p._id).join(",")}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {policies.map((policy, i) => (
                  <FadeIn
                    key={policy._id}
                    as="tr"
                    when={true}
                    delay={i * 0.02}
                    duration={0.35}
                    direction="none"
                    className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors cursor-pointer"
                    onClick={() => router.push(`/policies/${policy._id}`)}
                  >
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <p className="text-body-sm text-foreground font-medium flex items-center gap-1.5">
                        {policy.policyNumber}
                        {policy.documentType === "quote" && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-400">Quote</span>
                        )}
                        {policy.isDemo && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400">Demo</span>
                        )}
                      </p>
                      <p className="text-label-sm text-muted-foreground/60 font-mono">
                        {policy.insuredName}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap hidden sm:table-cell">
                      <div className="flex items-center gap-1">
                        {(() => {
                          const types = policy.policyTypes ?? [policy.policyType ?? "other"];
                          const first = types[0];
                          const overflow = types.length - 1;
                          return (
                            <>
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium ${
                                  TYPE_COLORS[first] || TYPE_COLORS.other
                                }`}
                              >
                                {POLICY_TYPE_LABELS[first] || first}
                              </span>
                              {overflow > 0 && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-label-sm font-medium bg-gray-100 dark:bg-gray-800/40 text-gray-600 dark:text-gray-400">
                                  +{overflow}
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-body-sm text-muted-foreground hidden md:table-cell whitespace-nowrap">
                      {policy.carrier}
                    </td>
                    <td className="px-4 py-2.5 text-body-sm font-mono font-medium text-foreground text-right whitespace-nowrap">
                      {policy.premium || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-body-sm text-muted-foreground text-right hidden md:table-cell whitespace-nowrap">
                      {policy.effectiveDate === "Unknown" && policy.expirationDate === "Unknown"
                        ? policy.documentType === "quote" ? "Quote" : "Unknown"
                        : `${policy.effectiveDate} – ${policy.expirationDate}`}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap hidden md:table-cell">
                      <Link
                        href={`/policies/${policy._id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="px-2.5 py-1 rounded-md border border-foreground/12 bg-white/80 dark:bg-white/[0.06] text-label-sm font-medium text-foreground hover:border-foreground/20 hover:bg-foreground/[0.03] transition-colors"
                      >
                        View
                      </Link>
                    </td>
                  </FadeIn>
                ))}
              </motion.tbody>
            </AnimatePresence>
          </table>
        </div>
        <div className="border-t border-foreground/[0.04] px-4 py-2 flex items-center justify-between bg-foreground/[0.01]">
          <p className="text-label-sm text-muted-foreground/60">
            {policies.length} {policies.length === 1 ? "policy" : "policies"}
          </p>
        </div>
      </div>
    </FadeIn>
  );
}
