"use client";

import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import { FadeIn } from "@/components/ui/fade-in";
import { Skeleton } from "@/components/ui/skeleton";
import dayjs from "dayjs";

interface Quote {
  _id: string;
  carrier: string;
  quoteNumber: string;
  policyTypes?: string[];
  quoteYear: number;
  proposedEffectiveDate?: string;
  proposedExpirationDate?: string;
  quoteExpirationDate?: string;
  isRenewal: boolean;
  premium?: string;
  insuredName: string;
  extractionStatus: string;
  isDemo?: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  general_liability: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
  workers_comp: "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400",
  commercial_auto: "bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400",
  non_owned_auto: "bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400",
  property: "bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400",
  umbrella: "bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400",
  professional_liability: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400",
  cyber: "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400",
  epli: "bg-pink-100 dark:bg-pink-950/40 text-pink-700 dark:text-pink-400",
  directors_officers: "bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400",
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
            <Skeleton className="h-4 w-24 ml-auto" />
          </td>
          <td className="px-4 py-2.5 hidden lg:table-cell text-right">
            <Skeleton className="h-4 w-24 ml-auto" />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

function isExpired(q: { quoteExpirationDate?: string }) {
  if (!q.quoteExpirationDate) return false;
  const expDate = dayjs(q.quoteExpirationDate, "MM/DD/YYYY");
  return expDate.isValid() && expDate.isBefore(dayjs());
}

export function QuoteTable({ quotes }: { quotes: Quote[] | undefined }) {
  const router = useRouter();

  if (quotes === undefined) {
    return (
      <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-left md:min-w-[700px]">
            <thead>
              <tr className="bg-foreground/[0.02]">
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Quote</th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap hidden sm:table-cell">Type</th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap hidden md:table-cell">Producer</th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right">Premium</th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right hidden md:table-cell">Proposed Effective</th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right hidden lg:table-cell">Expires</th>
              </tr>
            </thead>
            <SkeletonRows />
          </table>
        </div>
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <FadeIn when={true} duration={0.6}>
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-6 py-8 text-center">
          <p className="text-body-sm text-muted-foreground/60">No quotes found</p>
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
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Quote</th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap hidden sm:table-cell">Type</th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap hidden md:table-cell">Producer</th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right">Premium</th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right hidden md:table-cell">Proposed Effective</th>
                <th className="px-4 py-2.5 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right hidden lg:table-cell">Expires</th>
              </tr>
            </thead>
            <AnimatePresence mode="wait">
              <motion.tbody
                key={quotes.map((q) => q._id).join(",")}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {quotes.map((quote, i) => {
                  const types = quote.policyTypes ?? ["other"];
                  const expired = isExpired(quote);
                  return (
                    <FadeIn
                      key={quote._id}
                      as="tr"
                      when={true}
                      delay={i * 0.02}
                      duration={0.35}
                      direction="none"
                      className="border-t border-foreground/4 hover:bg-foreground/[0.015] transition-colors cursor-pointer"
                      onClick={() => router.push(`/quotes/${quote._id}`)}
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <p className="text-body-sm text-foreground font-medium flex items-center gap-1.5">
                          {quote.quoteNumber}
                          {quote.isDemo && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400">Demo</span>
                          )}
                        </p>
                        <p className="text-label-sm text-muted-foreground/60 font-mono">
                          {quote.insuredName}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap hidden sm:table-cell">
                        <div className="flex items-center gap-1">
                          {(() => {
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
                        {quote.carrier}
                      </td>
                      <td className="px-4 py-2.5 text-body-sm font-mono font-medium text-foreground text-right whitespace-nowrap">
                        {quote.premium || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-body-sm text-muted-foreground text-right hidden md:table-cell whitespace-nowrap">
                        {quote.proposedEffectiveDate ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap hidden lg:table-cell">
                        <span className={`text-body-sm ${expired ? "text-red-500 font-medium" : "text-muted-foreground"}`}>
                          {quote.quoteExpirationDate ?? "—"}
                          {expired && " (expired)"}
                        </span>
                      </td>
                    </FadeIn>
                  );
                })}
              </motion.tbody>
            </AnimatePresence>
          </table>
        </div>
        <div className="border-t border-foreground/[0.04] px-4 py-2 flex items-center justify-between bg-foreground/[0.01]">
          <p className="text-label-sm text-muted-foreground/60">
            {quotes.length} {quotes.length === 1 ? "quote" : "quotes"}
          </p>
        </div>
      </div>
    </FadeIn>
  );
}
