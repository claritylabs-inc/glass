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
import { ArrowRight, Asterisk, Copy, Check } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { FixedMobileFooter } from "@/components/ui/fixed-mobile-footer";
import { Skeleton } from "@/components/ui/skeleton";

const AGENT_DOMAIN = process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "agent.claritylabs.inc";

export default function DashboardPage() {
  const stats = useQuery(api.policies.stats);
  const policies = useQuery(api.policies.list, {});
  const viewer = useQuery(api.users.viewer);
  const agentStats = useQuery(api.agentConversations.stats);
  const seedData = useMutation(api.seed.seed);
  const [emailCopied, setEmailCopied] = useState(false);

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

          {/* Agent card */}
          {viewer && (
            <FadeIn when={true} staggerIndex={1} duration={0.6}>
              <div className="rounded-lg border border-foreground/6 bg-white/60 p-4 mb-6">
                {viewer.agentHandle ? (
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-foreground/5 flex items-center justify-center">
                        <Asterisk className="w-4 h-4 text-[#A0D2FA]" />
                      </div>
                      <div>
                        <p className="text-label-sm text-muted-foreground">Clarity Agent</p>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(`${viewer.agentHandle}@${AGENT_DOMAIN}`);
                            setEmailCopied(true);
                            setTimeout(() => setEmailCopied(false), 2000);
                            toast.success("Copied to clipboard");
                          }}
                          className="inline-flex items-center gap-1.5 text-body-sm font-mono font-medium text-foreground hover:text-foreground/70 transition-colors cursor-pointer"
                        >
                          {viewer.agentHandle}@{AGENT_DOMAIN}
                          {emailCopied ? (
                            <Check className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <Copy className="w-3 h-3 text-muted-foreground/30" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {agentStats && (
                        <span className="text-label-sm text-muted-foreground/50">
                          {agentStats.total} conversation{agentStats.total !== 1 ? "s" : ""}
                        </span>
                      )}
                      <Link
                        href="/agent"
                        className="text-label-sm font-medium text-foreground hover:text-foreground/70 transition-colors flex items-center gap-1"
                      >
                        View All <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                ) : (
                  <Link
                    href="/agent"
                    className="flex items-center gap-3 group"
                  >
                    <div className="w-9 h-9 rounded-full bg-foreground/5 flex items-center justify-center">
                      <Asterisk className="w-4 h-4 text-[#A0D2FA]" />
                    </div>
                    <div className="flex-1">
                      <p className="text-body-sm font-medium text-foreground group-hover:text-foreground/70 transition-colors">
                        Set Up Clarity Agent
                      </p>
                      <p className="text-label-sm text-muted-foreground/40">
                        Get a dedicated email for policy questions
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                  </Link>
                )}
              </div>
            </FadeIn>
          )}

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
