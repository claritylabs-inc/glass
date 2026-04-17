"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@/components/ui/fade-in";
import { PillButton } from "@/components/ui/pill-button";
import { ArrowRight, Loader2, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { StatsCards } from "@/components/stats-cards";
import { POLICY_TYPE_LABELS, POLICY_TYPE_COLORS } from "@/convex/lib/policyTypes";
import { PrismPromptInput } from "@/components/prism-prompt-input";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { useRouter } from "next/navigation";
import { useAction } from "convex/react";
import dayjs from "dayjs";

const AGENT_DOMAIN = process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "prism.claritylabs.inc";

function parseDate(dateStr: string | undefined, format = "MM/DD/YYYY") {
  if (!dateStr || dateStr === "Unknown") return null;
  const d = dayjs(dateStr, format);
  return d.isValid() ? d : null;
}

export default function DashboardPage() {
  const stats = useQuery(api.policies.stats);
  const policies = useQuery(api.policies.list, {});
  const hasDemoDataResult = useQuery(api.seed.hasDemoData);
  const seedData = useAction(api.seed.seed);
  const createThread = useMutation(api.threads.create);
  const sendThreadMessage = useMutation(api.threads.sendMessage);

  const router = useRouter();
  const hasDemo = hasDemoDataResult === true;
  const [demoBannerDismissed, setDemoBannerDismissed] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const today = dayjs();

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
      })
      .slice(0, 5);
  }, [policies, today]);

  const isEmpty = policies && policies.length === 0;

  const seedButton = isEmpty ? (
    <PillButton
      size="compact"
      onClick={async () => {
        setSeeding(true);
        try {
          await seedData({});
        } finally {
          setSeeding(false);
        }
      }}
      disabled={seeding}
    >
      {seeding ? (
        <>
          <Loader2 className="w-3 h-3 animate-spin" /> Generating...
        </>
      ) : (
        <>
          Seed Demo Data <ArrowRight className="w-3 h-3" />
        </>
      )}
    </PillButton>
  ) : undefined;

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const content = message.text.trim();
      if (!content || submitting) return;
      setSubmitting(true);
      try {
        const threadId = await createThread({ agentDomain: AGENT_DOMAIN });
        await sendThreadMessage({ threadId, content });
        router.push(`/agent/thread/${threadId}`);
      } catch {
        toast.error("Failed to start chat");
        setSubmitting(false);
      }
    },
    [createThread, sendThreadMessage, router, submitting],
  );

  return (
    <AppShell actions={seedButton}>
      <div className="flex flex-col min-h-[calc(100vh-8rem)]">

        {/* Hero — conversation-first */}
        <FadeIn when={true} staggerIndex={0} duration={0.5}>
          <div className="flex flex-col items-center justify-center text-center pt-16 pb-10 px-4">
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground tracking-tight mb-3">
              What can I help with?
            </h1>
            <p className="text-body-sm text-muted-foreground/60 max-w-sm mb-8">
              Ask about your policies, coverage, applications, or anything insurance-related.
            </p>
            <div className="w-full max-w-xl">
              <PrismPromptInput
                onSubmit={handleSubmit}
                placeholder="Ask Prism..."
                showAttach={false}
                disabled={submitting}
              />
            </div>
          </div>
        </FadeIn>

        {/* Secondary section */}
        <div className="flex-1 pb-8">

          {/* Demo data banner */}
          {hasDemo && !demoBannerDismissed && (
            <FadeIn when={true} staggerIndex={1} duration={0.4}>
              <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/30 mb-6">
                <p className="text-label-sm text-amber-700 dark:text-amber-400 flex-1">
                  You&apos;re viewing demo data.{" "}
                  <Link href="/profile" className="underline font-medium hover:text-amber-900">
                    Remove demo data
                  </Link>{" "}
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

          {/* Stats */}
          <FadeIn when={true} staggerIndex={2} duration={0.6}>
            <StatsCards stats={stats} />
          </FadeIn>

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
                            <span className="text-body-sm font-medium text-foreground">
                              {p.policyNumber}
                            </span>
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-medium w-fit truncate max-w-full ${
                                POLICY_TYPE_COLORS[firstType] || POLICY_TYPE_COLORS.other
                              }`}
                            >
                              {POLICY_TYPE_LABELS[firstType] || firstType}
                            </span>
                          </div>
                          <p className="text-label-sm text-muted-foreground/60">{p.carrier}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p
                            className={`text-body-sm font-medium ${
                              daysLeft <= 30 ? "text-red-600" : "text-amber-600"
                            }`}
                          >
                            {daysLeft <= 0 ? "Expires today" : `${daysLeft}d left`}
                          </p>
                          <p className="text-label-sm text-muted-foreground/50">
                            {p.expirationDate}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </FadeIn>
          )}
        </div>
      </div>
    </AppShell>
  );
}
