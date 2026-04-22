"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { WizardShell } from "@/components/passport/wizard-shell";
import { SectionDisclosures } from "@/components/passport/section-disclosures";
import { Loader2 } from "lucide-react";

export default function DisclosuresPage() {
  const viewer = useQuery(api.users.viewer);

  if (viewer === undefined) {
    return (
      <WizardShell currentStep="disclosures">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      currentStep="disclosures"
      email={viewer?.email ?? undefined}
      title="Background disclosures"
      subtitle="These questions are commonly required by underwriters."
    >
      <SectionDisclosures />
    </WizardShell>
  );
}
