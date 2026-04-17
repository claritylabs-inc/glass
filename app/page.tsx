"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@/components/ui/fade-in";
import { PillButton } from "@/components/ui/pill-button";
import { ArrowRight, Loader2, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { PrismPromptInput } from "@/components/prism-prompt-input";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { useRouter } from "next/navigation";
import { useAction } from "convex/react";

const AGENT_DOMAIN = process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "prism.claritylabs.inc";

export default function DashboardPage() {
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
        router.push(`/agent/thread/${threadId}`);
        // Send message in background — thread page will display it once received
        sendThreadMessage({ threadId, content }).catch(() => {
          toast.error("Failed to send message");
        });
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
            <h1 className="text-2xl font-medium text-foreground tracking-tight mb-2">
              What can I help with?
            </h1>
            <p className="text-label-sm text-muted-foreground mb-8">
              Ask about your policies, coverage, or applications.
            </p>
            <div className="w-full max-w-2xl">
              <PrismPromptInput
                onSubmit={handleSubmit}
                placeholder="Ask Prism..."
                showAttach={false}
                disabled={submitting}
              />
            </div>
          </div>
        </FadeIn>

        {/* Demo data banner */}
        {hasDemo && !demoBannerDismissed && (
          <FadeIn when={true} staggerIndex={1} duration={0.4}>
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/30">
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
      </div>
    </AppShell>
  );
}
