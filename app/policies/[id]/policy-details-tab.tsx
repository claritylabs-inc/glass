"use client";

import { FadeIn } from "@/components/ui/fade-in";
import {
  OperationalPanel,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { Badge } from "@/components/ui/badge";
import { buildCoverageBreakdown } from "@/convex/lib/coverageBreakdown";
import { policyLobCodes } from "@/convex/lib/linesOfBusiness";
import type { Id } from "@/convex/_generated/dataModel";

import { CoverageBreakdownCards } from "./policy-coverage-breakdown";
import { PolicySummary } from "./policy-summary";

export function PolicyDetailsTab({
  policy,
  fileUrl,
}: {
  policy: Record<string, unknown> & {
    _id: Id<"policies">;
    policyNumber?: string;
    carrier?: string;
    insuredName?: string;
    effectiveDate?: string;
    expirationDate?: string;
    premium?: string;
    summary?: string;
    isRenewal?: boolean;
  };
  fileUrl?: string | null;
  }) {
  const linesOfBusiness = policyLobCodes(policy as { linesOfBusiness?: string[] });
  const coverageBreakdown = buildCoverageBreakdown(policy);
  const isProvisional =
    policy.extractionDataStage === "preview" &&
    policy.pipelineStatus !== "complete";

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
        administrator={policy.mga as string | undefined}
        carrier={
          (policy.carrierLegalName as string | undefined) ||
          (policy.security as string | undefined) ||
          policy.carrier
        }
        broker={policy.broker as string | undefined}
        insuredName={policy.insuredName}
        effectiveDate={policy.effectiveDate}
        expirationDate={policy.expirationDate}
        premium={policy.premium}
        linesOfBusiness={linesOfBusiness}
        policyTermType={policy.policyTermType as string | undefined}
        isRenewal={policy.isRenewal}
        pdfUrl={fileUrl ?? undefined}
      />
      <CoverageBreakdownCards breakdown={coverageBreakdown} />
    </FadeIn>
  );
}
