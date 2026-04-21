"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { WizardShell } from "@/components/passport/wizard-shell";
import { SectionGeneralInfo } from "@/components/passport/section-general-info";
import { Loader2 } from "lucide-react";

export default function GeneralInfoPage() {
  const viewer = useQuery(api.users.viewer);

  if (viewer === undefined) {
    return (
      <WizardShell currentStep="general">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </WizardShell>
    );
  }

  return (
    <WizardShell currentStep="general" email={viewer?.email ?? undefined}>
      <SectionGeneralInfo />
    </WizardShell>
  );
}
