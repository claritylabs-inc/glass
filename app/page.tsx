"use client";

import { useState, useMemo } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@/components/ui/fade-in";
import { PillButton } from "@/components/ui/pill-button";
import { ArrowRight, Asterisk, Copy, Check, X, Loader2, Play, CheckCircle, FileInput } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { StatsCards, StatCard } from "@/components/stats-cards";
import { CoverageByTypeSection, parseDollarAmount } from "@/components/coverage-by-type";
import { POLICY_TYPE_LABELS } from "@/convex/lib/policyTypes";
import dayjs from "dayjs";

const AGENT_DOMAIN = process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "prism.claritylabs.inc";

function parseDate(dateStr: string | undefined, format = "MM/DD/YYYY") {
  if (!dateStr || dateStr === "Unknown") return null;
  const d = dayjs(dateStr, format);
  return d.isValid() ? d : null;
}

const TYPE_COLORS: Record<string, string> = {
  general_liability: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
  commercial_property: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400",
  commercial_auto: "bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400",
  non_owned_auto: "bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400",
  workers_comp: "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400",
  umbrella: "bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400",
  excess_liability: "bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-400",
  professional_liability: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400",
  cyber: "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400",
  epli: "bg-pink-100 dark:bg-pink-950/40 text-pink-700 dark:text-pink-400",
  directors_officers: "bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400",
  fiduciary_liability: "bg-fuchsia-100 dark:bg-fuchsia-950/40 text-fuchsia-700 dark:text-fuchsia-400",
  crime_fidelity: "bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400",
  inland_marine: "bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400",
  builders_risk: "bg-yellow-100 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400",
  environmental: "bg-lime-100 dark:bg-lime-950/40 text-lime-700 dark:text-lime-400",
  ocean_marine: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
  surety: "bg-stone-100 dark:bg-stone-950/40 text-stone-700 dark:text-stone-400",
  product_liability: "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400",
  bop: "bg-slate-100 dark:bg-slate-950/40 text-slate-700 dark:text-slate-400",
  management_liability_package: "bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400",
  property: "bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400",
  other: "bg-gray-100 dark:bg-gray-800/40 text-gray-700 dark:text-gray-400",
};

