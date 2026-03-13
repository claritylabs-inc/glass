"use client";

import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { PolicyTable } from "@/components/policy-table";
import { PolicyGroupedView } from "@/components/policy-grouped-view";
import { PolicyFilters } from "@/components/policy-filters";
import { FadeIn } from "@/components/ui/fade-in";
import { Skeleton } from "@/components/ui/skeleton";

export default function PoliciesPage() {
  const policies = useQuery(api.policies.list, {});

  const [activeTab, setActiveTab] = useState("all");
  const [selectedType, setSelectedType] = useState("");
  const [selectedCarrier, setSelectedCarrier] = useState("");
  const [selectedYear, setSelectedYear] = useState("");

  const carriers = useMemo(() => {
    if (!policies) return [];
    return [...new Set(policies.map((p) => p.carrier))].sort();
  }, [policies]);

  const years = useMemo(() => {
    if (!policies) return [];
    return [...new Set(policies.map((p) => p.policyYear))].sort(
      (a, b) => b - a
    );
  }, [policies]);

  const filteredPolicies = useMemo(() => {
    if (!policies) return undefined;
    let result = policies;
    if (selectedType) {
      result = result.filter((p) => {
        const types = (p as any).policyTypes ?? [(p as any).policyType ?? "other"];
        return types.includes(selectedType);
      });
    }
    if (selectedCarrier) {
      result = result.filter((p) => p.carrier === selectedCarrier);
    }
    if (selectedYear) {
      result = result.filter((p) => p.policyYear === Number(selectedYear));
    }
    return result;
  }, [policies, selectedType, selectedCarrier, selectedYear]);

  return (
    <AppShell>
          {policies === undefined ? (
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
            <PolicyFilters
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
            <PolicyTable policies={filteredPolicies as any} />
          ) : (
            <PolicyGroupedView
              policies={policies as any}
              groupBy={activeTab as "type" | "year"}
            />
          )}
    </AppShell>
  );
}
