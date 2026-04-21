"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { WizardShell } from "@/components/passport/wizard-shell";
import { SectionLocations } from "@/components/passport/section-locations";
import { Loader2 } from "lucide-react";

export default function LocationsPage() {
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const viewer = useQuery(api.users.viewer);

  if (viewerOrg === undefined || viewer === undefined) {
    return (
      <WizardShell currentStep="locations">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </WizardShell>
    );
  }

  return (
    <WizardShell currentStep="locations" email={viewer?.email ?? undefined}>
      <SectionLocations clientOrgId={viewerOrg?.org._id ?? ""} />
    </WizardShell>
  );
}
