"use client";

import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { WizardShell } from "@/components/passport/wizard-shell";
import { SectionCompanyDetails } from "@/components/passport/section-company-details";

export default function CompanyDetailsPage() {
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const viewer = useQuery(api.users.viewer);

  if (viewerOrg === undefined || viewer === undefined) {
    return (
      <WizardShell currentStep="company">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      currentStep="company"
      email={viewer?.email ?? undefined}
      title="Company details"
      subtitle="Basic legal and business information for the applicant."
    >
      <SectionCompanyDetails clientOrgId={viewerOrg?.org._id ?? ""} />
    </WizardShell>
  );
}
