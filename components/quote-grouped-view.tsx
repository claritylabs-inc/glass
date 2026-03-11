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
  quoteNumber: string;
  policyTypes?: string[];
  quoteYear: number;
  proposedEffectiveDate?: string;
  quoteExpirationDate?: string;
  isRenewal: boolean;
  premium?: string;
  insuredName: string;
  extractionStatus: string;
}

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
        const key = String(quote.quoteYear);
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
        <div className="rounded-lg border border-foreground/6 bg-white/60 px-6 py-8 text-center">
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
            <div className="rounded-lg border border-foreground/6 bg-white/60 overflow-hidden">
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
                                  {quote.quoteNumber}
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
