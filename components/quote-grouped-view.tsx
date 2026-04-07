"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import { FadeIn } from "@/components/ui/fade-in";
import dayjs from "dayjs";

interface Quote {
  _id: string;
  carrier: string;
  policyNumber: string;
  quoteNumber?: string;
  policyTypes?: string[];
  policyYear: number;
  quoteYear?: number;
  proposedEffectiveDate?: string;
  quoteExpirationDate?: string;
  isRenewal: boolean;
  premium?: string;
  insuredName: string;
  extractionStatus: string;
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

interface QuoteGroup {
  key: string;
  label: string;
  badgeColor?: string;
  quotes: Quote[];
}

function isExpired(q: { quoteExpirationDate?: string }) {
  if (!q.quoteExpirationDate) return false;
  const expDate = dayjs(q.quoteExpirationDate, "MM/DD/YYYY");
  return expDate.isValid() && expDate.isBefore(dayjs());
}

export function QuoteGroupedView({ quotes, groupBy }: { quotes: Quote[] | undefined; groupBy: "type" | "year" }) {
  const groups = useMemo<QuoteGroup[]>(() => {
    if (!quotes || quotes.length === 0) return [];

    const map = new Map<string, Quote[]>();

    if (groupBy === "type") {
      for (const quote of quotes) {
        const types = quote.policyTypes ?? ["other"];
        for (const type of types) {
          const existing = map.get(type) ?? [];
          existing.push(quote);
          map.set(type, existing);
        }
      }
    } else {
      for (const quote of quotes) {
        const key = String((quote.quoteYear ?? quote.policyYear));
        const existing = map.get(key) ?? [];
        existing.push(quote);
        map.set(key, existing);
      }
    }

    const result: QuoteGroup[] = [];
    for (const [key, groupQuotes] of map) {
      result.push({
        key,
        label: groupBy === "type" ? (POLICY_TYPE_LABELS[key] || key) : key,
        badgeColor: groupBy === "type" ? (TYPE_COLORS[key] || TYPE_COLORS.other) : undefined,
        quotes: groupQuotes,
      });
    }

    if (groupBy === "year") {
      result.sort((a, b) => Number(b.key) - Number(a.key));
    } else {
      result.sort((a, b) => a.label.localeCompare(b.label));
    }

    return result;
  }, [quotes, groupBy]);

  const router = useRouter();
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(groups.map((g) => g.key)));

  useMemo(() => {
    setOpenGroups((prev) => {
      const updated = new Set(prev);
      for (const g of groups) {
        updated.add(g.key);
      }
      return updated;
    });
  }, [groups]);

  if (!quotes || quotes.length === 0) {
    return (
      <FadeIn when={true} duration={0.6}>
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-6 py-8 text-center">
          <p className="text-body-sm text-muted-foreground/60">No quotes found</p>
        </div>
      </FadeIn>
    );
  }

  const toggleGroup = (key: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <FadeIn when={true} delay={0.2} duration={0.6}>
      <div className="space-y-3">
        {/* Master header row */}
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-left md:min-w-[700px] table-fixed">
            <colgroup>
              <col className="w-auto" />
              <col className="w-[120px] md:w-[160px]" />
              <col className="hidden md:table-column w-[180px]" />
              <col className="hidden md:table-column w-[180px]" />
            </colgroup>
            <thead>
              <tr>
                <th className="px-4 py-2 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Quote</th>
                <th className="px-4 py-2 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right">Premium</th>
                <th className="px-4 py-2 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right hidden md:table-cell">Effective</th>
                <th className="px-4 py-2 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right hidden md:table-cell">Expires</th>
              </tr>
            </thead>
          </table>
        </div>

        {groups.map((group, gi) => (
          <FadeIn key={group.key} when={true} delay={gi * 0.05} duration={0.4}>
            <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-foreground/[0.02] transition-colors cursor-pointer"
              >
                <span className="text-muted-foreground/50">
                  {openGroups.has(group.key) ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </span>
                <span className="flex items-center gap-2 flex-1 min-w-0">
                  {group.badgeColor ? (
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-label-sm font-medium ${group.badgeColor}`}>
                      {group.label}
                    </span>
                  ) : (
                    <span className="text-body-sm font-semibold text-foreground">
                      {group.label}
                    </span>
                  )}
                  <span className="text-label-sm text-muted-foreground/60">
                    {group.quotes.length} {group.quotes.length === 1 ? "quote" : "quotes"}
                  </span>
                </span>
              </button>

              {openGroups.has(group.key) && (
                <div className="border-t border-foreground/4">
                  <div className="overflow-x-auto scrollbar-hide">
                    <table className="w-full text-left md:min-w-[700px] table-fixed">
                      <colgroup>
                        <col className="w-auto" />
                        <col className="w-[120px] md:w-[160px]" />
                        <col className="hidden md:table-column w-[180px]" />
                        <col className="hidden md:table-column w-[180px]" />
                      </colgroup>
                      <tbody>
                        {group.quotes.map((quote) => {
                          const expired = isExpired(quote);
                          return (
                            <tr
                              key={quote._id}
                              className="border-t border-foreground/4 first:border-t-0 hover:bg-foreground/[0.015] transition-colors cursor-pointer"
                              onClick={() => router.push(`/quotes/${quote._id}`)}
                            >
                              <td className="px-4 py-2.5 whitespace-nowrap">
                                <p className="text-body-sm text-foreground font-medium">
                                  {(quote.quoteNumber ?? quote.policyNumber)}
                                </p>
                                <p className="text-label-sm text-muted-foreground/60">
                                  {quote.insuredName}
                                </p>
                              </td>
                              <td className="px-4 py-2.5 text-body-sm font-mono font-medium text-foreground text-right whitespace-nowrap">
                                {quote.premium || "—"}
                              </td>
                              <td className="px-4 py-2.5 text-body-sm text-muted-foreground text-right hidden md:table-cell whitespace-nowrap">
                                {quote.proposedEffectiveDate ?? "—"}
                              </td>
                              <td className="px-4 py-2.5 text-right whitespace-nowrap hidden md:table-cell">
                                <span className={`text-body-sm ${expired ? "text-red-500 font-medium" : "text-muted-foreground"}`}>
                                  {quote.quoteExpirationDate ?? "—"}
                                  {expired && " (expired)"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </FadeIn>
        ))}
      </div>
    </FadeIn>
  );
}
