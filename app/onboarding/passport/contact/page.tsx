"use client";

import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { WizardShell } from "@/components/passport/wizard-shell";
import { SectionPrimaryContact } from "@/components/passport/section-primary-contact";

export default function PrimaryContactPage() {
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const viewer = useQuery(api.users.viewer);

  if (viewerOrg === undefined || viewer === undefined) {
    return (
      <WizardShell currentStep="contact">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      currentStep="contact"
      email={viewer?.email ?? undefined}
      title="Primary contact"
      subtitle="Who should your broker reach out to first."
    >
      <SectionPrimaryContact clientOrgId={viewerOrg?.org._id ?? ""} />
    </WizardShell>
  );
}
