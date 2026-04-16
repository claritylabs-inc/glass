"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { POLICY_TYPE_LABELS, POLICY_TYPE_COLORS } from "@/convex/lib/policyTypes";
import { FadeIn } from "@/components/ui/fade-in";

interface Policy {
  _id: string;
  carrier: string;
  policyNumber: string;
  policyTypes: string[];
  policyType?: string;
  documentType?: string;
  policyYear: number;
  effectiveDate: string;
  expirationDate: string;
  isRenewal: boolean;
  premium?: string;
  insuredName: string;
  extractionStatus: string;
}

interface GroupedViewProps {
  policies: Policy[] | undefined;
  groupBy: "type" | "year";
}

interface PolicyGroup {
  key: string;
  label: string;
  badgeColor?: string;
  policies: Policy[];
}

export function PolicyGroupedView({ policies, groupBy }: GroupedViewProps) {
  const groups = useMemo<PolicyGroup[]>(() => {
    if (!policies || policies.length === 0) return [];

    const map = new Map<string, Policy[]>();

    if (groupBy === "type") {
      for (const policy of policies) {
        const types = policy.policyTypes ?? [policy.policyType ?? "other"];
        for (const type of types) {
          const existing = map.get(type) ?? [];
          existing.push(policy);
          map.set(type, existing);
        }
      }
    } else {
      for (const policy of policies) {
        const key = String(policy.policyYear);
        const existing = map.get(key) ?? [];
        existing.push(policy);
        map.set(key, existing);
      }
    }

    const result: PolicyGroup[] = [];
    for (const [key, groupPolicies] of map) {
      result.push({
        key,
        label: groupBy === "type" ? (POLICY_TYPE_LABELS[key] || key) : key,
        badgeColor: groupBy === "type" ? (POLICY_TYPE_COLORS[key] || POLICY_TYPE_COLORS.other) : undefined,
        policies: groupPolicies,
      });
    }

    if (groupBy === "year") {
      result.sort((a, b) => Number(b.key) - Number(a.key));
    } else {
      result.sort((a, b) => a.label.localeCompare(b.label));
    }

    return result;
  }, [policies, groupBy]);

  const router = useRouter();
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(groups.map((g) => g.key)));

  // Keep openGroups in sync when groups change
  useMemo(() => {
    setOpenGroups((prev) => {
      const newKeys = new Set(groups.map((g) => g.key));
      // Add any new group keys that aren't tracked yet
      const updated = new Set(prev);
      for (const key of newKeys) {
        if (!prev.has(key) && prev.size > 0) {
          // If we already have some state, add new ones as open
        }
        updated.add(key);
      }
      return updated;
    });
  }, [groups]);

  if (!policies || policies.length === 0) {
    return (
      <FadeIn when={true} duration={0.6}>
        <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] px-6 py-8 text-center">
          <p className="text-body-sm text-muted-foreground/60">No policies found</p>
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
              <col className="hidden md:table-column w-[240px]" />
              <col className="hidden md:table-column w-[80px]" />
            </colgroup>
            <thead>
              <tr>
                <th className="px-4 py-2 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Policy</th>
                <th className="px-4 py-2 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right">Premium</th>
                <th className="px-4 py-2 text-label-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap text-right hidden md:table-cell">Period</th>
                <th className="px-4 py-2 hidden md:table-cell" />
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
                    {group.policies.length} {group.policies.length === 1 ? "policy" : "policies"}
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
                        <col className="hidden md:table-column w-[240px]" />
                        <col className="hidden md:table-column w-[80px]" />
                      </colgroup>
                      <tbody>
                        {group.policies.map((policy) => (
                          <tr
                            key={policy._id}
                            className="border-t border-foreground/4 first:border-t-0 hover:bg-foreground/[0.015] transition-colors cursor-pointer"
                            onClick={() => router.push(`/policies/${policy._id}`)}
                          >
                            <td className="px-4 py-2.5 whitespace-nowrap">
                              <p className="text-body-sm text-foreground font-medium">
                                {policy.policyNumber}
                              </p>
                              <p className="text-label-sm text-muted-foreground/60">
                                {policy.insuredName}
                              </p>
                            </td>
                            <td className="px-4 py-2.5 text-body-sm font-mono font-medium text-foreground text-right whitespace-nowrap">
                              {policy.premium || "—"}
                            </td>
                            <td className="px-4 py-2.5 text-body-sm text-muted-foreground text-right hidden md:table-cell whitespace-nowrap">
                              {policy.effectiveDate} – {policy.expirationDate}
                            </td>
                            <td className="px-4 py-2.5 text-right whitespace-nowrap hidden md:table-cell">
                              <Link
                                href={`/policies/${policy._id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="px-2.5 py-1 rounded-md border border-foreground/12 bg-white/80 dark:bg-white/[0.06] text-label-sm font-medium text-foreground hover:border-foreground/20 hover:bg-foreground/[0.03] transition-colors"
                              >
                                View
                              </Link>
                            </td>
                          </tr>
                        ))}
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
