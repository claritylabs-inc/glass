"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Nav } from "@/components/nav";
import { StatsCards } from "@/components/stats-cards";
import { PolicyTable } from "@/components/policy-table";
import { PolicyGroupedView } from "@/components/policy-grouped-view";
import { PolicyFilters } from "@/components/policy-filters";
import { FadeIn } from "@/components/ui/fade-in";
import { PillButton } from "@/components/ui/pill-button";
import { ArrowRight } from "lucide-react";
import { FixedMobileFooter } from "@/components/ui/fixed-mobile-footer";

export default function DashboardPage() {
  const stats = useQuery(api.policies.stats);
  const policies = useQuery(api.policies.list, {});
  const seedData = useMutation(api.seed.seed);

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
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="!mb-1">Policy Dashboard</h1>
                <p className="text-body-sm text-muted-foreground">
                  Extracted insurance policies from connected email inboxes
                </p>
              </div>
              {policies && policies.length === 0 && (
                <div className="hidden md:block">
                  <PillButton onClick={() => seedData({})}>Seed Demo Data <ArrowRight className="w-3 h-3" /></PillButton>
                </div>
              )}
            </div>
          </FadeIn>

          <StatsCards stats={stats} />

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

          {activeTab === "all" ? (
            <PolicyTable policies={filteredPolicies as any} />
          ) : (
            <PolicyGroupedView
              policies={policies as any}
              groupBy={activeTab as "type" | "year"}
            />
          )}
        </div>
      </main>

      {policies && policies.length === 0 && (
        <FixedMobileFooter>
          <PillButton onClick={() => seedData({})}>Seed Demo Data <ArrowRight className="w-3 h-3" /></PillButton>
        </FixedMobileFooter>
      )}
    </div>
  );
}
