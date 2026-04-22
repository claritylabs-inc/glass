"use client";

import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { WizardShell } from "@/components/passport/wizard-shell";
import { SectionDocuments } from "@/components/passport/section-documents";

export default function DocumentsPage() {
  const viewer = useQuery(api.users.viewer);

  if (viewer === undefined) {
    return (
      <WizardShell currentStep="documents">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      currentStep="documents"
      email={viewer?.email ?? undefined}
      title="Company documents"
      subtitle="Upload financial statements, loss runs, or anything that describes your business. We will use them to fill in details."
    >
      <SectionDocuments />
    </WizardShell>
  );
}
