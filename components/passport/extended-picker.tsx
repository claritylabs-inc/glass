"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api as _api } from "@/convex/_generated/api";
import { ArrowRight, Check, Loader2, Shield, Clock, Users, Calendar } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { useState } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = _api as any;

type ExtendedSection = "prior_carrier" | "loss_history" | "additional_interests" | "transaction_info";

const SECTION_META: Record<ExtendedSection, { label: string; description: string; icon: typeof Shield }> = {
  prior_carrier: { label: "Prior carrier info", description: "Previous insurance carriers and policy details.", icon: Shield },
  loss_history: { label: "Loss history", description: "Claims and losses in the past 3–5 years.", icon: Clock },
  additional_interests: { label: "Additional interests", description: "Mortgagees, loss payees, additional insureds.", icon: Users },
  transaction_info: { label: "Coverage profile", description: "Desired effective date, term, and lines of business.", icon: Calendar },
};

export function ExtendedPicker() {
  const router = useRouter();
  const completionStatus = useQuery(api.clientPassport.getCompletionStatus, {});
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const [finishing, setFinishing] = useState(false);

  const required = ((completionStatus?.missingSections ?? []) as ExtendedSection[]);
  const allSections: ExtendedSection[] = ["prior_carrier", "loss_history", "additional_interests", "transaction_info"];
  const isComplete = required.length === 0;

  async function handleFinish() {
    if (!isComplete) return;
    setFinishing(true);
    try {
      router.push("/");
    } finally {
      setFinishing(false);
    }
  }

  if (completionStatus === undefined || viewerOrg === undefined) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }

  const sectionRoute: Record<ExtendedSection, string> = {
    prior_carrier: "/onboarding/passport/prior-carriers",
    loss_history: "/onboarding/passport/loss-history",
    additional_interests: "/onboarding/passport/additional-interests",
    transaction_info: "/onboarding/passport/transaction-info",
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Core information saved. Complete any additional sections your broker requires, or skip for now.
      </p>

      <div className="grid gap-3">
        {allSections.map((section) => {
          const meta = SECTION_META[section];
          const isRequired = required.includes(section);
          const isDone = !required.includes(section) && !completionStatus.missingSections.includes(section);
          const Icon = meta.icon;

          return (
            <button
              key={section}
              type="button"
              onClick={() => router.push(sectionRoute[section])}
              className={`flex items-start gap-4 rounded-xl border px-4 py-3 text-left transition-colors hover:border-foreground/20 ${
                isRequired ? "border-foreground/20 bg-foreground/[0.03]" : "border-foreground/8 bg-popover/60"
              }`}
            >
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground/[0.04]">
                {isDone ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {meta.label}
                  {isRequired && (
                    <span className="ml-2 rounded px-1.5 py-0.5 text-xs bg-foreground/8 text-muted-foreground">
                      Required
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">{meta.description}</p>
              </div>
              <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </div>

      <PillButton
        type="button"
        onClick={handleFinish}
        disabled={!isComplete || finishing}
        className="w-full justify-center text-sm shadow-none sm:w-auto"
      >
        {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Finish setup
        {!finishing ? <ArrowRight className="h-4 w-4" /> : null}
      </PillButton>

      {!isComplete && (
        <p className="text-xs text-muted-foreground text-center">
          Complete required sections above to finish setup.
        </p>
      )}
    </div>
  );
}
