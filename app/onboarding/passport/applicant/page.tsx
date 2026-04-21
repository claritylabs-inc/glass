"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { WizardShell } from "@/components/passport/wizard-shell";
import { SectionApplicantInfo } from "@/components/passport/section-applicant-info";
import { Loader2 } from "lucide-react";

export default function ApplicantInfoPage() {
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const viewer = useQuery(api.users.viewer);

  if (viewerOrg === undefined || viewer === undefined) {
    return (
      <WizardShell currentStep="applicant">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </WizardShell>
    );
  }

  return (
    <WizardShell currentStep="applicant" email={viewer?.email ?? undefined}>
      <SectionApplicantInfo clientOrgId={viewerOrg?.org._id ?? ""} />
    </WizardShell>
  );
}
