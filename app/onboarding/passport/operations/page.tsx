"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { WizardShell } from "@/components/passport/wizard-shell";
import { SectionOperations } from "@/components/passport/section-operations";
import { Loader2 } from "lucide-react";

export default function OperationsPage() {
  const viewerOrg = useQuery(api.orgs.viewerOrg, {});
  const viewer = useQuery(api.users.viewer);

  if (viewerOrg === undefined || viewer === undefined) {
    return (
      <WizardShell currentStep="operations">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      currentStep="operations"
      email={viewer?.email ?? undefined}
      title="Operations notes"
      subtitle="Any additional context that helps explain your operations."
    >
      <SectionOperations clientOrgId={viewerOrg?.org._id ?? ""} />
    </WizardShell>
  );
}
