"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { WizardShell } from "@/components/passport/wizard-shell";
import { SectionLossHistory } from "@/components/passport/section-loss-history";
import { Loader2 } from "lucide-react";

export default function LossHistoryPage() {
  const viewer = useQuery(api.users.viewer);

  if (viewer === undefined) {
    return (
      <WizardShell currentStep="extended">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      currentStep="extended"
      email={viewer?.email ?? undefined}
      title="Loss history"
      subtitle="Log prior claims or incidents so underwriters see the full picture."
    >
      <SectionLossHistory />
    </WizardShell>
  );
}
