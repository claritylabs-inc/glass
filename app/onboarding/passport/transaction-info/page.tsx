"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { WizardShell } from "@/components/passport/wizard-shell";
import { SectionTransactionInfo } from "@/components/passport/section-transaction-info";
import { Loader2 } from "lucide-react";

export default function TransactionInfoPage() {
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
      title="Transaction info"
      subtitle="Tell us what kind of coverage you are shopping for and when."
    >
      <SectionTransactionInfo />
    </WizardShell>
  );
}
