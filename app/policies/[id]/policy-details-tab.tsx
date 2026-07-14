"use client";

import { FadeIn } from "@/components/ui/fade-in";
import {
  OperationalPanel,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { Badge } from "@/components/ui/badge";
import { policyLobCodes } from "@/convex/lib/linesOfBusiness";
import type { Id } from "@/convex/_generated/dataModel";
import { resolvePolicyPartyContext } from "@/convex/lib/policyPartyContext";

import { PolicySummary } from "./policy-summary";
import { PolicyPartiesPanel } from "./policy-parties-panel";
import type { PolicyDetailsEditSection } from "./policy-details-editor";

export function PolicyDetailsTab({
  policy,
  fileUrl,
  canEdit = false,
  onEdit,
}: {
  policy: Record<string, unknown> & {
    _id: Id<"policies">;
    policyNumber?: string;
    carrier?: string;
    insuredName?: string;
    effectiveDate?: string;
    expirationDate?: string;
    premium?: string;
    totalCost?: string;
    taxesAndFees?: Array<{ amount?: string; amountValue?: number }>;
    summary?: string;
    isRenewal?: boolean;
  };
  fileUrl?: string | null;
  canEdit?: boolean;
  onEdit?: (section: PolicyDetailsEditSection) => void;
  }) {
  const linesOfBusiness = policyLobCodes(policy as { linesOfBusiness?: string[] });
  const isProvisional =
    policy.extractionDataStage === "preview" &&
    policy.pipelineStatus !== "complete";
  const partyContext = resolvePolicyPartyContext(policy);

  return (
    <FadeIn when={true} staggerIndex={1} duration={0.5}>
      {isProvisional ? (
        <OperationalPanel as="div" className="mb-4">
          <OperationalPanelHeader
            title="Extraction complete"
            description="Enrichment is running. Certificates, policy changes, and source-backed edits unlock when it finishes."
            action={
              <Badge
                variant="outline"
                className="text-label text-muted-foreground"
              >
                Enriching
              </Badge>
            }
            className="border-b-0"
          />
        </OperationalPanel>
      ) : null}
      <PolicySummary
        policyNumber={policy.policyNumber}
        effectiveDate={policy.effectiveDate}
        expirationDate={policy.expirationDate}
        premium={policy.premium}
        totalCost={policy.totalCost}
        taxesAndFees={policy.taxesAndFees}
        linesOfBusiness={linesOfBusiness}
        policyTermType={policy.policyTermType as string | undefined}
        operationsDescription={partyContext.operationsDescription}
        isRenewal={policy.isRenewal}
        pdfUrl={fileUrl ?? undefined}
        onEdit={canEdit && onEdit ? () => onEdit("overview") : undefined}
      />
      <PolicyPartiesPanel
        key={policy._id}
        policy={policy}
        canEdit={canEdit}
        onEdit={onEdit}
      />
    </FadeIn>
  );
}
