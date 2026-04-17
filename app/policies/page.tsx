"use client";

import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { PolicyTable } from "@/components/policy-table";
import { Skeleton } from "@/components/ui/skeleton";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

function parseDate(dateStr: string | undefined) {
  if (!dateStr || dateStr === "Unknown") return null;
  const d = dayjs(dateStr, "MM/DD/YYYY");
  return d.isValid() ? d : null;
}

const TABS = [
  { id: "active", label: "Active" },
  { id: "expired", label: "Expired" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function PoliciesPage() {
  const policies = useQuery(api.policies.list, {});
  const [activeTab, setActiveTab] = useState<TabId>("active");

  const today = dayjs();

  const { activePolicies, expiredPolicies } = useMemo(() => {
    if (!policies) return { activePolicies: undefined, expiredPolicies: undefined };
    const nonQuotes = policies.filter((p) => p.documentType !== "quote");
    const active = nonQuotes.filter((p) => {
      const exp = parseDate(p.expirationDate);
      if (!exp) return true;
      return !exp.isBefore(today, "day");
    });
    const expired = nonQuotes.filter((p) => {
      const exp = parseDate(p.expirationDate);
      if (!exp) return false;
      return exp.isBefore(today, "day");
    });
    return { activePolicies: active, expiredPolicies: expired };
  }, [policies, today]);

  const isLoading = policies === undefined;
  const displayPolicies = activeTab === "active" ? activePolicies : expiredPolicies;

  return (
    <AppShell>
      {isLoading ? (
        <div>
          <div className="flex items-center gap-1 mb-4">
            <Skeleton className="h-7 w-16 rounded-full" />
            <Skeleton className="h-7 w-16 rounded-full" />
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
        <div className="flex items-center gap-1 mb-4">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1 text-label-sm rounded-full whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? "bg-foreground/8 text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <PolicyTable policies={displayPolicies as any} />
    </AppShell>
  );
}
