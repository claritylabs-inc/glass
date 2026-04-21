"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { WizardShell } from "@/components/passport/wizard-shell";
import { SectionNatureOfBusiness } from "@/components/passport/section-nature-of-business";
import { Loader2 } from "lucide-react";

export default function NatureOfBusinessPage() {
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const viewer = useQuery(api.users.viewer);

  if (viewerOrg === undefined || viewer === undefined) {
    return (
      <WizardShell currentStep="business">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </WizardShell>
    );
  }

  return (
    <WizardShell currentStep="business" email={viewer?.email ?? undefined}>
      <SectionNatureOfBusiness clientOrgId={viewerOrg?.org._id ?? ""} />
    </WizardShell>
  );
}
