"use client";

import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Nav } from "@/components/nav";
import { PolicyTable } from "@/components/policy-table";
import { PolicyFilters } from "@/components/policy-filters";
import { FadeIn } from "@/components/ui/fade-in";

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
      result = result.filter((p) => p.policyType === selectedType);
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
            <div className="mb-6">
              <h1 className="!mb-1">All Policies</h1>
              <p className="text-body-sm text-muted-foreground">
                Browse and filter all extracted insurance policies
              </p>
            </div>
          </FadeIn>

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

          <PolicyTable policies={filteredPolicies as any} />
        </div>
      </main>
    </div>
  );
}