export default function DashboardPage() {
  const stats = useQuery(api.policies.stats);
  const quoteStats = useQuery(api.quotes.stats);
  const policies = useQuery(api.policies.list, {});
  const quotes = useQuery(api.quotes.list, {});
  const viewer = useQuery(api.users.viewer);
  const agentStats = useQuery(api.agentConversations.stats);
  const appStats = useQuery(api.applicationSessions.stats);
  const seedData = useAction(api.seed.seed);
  const hasDemoDataResult = useQuery(api.seed.hasDemoData);
  const [emailCopied, setEmailCopied] = useState(false);
  const hasDemo = hasDemoDataResult === true;
  const [demoBannerDismissed, setDemoBannerDismissed] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const today = dayjs();

  const activePolicies = useMemo(() => {
    if (!policies) return undefined;
    return policies.filter((p) => {
      const eff = parseDate(p.effectiveDate);
      const exp = parseDate(p.expirationDate);
      // Active if: no dates (unknown) OR current date is within the policy period
      if (!eff && !exp) return true;
      if (eff && exp) return today.isAfter(eff.subtract(1, "day")) && today.isBefore(exp.add(1, "day"));
      if (exp) return today.isBefore(exp.add(1, "day"));
      return true;
    });
  }, [policies, today]);

  const activeQuotes = useMemo(() => {
    if (!quotes) return undefined;
    return quotes.filter((q) => {
      const exp = parseDate(q.quoteExpirationDate);
      // Active if no expiration or not yet expired
      if (!exp) return true;
      return today.isBefore(exp.add(1, "day"));
    });
  }, [quotes, today]);

  const coverageByType = useMemo(() => {
    if (!activePolicies) return undefined;
    const map = new Map<string, { total: number; count: number }>();
    for (const p of activePolicies) {
      if ((p as any).extractionStatus !== "complete") continue;
      const types: string[] = (p as any).policyTypes ?? [(p as any).policyType ?? "other"];
      const coverages: { limit: string }[] = (p as any).coverages ?? [];
      let policyTotal = 0;
      for (const c of coverages) {
        const amt = parseDollarAmount(c.limit);
        if (amt && amt > 0) policyTotal += amt;
      }
      if (policyTotal === 0) continue;
      for (const t of types) {
        const existing = map.get(t) ?? { total: 0, count: 0 };
        existing.total += policyTotal;
        existing.count += 1;
        map.set(t, existing);
      }
    }
    return Array.from(map.entries())
      .map(([typeKey, { total, count }]) => ({
        typeKey,
        label: POLICY_TYPE_LABELS[typeKey] || typeKey,
        totalCoverage: total,
        policyCount: count,
      }))
      .sort((a, b) => b.totalCoverage - a.totalCoverage);
  }, [activePolicies]);

  const expiringPolicies = useMemo(() => {
    if (!policies) return undefined;
    const cutoff = today.add(90, "day");
    return policies
      .filter((p) => {
        const exp = parseDate(p.expirationDate);
        if (!exp) return false;
        return exp.isAfter(today.subtract(1, "day")) && exp.isBefore(cutoff);
      })
      .sort((a, b) => {
        const aExp = parseDate(a.expirationDate)!;
        const bExp = parseDate(b.expirationDate)!;
        return aExp.diff(bExp);
      });
  }, [policies, today]);

  const expiringQuotes = useMemo(() => {
    if (!quotes) return undefined;
    const cutoff = today.add(30, "day");
    return quotes
      .filter((q) => {
        const exp = parseDate(q.quoteExpirationDate);
        if (!exp) return false;
        return exp.isAfter(today.subtract(1, "day")) && exp.isBefore(cutoff);
      })
      .sort((a, b) => {
        const aExp = parseDate(a.quoteExpirationDate)!;
        const bExp = parseDate(b.quoteExpirationDate)!;
        return aExp.diff(bExp);
      });
  }, [quotes, today]);

  const isEmpty = policies && policies.length === 0 && quotes && quotes.length === 0;

  const seedButton = isEmpty ? (
    <PillButton size="compact" onClick={async () => { setSeeding(true); try { await seedData({}); } finally { setSeeding(false); } }} disabled={seeding}>
      {seeding ? <><Loader2 className="w-3 h-3 animate-spin" /> Generating...</> : <>Seed Demo Data <ArrowRight className="w-3 h-3" /></>}
    </PillButton>
  ) : undefined;

  return (
    <AppShell actions={seedButton}>
      <div>

          <StatsCards stats={stats} quoteStats={quoteStats} />

          {/* Application stats */}
          {appStats && appStats.total > 0 && (
            <FadeIn when={true} staggerIndex={1} duration={0.6}>
              <Link href="/applications" className="block">
                <motion.div
                  whileHover={{
                    scale: 1.01,
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -4px rgb(0 0 0 / 0.08)",
                    borderColor: "var(--input)",
                    backgroundColor: "var(--popover)",
                  }}
                  whileTap={{ scale: 0.99 }}
                  transition={{ type: "tween", duration: 0.2, ease: "easeOut" }}
                  className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] mb-6 cursor-pointer overflow-hidden"
                >
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <FileInput className="w-4 h-4 text-muted-foreground/50 shrink-0" />
                      <span className="text-body-sm font-semibold text-foreground">Applications</span>
                    </div>
                    <span className="text-label-sm font-medium text-foreground flex items-center gap-1">
                      View All <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-foreground/6 border-t border-foreground/6">
                    <div className="px-4 py-2.5">
                      <p className="text-[11px] text-muted-foreground/50">Active</p>
                      <p className="text-body-sm font-semibold text-foreground tabular-nums">{appStats.active}</p>
                    </div>
                    <div className="px-4 py-2.5">
                      <p className="text-[11px] text-muted-foreground/50">Completed</p>
                      <p className="text-body-sm font-semibold text-foreground tabular-nums">{appStats.completed}</p>
                    </div>
                    <div className="px-4 py-2.5">
                      <p className="text-[11px] text-muted-foreground/50">Total</p>
                      <p className="text-body-sm font-semibold text-foreground tabular-nums">{appStats.total}</p>
                    </div>
                  </div>
                </motion.div>
              </Link>
            </FadeIn>
          )}

          {/* Agent card */}
          {viewer && (
            <FadeIn when={true} staggerIndex={2} duration={0.6}>
              <Link href="/agent" className="block">
                <motion.div
                  whileHover={{
                    scale: 1.01,
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -4px rgb(0 0 0 / 0.08)",
                    borderColor: "var(--input)",
                    backgroundColor: "var(--popover)",
                  }}
                  whileTap={{ scale: 0.99 }}
                  transition={{ type: "tween", duration: 0.2, ease: "easeOut" }}
                  className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] p-4 mb-6 cursor-pointer"
                >
                  {viewer.agentHandle ? (
                    <div className="space-y-4">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-2 min-w-0">
                        <div className="flex items-center gap-2">
                          <Asterisk className="w-4 h-4 text-[#A0D2FA] shrink-0" />
                          <span className="text-sm font-semibold text-foreground shrink-0">Prism</span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            navigator.clipboard.writeText(`${viewer.agentHandle}@${AGENT_DOMAIN}`);
                            setEmailCopied(true);
                            setTimeout(() => setEmailCopied(false), 2000);
                            toast.success("Copied to clipboard");
                          }}
                          className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground/70 transition-colors cursor-pointer truncate min-w-0"
                        >
                          <span className="truncate">{viewer.agentHandle}@{AGENT_DOMAIN}</span>
                          {emailCopied ? (
                            <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                          ) : (
                            <Copy className="w-3 h-3 text-muted-foreground/30 shrink-0" />
                          )}
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        {agentStats && (
                          <span className="text-label-sm text-muted-foreground/50">
                            {agentStats.total} conversation{agentStats.total !== 1 ? "s" : ""}
                          </span>
                        )}
                        <span className="text-label-sm font-medium text-foreground flex items-center gap-1">
                          View All <ArrowRight className="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Asterisk className="w-4 h-4 text-[#A0D2FA] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-body-sm font-medium text-foreground">
                          Set Up Prism
                        </p>
                        <p className="text-label-sm text-muted-foreground/40">
                          Get a dedicated email for policy questions
                        </p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground/30 shrink-0" />
                    </div>
                  )}
                </motion.div>
              </Link>
            </FadeIn>
          )}

          <CoverageByTypeSection data={coverageByType} />

          {/* Demo data banner */}
          {hasDemo && !demoBannerDismissed && (
            <FadeIn when={true} staggerIndex={0} duration={0.4}>
              <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/30 mb-6">
                <p className="text-label-sm text-amber-700 dark:text-amber-400 flex-1">
                  You&apos;re viewing demo data.{" "}
                  <Link href="/profile" className="underline font-medium hover:text-amber-900">Remove demo data</Link>{" "}
                  from Settings when you&apos;re ready.
                </p>
                <button
                  type="button"
                  onClick={() => setDemoBannerDismissed(true)}
                  className="text-amber-500 hover:text-amber-700 transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </FadeIn>
          )}

          {/* Expiring Policies */}
          {expiringPolicies && expiringPolicies.length > 0 && (
            <FadeIn when={true} staggerIndex={3} duration={0.6}>
              <div className="mb-6">
                <div className="flex flex-col gap-0.5 md:flex-row md:items-center md:justify-between mb-3">
                  <p className="text-body-sm font-semibold text-foreground">Expiring Policies</p>
                  <span className="text-label-sm text-muted-foreground/50">next 90 days</span>
                </div>
                <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
                  {expiringPolicies.map((p, i) => {
                    const exp = parseDate(p.expirationDate)!;
                    const daysLeft = exp.diff(today, "day");
                    const types = (p as any).policyTypes ?? [(p as any).policyType ?? "other"];
                    const firstType = types[0];
                    return (
                      <Link
                        key={p._id}
                        href={`/policies/${p._id}`}
                        className={`flex items-center gap-3 px-4 py-3 hover:bg-foreground/[0.02] transition-colors ${
                          i > 0 ? "border-t border-foreground/4" : ""
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-2 mb-1.5 md:mb-0">
                            <span className="text-body-sm font-medium text-foreground">{p.policyNumber}</span>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium w-fit truncate max-w-full ${TYPE_COLORS[firstType] || TYPE_COLORS.other}`}>
                              {POLICY_TYPE_LABELS[firstType] || firstType}
                            </span>
                          </div>
                          <p className="text-label-sm text-muted-foreground/60">{p.carrier}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-body-sm font-medium ${daysLeft <= 30 ? "text-red-600" : "text-amber-600"}`}>
                            {daysLeft <= 0 ? "Expires today" : `${daysLeft}d left`}
                          </p>
                          <p className="text-label-sm text-muted-foreground/50">{p.expirationDate}</p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </FadeIn>
          )}

          {/* Expiring Quotes */}
          {expiringQuotes && expiringQuotes.length > 0 && (
            <FadeIn when={true} staggerIndex={4} duration={0.6}>
              <div className="mb-6">
                <div className="flex flex-col gap-0.5 md:flex-row md:items-center md:justify-between mb-3">
                  <p className="text-body-sm font-semibold text-foreground">Expiring Quotes</p>
                  <span className="text-label-sm text-muted-foreground/50">next 30 days</span>
                </div>
                <div className="rounded-lg border border-foreground/6 bg-white/60 dark:bg-white/[0.04] overflow-hidden">
                  {expiringQuotes.map((q, i) => {
                    const exp = parseDate(q.quoteExpirationDate)!;
                    const daysLeft = exp.diff(today, "day");
                    const types = q.policyTypes ?? ["other"];
                    const firstType = types[0];
                    return (
                      <Link
                        key={q._id}
                        href={`/quotes/${q._id}`}
                        className={`flex items-center gap-3 px-4 py-3 hover:bg-foreground/[0.02] transition-colors ${
                          i > 0 ? "border-t border-foreground/4" : ""
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-2 mb-1.5 md:mb-0">
                            <span className="text-body-sm font-medium text-foreground">{q.quoteNumber}</span>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium w-fit truncate max-w-full ${TYPE_COLORS[firstType] || TYPE_COLORS.other}`}>
                              {POLICY_TYPE_LABELS[firstType] || firstType}
                            </span>
                          </div>
                          <p className="text-label-sm text-muted-foreground/60">{q.carrier}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-body-sm font-medium ${daysLeft <= 7 ? "text-red-600" : "text-orange-600"}`}>
                            {daysLeft <= 0 ? "Expires today" : `${daysLeft}d left`}
                          </p>
                          <p className="text-label-sm text-muted-foreground/50">{q.quoteExpirationDate}</p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </FadeIn>
          )}
      </div>

    </AppShell>
  );
}
