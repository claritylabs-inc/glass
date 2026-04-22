"use client";

import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { WizardShell } from "@/components/passport/wizard-shell";
import { SectionWelcome } from "@/components/passport/section-welcome";

export default function WelcomePage() {
  const viewer = useQuery(api.users.viewer);
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});

  if (viewer === undefined || viewerOrg === undefined) {
    return (
      <WizardShell currentStep="welcome">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </WizardShell>
    );
  }

  const title = viewerOrg?.org?.name ? `Welcome, ${viewerOrg.org.name}` : "Welcome";

  return (
    <WizardShell
      currentStep="welcome"
      email={viewer?.email ?? undefined}
      title={title}
      subtitle="This is your company profile. Once it is filled in, your broker can prepare insurance submissions without asking you the same questions over and over."
    >
      <SectionWelcome />
    </WizardShell>
  );
}
