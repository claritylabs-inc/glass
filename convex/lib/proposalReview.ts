import { z } from "zod";

export const proposalReviewConclusionSchema = z.enum([
  "meets_requirements",
  "has_gaps",
  "insufficient_evidence",
]);

const findingConclusionSchema = z.enum([
  "meets",
  "has_gap",
  "insufficient_evidence",
]);

const reviewEvidenceSchema = z.object({
  proposalDocumentId: z.string().min(1),
  sourceNodeIds: z.array(z.string().min(1)).max(20),
  sourceSpanIds: z.array(z.string().min(1)).max(50),
  pageStart: z.number().int().positive().nullable(),
  pageEnd: z.number().int().positive().nullable(),
});

export const proposalReviewSchema = z.object({
  conclusion: proposalReviewConclusionSchema,
  findings: z
    .array(
      z.object({
        targetKind: z.enum(["requirement", "specification"]),
        targetId: z.string().min(1),
        conclusion: findingConclusionSchema,
        summary: z.string().min(1).max(1200),
        evidence: z.array(reviewEvidenceSchema).max(20),
      }),
    )
    .max(200),
});

export type ProposalReviewOutput = z.infer<typeof proposalReviewSchema>;

type AllowedEvidence = {
  proposalDocumentId: string;
  sourceNodeIds?: string[];
  sourceSpanIds?: string[];
  pageStart?: number;
  pageEnd?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function collectProposalEvidence(value: unknown): AllowedEvidence[] {
  const found: AllowedEvidence[] = [];
  const visit = (item: unknown) => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (!isRecord(item)) return;
    if (typeof item.proposalDocumentId === "string") {
      found.push({
        proposalDocumentId: item.proposalDocumentId,
        sourceNodeIds: Array.isArray(item.sourceNodeIds)
          ? item.sourceNodeIds.filter(
              (id): id is string => typeof id === "string",
            )
          : [],
        sourceSpanIds: Array.isArray(item.sourceSpanIds)
          ? item.sourceSpanIds.filter(
              (id): id is string => typeof id === "string",
            )
          : [],
        pageStart:
          typeof item.pageStart === "number" ? item.pageStart : undefined,
        pageEnd: typeof item.pageEnd === "number" ? item.pageEnd : undefined,
      });
    }
    for (const child of Object.values(item)) visit(child);
  };
  visit(value);
  return found;
}

function evidenceKey(value: AllowedEvidence) {
  return [
    value.proposalDocumentId,
    [...new Set(value.sourceNodeIds ?? [])].sort().join(","),
    [...new Set(value.sourceSpanIds ?? [])].sort().join(","),
    value.pageStart ?? "",
    value.pageEnd ?? value.pageStart ?? "",
  ].join("|");
}

export function normalizeProposalReview(
  output: ProposalReviewOutput,
  input: {
    requirementIds: string[];
    specificationIds: string[];
    extractedOffer: unknown;
  },
): ProposalReviewOutput {
  const targetSets = {
    requirement: new Set(input.requirementIds),
    specification: new Set(input.specificationIds),
  };
  const allowedEvidence = new Map(
    collectProposalEvidence(input.extractedOffer).map((evidence) => [
      evidenceKey(evidence),
      evidence,
    ]),
  );
  const byTarget = new Map<string, ProposalReviewOutput["findings"][number]>();
  for (const finding of output.findings) {
    if (!targetSets[finding.targetKind].has(finding.targetId)) continue;
    const evidence = finding.evidence.flatMap((candidate) => {
      const allowed = allowedEvidence.get(
        evidenceKey({
          proposalDocumentId: candidate.proposalDocumentId,
          sourceNodeIds: candidate.sourceNodeIds,
          sourceSpanIds: candidate.sourceSpanIds,
          pageStart: candidate.pageStart ?? undefined,
          pageEnd: candidate.pageEnd ?? candidate.pageStart ?? undefined,
        }),
      );
      return allowed
        ? [
            {
              proposalDocumentId: allowed.proposalDocumentId,
              sourceNodeIds: allowed.sourceNodeIds ?? [],
              sourceSpanIds: allowed.sourceSpanIds ?? [],
              pageStart: allowed.pageStart ?? null,
              pageEnd: allowed.pageEnd ?? allowed.pageStart ?? null,
            },
          ]
        : [];
    });
    const hasRequiredEvidence =
      evidence.length > 0 || finding.conclusion === "insufficient_evidence";
    byTarget.set(`${finding.targetKind}:${finding.targetId}`, {
      ...finding,
      conclusion: hasRequiredEvidence
        ? finding.conclusion
        : "insufficient_evidence",
      summary: hasRequiredEvidence
        ? finding.summary.trim()
        : "The generated finding did not cite accepted proposal evidence.",
      evidence,
    });
  }
  for (const targetKind of ["requirement", "specification"] as const) {
    for (const targetId of targetSets[targetKind]) {
      const key = `${targetKind}:${targetId}`;
      if (!byTarget.has(key)) {
        byTarget.set(key, {
          targetKind,
          targetId,
          conclusion: "insufficient_evidence",
          summary:
            "The review did not return source-backed evidence for this item.",
          evidence: [],
        });
      }
    }
  }
  const findings = [...byTarget.values()];
  const conclusion = findings.some(
    (finding) => finding.conclusion === "has_gap",
  )
    ? "has_gaps"
    : findings.some((finding) => finding.conclusion === "insufficient_evidence")
      ? "insufficient_evidence"
      : "meets_requirements";
  return { conclusion, findings };
}
