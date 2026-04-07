"use client";

import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@/components/ui/fade-in";
import { Skeleton } from "@/components/ui/skeleton";
import { QuoteFilters } from "@/components/quote-filters";
import { QuoteTable } from "@/components/quote-table";
import { QuoteGroupedView } from "@/components/quote-grouped-view";

export default function QuotesPage() {
  const quotes = useQuery(api.policies.listQuotes, {});

  const [activeTab, setActiveTab] = useState("all");
  const [selectedType, setSelectedType] = useState("");
  const [selectedCarrier, setSelectedCarrier] = useState("");
  const [selectedYear, setSelectedYear] = useState("");

  const carriers = useMemo(() => {
    if (!quotes) return [];
    return [...new Set(quotes.map((q) => q.carrier))].sort();
  }, [quotes]);

  const years = useMemo(() => {
    if (!quotes) return [];
    return [...new Set(quotes.map((q) => q.policyYear))].sort((a, b) => b - a);
  }, [quotes]);

  const filteredQuotes = useMemo(() => {
    if (!quotes) return undefined;
    let result = quotes;
    if (selectedType) {
      result = result.filter((q) => {
        const types = q.policyTypes ?? ["other"];
        return types.includes(selectedType);
      });
    }
    if (selectedCarrier) {
      result = result.filter((q) => q.carrier === selectedCarrier);
    }
    if (selectedYear) {
      result = result.filter((q) => q.policyYear === Number(selectedYear));
    }
    return result;
  }, [quotes, selectedType, selectedCarrier, selectedYear]);

  return (
    <AppShell>
          {quotes === undefined ? (
            <div className="space-y-3 mb-4">
              <div className="flex items-center gap-1 border-b border-foreground/6 pb-2">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-16" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-8 w-24 rounded-md" />
                <Skeleton className="h-8 w-24 rounded-md" />
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            </div>
          ) : (
            <QuoteFilters
              activeTab={activeTab}
              onTabChange={setActiveTab}
              carriers={carriers}
              years={years}
              selectedType={selectedType}
              onTypeChange={setSelectedType}
              selectedCarrier={selectedCarrier}
              onCarrierChange={setSelectedCarrier}
              selectedYear={selectedYear}
              onYearChange={setSelectedYear}
            />
          )}

          {activeTab === "all" ? (
            <QuoteTable quotes={filteredQuotes as any} />
          ) : (
            <QuoteGroupedView
              quotes={quotes as any}
              groupBy={activeTab as "type" | "year"}
            />
          )}
    </AppShell>
  );
}
