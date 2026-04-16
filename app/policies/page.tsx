"use client";

import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { useSearchParams, useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { PolicyTable } from "@/components/policy-table";
import { PolicyGroupedView } from "@/components/policy-grouped-view";
import { PolicyFilters } from "@/components/policy-filters";
import { Skeleton } from "@/components/ui/skeleton";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

function parseDate(dateStr: string | undefined) {
  if (!dateStr || dateStr === "Unknown") return null;
  const d = dayjs(dateStr, "MM/DD/YYYY");
  return d.isValid() ? d : null;
}

type DocumentView = "active" | "expired";

export default function PoliciesPage() {
  const policies = useQuery(api.policies.list, {});
  const searchParams = useSearchParams();
  const router = useRouter();

  const documentView: DocumentView = (searchParams.get("view") as DocumentView) || "active";
  const [activeTab, setActiveTab] = useState("all");

  function handleViewChange(view: DocumentView) {
    setSelectedType("");
    setSelectedCarrier("");
    setSelectedYear("");
    setActiveTab("all");
    const url = view === "active" ? "/policies" : `/policies?view=${view}`;
    router.replace(url, { scroll: false });
  }
  const [selectedType, setSelectedType] = useState("");
  const [selectedCarrier, setSelectedCarrier] = useState("");
  const [selectedYear, setSelectedYear] = useState("");

  const today = dayjs();

  // Split policies into active vs expired
  const viewFilteredDocs = useMemo(() => {
    if (!policies) return undefined;
    return policies.filter((p) => {
      // Exclude quotes from the policies views
      if (p.documentType === "quote") return false;
      const exp = parseDate(p.expirationDate);
      if (documentView === "active") {
        // Active: no expiration date or expiration is in the future
        if (!exp) return true;
        return !exp.isBefore(today, "day");
      }
      // Expired: has expiration date in the past
      if (!exp) return false;
      return exp.isBefore(today, "day");
    });
  }, [policies, documentView, today]);

  const carriers = useMemo(() => {
    if (!viewFilteredDocs) return [];
    return [...new Set(viewFilteredDocs.map((p) => p.carrier))].sort();
  }, [viewFilteredDocs]);

  const years = useMemo(() => {
    if (!viewFilteredDocs) return [];
    return [...new Set(viewFilteredDocs.map((p) => p.policyYear))].sort(
      (a, b) => b - a
    );
  }, [viewFilteredDocs]);

  const filteredPolicies = useMemo(() => {
    if (!viewFilteredDocs) return undefined;
    let result = viewFilteredDocs;
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
  }, [viewFilteredDocs, selectedType, selectedCarrier, selectedYear]);


  const isLoading = policies === undefined;

  const viewToggle = (
    <div className="inline-flex items-center rounded-lg border border-foreground/8 bg-foreground/[0.02] p-0.5">
      {(["active", "expired"] as const).map((view) => (
        <button
          key={view}
          type="button"
          onClick={() => handleViewChange(view)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
            documentView === view
              ? "text-foreground bg-white dark:bg-white/10 shadow-sm"
              : "text-muted-foreground/60 hover:text-muted-foreground"
          }`}
        >
          {view === "active" ? "Active" : "Expired"}
        </button>
      ))}
    </div>
  );

  return (
    <AppShell actions={viewToggle}>
          {isLoading ? (
            <div className="space-y-3 mb-4">
              <div className="flex items-center gap-1 border-b border-foreground/6 pb-2">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-5 w-28" />
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
              policies={viewFilteredDocs as any}
              groupBy={activeTab as "type" | "year"}
            />
          )}
    </AppShell>
  );
}
