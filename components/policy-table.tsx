"use client";

import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import { FadeIn } from "@/components/ui/fade-in";

interface Policy {
  _id: string;
  carrier: string;
  policyNumber: string;
  policyType: string;
  policyYear: number;
  effectiveDate: string;
  expirationDate: string;
  isRenewal: boolean;
  premium?: string;
  insuredName: string;
  extractionStatus: string;
}

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

export function PolicyTable({ policies }: { policies: Policy[] | undefined }) {
  if (!policies || policies.length === 0) {
    return (
      <FadeIn when={true} duration={0.6}>
        <div className="rounded-lg border border-foreground/6 bg-white/60 px-6 py-12 text-center text-muted-foreground">
          No policies found. Connect an email inbox or seed demo data to get
          started.
        </div>
      </FadeIn>
    );
  }

  return (
    <FadeIn when={true} delay={0.2} duration={0.6}>
      <div className="rounded-lg border border-foreground/6 bg-white/60 overflow-hidden">
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-left min-w-[700px]">
            <thead>
              <tr className="bg-foreground/[0.02]">
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  Policy
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  Type
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap hidden md:table-cell">
                  Carrier
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right">
                  Premium
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right hidden md:table-cell">
                  Period
                </th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right">
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
                    className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors"
                  >
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <p className="text-body-sm text-foreground font-medium">
                        {policy.policyNumber}
                      </p>
                      <p className="text-label-sm text-muted-foreground/60 font-mono">
                        {policy.insuredName}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium ${
                          TYPE_COLORS[policy.policyType] || TYPE_COLORS.other
                        }`}
                      >
                        {POLICY_TYPE_LABELS[policy.policyType] ||
                          policy.policyType}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-body-sm text-muted-foreground hidden md:table-cell whitespace-nowrap">
                      {policy.carrier}
                    </td>
                    <td className="px-4 py-2.5 text-body-sm font-mono font-medium text-foreground text-right whitespace-nowrap">
                      {policy.premium || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-body-sm text-muted-foreground text-right hidden md:table-cell whitespace-nowrap">
                      {policy.effectiveDate} – {policy.expirationDate}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <Link
                        href={`/policies/${policy._id}`}
                        className="px-2.5 py-1 rounded-md border border-foreground/12 bg-white/80 text-label-sm font-medium text-foreground hover:border-foreground/20 hover:bg-foreground/[0.03] transition-colors"
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
