"use client";

import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { WizardShell } from "@/components/passport/wizard-shell";
import { SectionContextIntegrations } from "@/components/passport/section-context-integrations";

export default function ContextIntegrationsPage() {
  const viewer = useQuery(api.users.viewer);

  if (viewer === undefined) {
    return (
      <WizardShell currentStep="integrations">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      currentStep="integrations"
      email={viewer?.email ?? undefined}
      title="Connect business tools"
      subtitle="Link payroll, accounting, or HR tools to pull in accurate numbers like revenue and headcount automatically."
    >
      <SectionContextIntegrations />
    </WizardShell>
  );
}
