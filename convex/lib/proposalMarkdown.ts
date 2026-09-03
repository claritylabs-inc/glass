type EvidenceRef = {
  proposalDocumentId: string;
  sourceNodeIds: string[];
  sourceSpanIds: string[];
  pageStart?: number;
  pageEnd?: number;
};

export type ProposalEvidenceLegend = Record<string, EvidenceRef>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readEvidence(value: unknown): EvidenceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const proposalDocumentId = text(item.proposalDocumentId);
    if (!proposalDocumentId) return [];
    return [
      {
        proposalDocumentId,
        sourceNodeIds: stringList(item.sourceNodeIds),
        sourceSpanIds: stringList(item.sourceSpanIds),
        pageStart:
          typeof item.pageStart === "number" ? item.pageStart : undefined,
        pageEnd: typeof item.pageEnd === "number" ? item.pageEnd : undefined,
      },
    ];
  });
}

function proposalEvidenceKey(value: EvidenceRef) {
  return [
    value.proposalDocumentId,
    [...new Set(value.sourceNodeIds)].sort().join(","),
    [...new Set(value.sourceSpanIds)].sort().join(","),
    value.pageStart ?? "",
    value.pageEnd ?? value.pageStart ?? "",
  ].join("|");
}

class EvidenceTagger {
  private readonly byKey = new Map<string, string>();
  readonly legend: ProposalEvidenceLegend = {};

  tag(value: unknown) {
    const refs = readEvidence(value);
    if (refs.length === 0) return "";
    const tags = refs.map((ref) => {
      const key = proposalEvidenceKey(ref);
      const existing = this.byKey.get(key);
      if (existing) return existing;
      const tag = `E${this.byKey.size + 1}`;
      this.byKey.set(key, tag);
      this.legend[tag] = ref;
      return tag;
    });
    return ` [${[...new Set(tags)].join(" ")}]`;
  }
}

function itemLine(item: Record<string, unknown>, fields: readonly string[]) {
  const parts = fields.flatMap((field) => {
    const value = item[field];
    if (typeof value === "number") return [`${field}: ${value}`];
    const normalized = text(value);
    return normalized ? [`${field}: ${normalized}`] : [];
  });
  if (parts.length) return parts.join(" · ");
  // Preserve scalar fields from extractor versions with a different shape.
  const fallback = Object.entries(item).flatMap(([key, value]) => {
    if (key === "evidence") return [];
    const normalized =
      typeof value === "number" ? String(value) : text(value) ?? "";
    return normalized ? [`${key}: ${normalized}`] : [];
  });
  return fallback.join(" · ");
}

function listSection(
  tagger: EvidenceTagger,
  heading: string,
  value: unknown,
  fields: readonly string[],
) {
  if (!Array.isArray(value) || value.length === 0) return "";
  const lines = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const line = itemLine(item, fields);
    return line ? [`- ${line}${tagger.tag(item.evidence)}`] : [];
  });
  return lines.length ? `## ${heading}\n\n${lines.join("\n")}` : "";
}

export function buildProposalMarkdown(offer: unknown): {
  markdown: string;
  legend: ProposalEvidenceLegend;
} {
  const tagger = new EvidenceTagger();
  if (!isRecord(offer)) return { markdown: "", legend: tagger.legend };
  const scalarEvidence = isRecord(offer.evidence) ? offer.evidence : {};

  const summaryLines = (
    [
      ["Carrier", offer.carrier, scalarEvidence.carrier],
      ["Quote number", offer.quoteNumber, scalarEvidence.quoteNumber],
      ["Named insured", offer.insuredName, scalarEvidence.insuredName],
      [
        "Proposed effective date",
        offer.proposedEffectiveDate,
        scalarEvidence.proposedEffectiveDate,
      ],
      [
        "Proposed expiration date",
        offer.proposedExpirationDate,
        scalarEvidence.proposedExpirationDate,
      ],
      [
        "Quote expiration date",
        offer.quoteExpirationDate,
        scalarEvidence.quoteExpirationDate,
      ],
      ["Total premium", offer.premium, scalarEvidence.premium],
    ] as const
  ).flatMap(([label, value, evidence]) => {
    const normalized = text(value);
    return normalized
      ? [`- ${label}: ${normalized}${tagger.tag(evidence)}`]
      : [];
  });

  const sections = [
    summaryLines.length ? `## Quote summary\n\n${summaryLines.join("\n")}` : "",
    listSection(tagger, "Parties", offer.parties, ["role", "name"]),
    listSection(tagger, "Coverage offered", offer.coverages, [
      "name",
      "limit",
      "deductible",
    ]),
    listSection(tagger, "Premium", offer.premiums, ["line", "amount"]),
    listSection(tagger, "Conditions", offer.conditions, ["name", "content"]),
    listSection(tagger, "Subjectivities", offer.subjectivities, [
      "description",
      "category",
    ]),
    listSection(tagger, "Exclusions", offer.exclusions, ["name", "content"]),
  ].filter(Boolean);

  return { markdown: sections.join("\n\n"), legend: tagger.legend };
}
