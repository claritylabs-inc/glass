"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { PolicyTable } from "@/components/policy-table";
import { PolicyGroupedView } from "@/components/policy-grouped-view";
import { PolicyFilters } from "@/components/policy-filters";
import { Skeleton } from "@/components/ui/skeleton";

export default function PoliciesPage() {
  const policies = useQuery(api.policies.list, {});
  const [activeTab, setActiveTab] = useState("all");

  // Exclude quotes from the policies view
  const allPolicies = policies?.filter((p) => p.documentType !== "quote");

  const isLoading = policies === undefined;

  return (
    <AppShell>
          {isLoading ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <Skeleton className="h-8 w-48 rounded-md" />
              </div>
              <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-foreground/[0.015]">
                      <th className="px-4 py-2.5"><Skeleton className="h-3 w-20" /></th>
                      <th className="px-4 py-2.5 hidden sm:table-cell"><Skeleton className="h-3 w-16" /></th>
                      <th className="px-4 py-2.5 hidden md:table-cell"><Skeleton className="h-3 w-20" /></th>
                      <th className="px-4 py-2.5"><Skeleton className="h-3 w-14" /></th>
                      <th className="px-4 py-2.5 hidden md:table-cell"><Skeleton className="h-3 w-24" /></th>
                    </tr>
                  </thead>
                </table>
              </div>
            </div>
          ) : (
            <PolicyFilters
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />
          )}

          {activeTab === "all" ? (
            <PolicyTable policies={allPolicies as any} />
          ) : (
            <PolicyGroupedView
              policies={allPolicies as any}
              groupBy={activeTab as "type" | "year"}
            />
          )}
    </AppShell>
  );
}
