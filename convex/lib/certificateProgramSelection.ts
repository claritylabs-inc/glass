import type { Id } from "../_generated/dataModel";

export type CertificateProgramCandidate = {
  programId: string;
  programName: string;
  categoryLabel?: string;
  categoryLabels?: string[];
  aliases?: string[];
  score?: number;
};

export type CertificateProgramSelection = {
  policyId: string;
  holderName: string;
  certificateHolder?: string;
  candidates: CertificateProgramCandidate[];
  source: "chat" | "email" | "imessage" | "sms" | "agent";
};

export function normalizeSelectedPartnerProgramId(
  value?: string | null,
): Id<"partnerPrograms"> | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? (trimmed as Id<"partnerPrograms">) : undefined;
}

type RawCandidate = Record<string, unknown>;

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function normalizeCertificateProgramCandidates(
  candidates: unknown,
): CertificateProgramCandidate[] {
  if (!Array.isArray(candidates)) return [];
  return candidates
    .map((candidate): CertificateProgramCandidate | null => {
      if (!candidate || typeof candidate !== "object") return null;
      const record = candidate as RawCandidate;
      const programId = firstString(record.programId, record._id, record.id);
      const programName = firstString(
        record.programName,
        record.name,
        record.label,
      );
      if (!programId || !programName) return null;
      const categoryLabels = Array.isArray(record.categoryLabels)
        ? record.categoryLabels.filter(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0,
          )
        : undefined;
      const normalized: CertificateProgramCandidate = {
        programId,
        programName,
      };
      const categoryLabel = firstString(record.categoryLabel);
      if (categoryLabel) normalized.categoryLabel = categoryLabel;
      if (categoryLabels?.length) normalized.categoryLabels = categoryLabels;
      const aliases = Array.isArray(record.aliases)
        ? record.aliases.filter(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0,
          )
        : undefined;
      if (aliases?.length) normalized.aliases = aliases;
      if (typeof record.score === "number") normalized.score = record.score;
      return normalized;
    })
    .filter((candidate): candidate is CertificateProgramCandidate => candidate !== null);
}

export function buildCertificateProgramSelection(params: {
  policyId: string;
  holderName: string;
  certificateHolder?: string;
  candidates: unknown;
  source: CertificateProgramSelection["source"];
}): CertificateProgramSelection | null {
  const candidates = normalizeCertificateProgramCandidates(params.candidates);
  if (candidates.length === 0) return null;
  return {
    policyId: params.policyId,
    holderName: params.holderName,
    certificateHolder: params.certificateHolder,
    candidates,
    source: params.source,
  };
}

function candidateSubtitle(candidate: CertificateProgramCandidate) {
  return (
    candidate.categoryLabels?.join(", ") ||
    candidate.categoryLabel ||
    candidate.aliases?.slice(0, 2).join(", ") ||
    ""
  );
}

export function formatCertificateProgramSelectionForUser(
  selection: CertificateProgramSelection,
) {
  const lines = selection.candidates.map((candidate, index) => {
    const subtitle = candidateSubtitle(candidate);
    return `${index + 1}. ${candidate.programName}${subtitle ? ` — ${subtitle}` : ""}`;
  });
  return [
    "I found multiple possible program administrator programs for this certified COI.",
    "Reply with the option number or program name and I will generate it:",
    ...lines,
  ].join("\n");
}

export function formatCertificateProgramSelectionForModel(
  selection: CertificateProgramSelection,
) {
  const lines = selection.candidates.map((candidate, index) => {
    const subtitle = candidateSubtitle(candidate);
    return `${index + 1}. ${candidate.programName}${subtitle ? ` — ${subtitle}` : ""} (partnerProgramId: ${candidate.programId})`;
  });
  return [
    "PENDING CERTIFIED COI PROGRAM SELECTION:",
    `Policy ID: ${selection.policyId}`,
    `Certificate holder: ${selection.certificateHolder ?? selection.holderName}`,
    "If the user chooses a number or program name, call generate_coi with this policyId, the same certificateHolder, and the matching partnerProgramId.",
    ...lines,
  ].join("\n");
}
