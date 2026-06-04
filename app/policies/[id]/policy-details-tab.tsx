"use client";

import type { LogEntry, PipelineStatus } from "@claritylabs/cl-pipelines";

import { FadeIn } from "@/components/ui/fade-in";
import { PolicyExtractionBanner } from "@/components/shared/extraction-banner";
import { buildCoverageBreakdown } from "@/convex/lib/coverageBreakdown";
import type { Id } from "@/convex/_generated/dataModel";

import { CoverageBreakdownCards } from "./policy-coverage-breakdown";
import { PolicySummary } from "./policy-summary";

type PolicyPipelineLogEntry = LogEntry & {
  timestamp: number;
  message: string;
  phase?: string;
  level?: string;
};

export function PolicyDetailsTab({
  policy,
  fileUrl,
  pipelineLog,
  canCancelExtraction,
  cancelingExtraction,
  onCancelExtraction,
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
  pipelineLog: PolicyPipelineLogEntry[];
  canCancelExtraction: boolean;
  cancelingExtraction: boolean;
  onCancelExtraction: () => void;
}) {
  const policyTypes = (policy.policyTypes as string[] | undefined) ?? ["other"];
  const documentType = (policy.documentType as string | undefined) ?? "policy";
  const coverageBreakdown = buildCoverageBreakdown(policy);

  return (
    <FadeIn when={true} staggerIndex={1} duration={0.5}>
      <PolicyExtractionBanner
        policyId={policy._id}
        status={policy.pipelineStatus as PipelineStatus | undefined}
        error={policy.pipelineError as string | undefined}
        log={pipelineLog}
        onCancel={canCancelExtraction ? onCancelExtraction : undefined}
        cancelling={cancelingExtraction}
      />
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
        policyTypes={policyTypes}
        policyTermType={policy.policyTermType as string | undefined}
        limits={policy.limits as Record<string, unknown> | undefined}
        isRenewal={policy.isRenewal}
        documentType={documentType}
        pdfUrl={fileUrl ?? undefined}
      />
      <CoverageBreakdownCards breakdown={coverageBreakdown} />
    </FadeIn>
  );
}
