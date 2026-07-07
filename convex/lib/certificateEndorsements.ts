import type {
  CertificateCoverageLine,
  CertificateData,
} from "./acordForms/types";
import type {
  CertificateEndorsementKind,
  CertificateGateEvidence,
} from "./certificateRequestGate";

export type EndorsementCitation = {
  kind: CertificateEndorsementKind;
  formNumbers: string[];
  requiresWrittenContract?: boolean;
};

const FORM_NUMBER_RE = /\b(?:CG|CA|CU|CP|BP|WC|IL|EP)\s*\d{2}\s*\d{2}(?:\s*\d{2}\s*\d{2})?\b/gi;
const WRITTEN_CONTRACT_RE = /\b(?:where|as)\s+required\s+by\s+(?:a\s+)?written\s+contract\b/i;

const KIND_LABELS: Partial<Record<CertificateEndorsementKind, string>> = {
  additional_insured: "additional insured",
  waiver_of_subrogation: "waiver of subrogation",
  primary_non_contributory: "primary and non-contributory wording",
  loss_payee: "loss payee",
  mortgagee: "mortgagee",
};

function normalizeFormNumber(value: string) {
  return value.toUpperCase().replace(/\s+/g, " ").trim();
}

function evidenceText(evidence: CertificateGateEvidence) {
  return [evidence.label, evidence.excerpt].filter(Boolean).join("\n");
}

function formNumbersFromEvidence(evidence: CertificateGateEvidence[]) {
  const numbers: string[] = [];
  const seen = new Set<string>();
  for (const item of evidence) {
    for (const match of evidenceText(item).matchAll(FORM_NUMBER_RE)) {
      const normalized = normalizeFormNumber(match[0]);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      numbers.push(normalized);
      if (numbers.length >= 3) return numbers;
    }
  }
  return numbers;
}

export function summarizeEndorsementEvidence(
  kinds: CertificateEndorsementKind[],
  evidence: CertificateGateEvidence[],
): EndorsementCitation[] {
  return kinds
    .filter((kind) => KIND_LABELS[kind])
    .map((kind) => ({
      kind,
      formNumbers: formNumbersFromEvidence(evidence),
      requiresWrittenContract: evidence.some((item) =>
        WRITTEN_CONTRACT_RE.test(evidenceText(item)),
      ),
    }));
}

function endorsementPhrase(citation: EndorsementCitation) {
  const label = KIND_LABELS[citation.kind] ?? citation.kind.replace(/_/g, " ");
  const forms = citation.formNumbers.length
    ? `endorsement ${citation.formNumbers.join(", ")}`
    : "blanket endorsement on the policy";
  return `${label} applies per ${forms}`;
}

export function buildEndorsementDescription(citations: EndorsementCitation[]) {
  if (citations.length === 0) return undefined;
  const requiresWrittenContract = citations.some(
    (citation) => citation.requiresWrittenContract,
  );
  const sentence = `Certificate holder is included as ${citations
    .map(endorsementPhrase)
    .join("; ")}${requiresWrittenContract ? ", where required by written contract" : ""}.`;
  return sentence.replace("as additional insured applies", "as additional insured");
}

function applyCoverageFlags(
  coverage: CertificateCoverageLine,
  citations: EndorsementCitation[],
) {
  const hasAdditionalInsured = citations.some(
    (citation) => citation.kind === "additional_insured",
  );
  const hasWaiver = citations.some(
    (citation) => citation.kind === "waiver_of_subrogation",
  );
  const liabilityLike = /liability|umbrella|excess|auto|workers|garage/i.test(
    coverage.type,
  );
  return {
    ...coverage,
    addlInsr: coverage.addlInsr || (hasAdditionalInsured && liabilityLike),
    subrWvd: coverage.subrWvd || (hasWaiver && liabilityLike),
  };
}

export function applyEndorsementsToCertificateData(
  data: CertificateData,
  args: { endorsements?: EndorsementCitation[] },
): CertificateData {
  const endorsements = args.endorsements ?? [];
  if (endorsements.length === 0) return data;
  const description = buildEndorsementDescription(endorsements);
  return {
    ...data,
    coverages: data.coverages.map((coverage) =>
      applyCoverageFlags(coverage, endorsements),
    ),
    description: [data.description, description].filter(Boolean).join("\n\n"),
  };
}
