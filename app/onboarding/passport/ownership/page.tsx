"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { WizardShell } from "@/components/passport/wizard-shell";
import { SectionOwnership } from "@/components/passport/section-ownership";
import { Loader2 } from "lucide-react";

export default function OwnershipPage() {
  const viewer = useQuery(api.users.viewer);

  if (viewer === undefined) {
    return (
      <WizardShell currentStep="ownership">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      currentStep="ownership"
      email={viewer?.email ?? undefined}
      title="Ownership context"
      subtitle="Share parent/subsidiary or ownership structure notes, if any."
    >
      <SectionOwnership />
    </WizardShell>
  );
}
