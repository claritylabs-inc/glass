"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { WizardShell } from "@/components/passport/wizard-shell";
import { ExtendedPicker } from "@/components/passport/extended-picker";
import { Loader2 } from "lucide-react";

export default function ExtendedPage() {
  const viewer = useQuery(api.users.viewer);

  if (viewer === undefined) {
    return (
      <WizardShell currentStep="extended">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </WizardShell>
    );
  }

  return (
    <WizardShell currentStep="extended" email={viewer?.email ?? undefined}>
      <ExtendedPicker />
    </WizardShell>
  );
}
