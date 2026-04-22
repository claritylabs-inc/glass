"use client";

import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { WizardShell } from "@/components/passport/wizard-shell";
import { SectionWebsite } from "@/components/passport/section-website";

export default function WebsitePage() {
  const viewer = useQuery(api.users.viewer);

  if (viewer === undefined) {
    return (
      <WizardShell currentStep="website">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      currentStep="website"
      email={viewer?.email ?? undefined}
      title="Company website"
      subtitle="Share your website so we can learn about your company and fill in details automatically."
    >
      <SectionWebsite />
    </WizardShell>
  );
}
