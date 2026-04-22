"use client";

import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { WizardShell } from "@/components/passport/wizard-shell";
import { SectionContextEmail } from "@/components/passport/section-context-email";

export default function ContextEmailPage() {
  const viewer = useQuery(api.users.viewer);

  if (viewer === undefined) {
    return (
      <WizardShell currentStep="email">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      currentStep="email"
      email={viewer?.email ?? undefined}
      title="Connect your email"
      subtitle="Linking your inbox helps us find insurance-related emails and understand your coverage history."
    >
      <SectionContextEmail />
    </WizardShell>
  );
}
