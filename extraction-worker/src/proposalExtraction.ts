export type ProposalClaimDocument = {
  proposalDocumentId: string;
  fileId: string;
  fileName: string;
  contentType?: string;
  fileUrl: string;
  order: number;
};

export type ProposalEvidenceRef = {
  proposalDocumentId: string;
  sourceNodeIds: string[];
  sourceSpanIds: string[];
  pageStart?: number;
  pageEnd?: number;
};

export type ProposalExtractedDocument = {
  proposalDocumentId: string;
  fileName: string;
  document: Record<string, unknown>;
  operationalProfile?: Record<string, unknown>;
  sourceSpans: Array<Record<string, unknown>>;
  sourceNodes: Array<Record<string, unknown>>;
  warnings: string[];
  tokenUsage?: unknown;
  supplemental?: ProposalQuoteSupplement;
};

export type ProposalQuoteSupplement = {
  quoteExpirationDate?: string;
  quoteExpirationEvidence?: ProposalEvidenceItem;
  subjectivities?: Array<ProposalEvidenceItem>;
  conditions?: Array<ProposalEvidenceItem>;
};

export type ProposalEvidenceItem = {
  description: string;
  category?: string;
  sourceNodeIds: string[];
  sourceSpanIds: string[];
  pageStart?: number;
  pageEnd?: number;
};

export type ProposalAggregate = {
  carrier?: string;
  quoteNumber?: string;
  insuredName?: string;
  proposedEffectiveDate?: string;
  proposedExpirationDate?: string;
  quoteExpirationDate?: string;
  premium?: string;
  premiumAmount?: number;
  premiums: Array<
    Record<string, unknown> & { evidence: ProposalEvidenceRef[] }
  >;
  coverages: Array<
    Record<string, unknown> & { evidence: ProposalEvidenceRef[] }
  >;
  conditions: Array<
    Record<string, unknown> & { evidence: ProposalEvidenceRef[] }
  >;
  subjectivities: Array<
    Record<string, unknown> & { evidence: ProposalEvidenceRef[] }
  >;
  exclusions: Array<
    Record<string, unknown> & { evidence: ProposalEvidenceRef[] }
  >;
  parties: Array<Record<string, unknown> & { evidence: ProposalEvidenceRef[] }>;
  evidence: Record<string, ProposalEvidenceRef[]>;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map(record)
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && normalized !== "Unknown" ? normalized : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (item): item is string =>
              typeof item === "string" && item.length > 0,
          ),
        ),
      ]
    : [];
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function itemEvidence(
  proposalDocumentId: string,
  value: Record<string, unknown>,
): ProposalEvidenceRef[] {
  const sourceNodeIds = strings(value.sourceNodeIds);
  const documentNodeId = text(value.documentNodeId);
  if (documentNodeId && !sourceNodeIds.includes(documentNodeId)) {
    sourceNodeIds.push(documentNodeId);
  }
  const sourceSpanIds = strings(value.sourceSpanIds);
  const pageStart =
    finiteNumber(value.pageStart) ?? finiteNumber(value.pageNumber);
  const pageEnd = finiteNumber(value.pageEnd) ?? pageStart;
  if (
    sourceNodeIds.length === 0 &&
    sourceSpanIds.length === 0 &&
    pageStart === undefined
  ) {
    return [];
  }
  return [
    {
      proposalDocumentId,
      sourceNodeIds,
      sourceSpanIds,
      pageStart,
      pageEnd,
    },
  ];
}

function first<T>(values: Array<T | undefined>): T | undefined {
  return values.find((value): value is T => value !== undefined);
}

function keyFor(value: Record<string, unknown>, fields: string[]): string {
  return fields
    .map(
      (field) =>
        text(value[field])?.toLowerCase() ?? String(value[field] ?? ""),
    )
    .join("|");
}

function withEvidence(
  documents: ProposalExtractedDocument[],
  field: string,
  keys: string[],
): Array<Record<string, unknown> & { evidence: ProposalEvidenceRef[] }> {
  const byKey = new Map<
    string,
    Record<string, unknown> & { evidence: ProposalEvidenceRef[] }
  >();
  for (const extracted of documents) {
    for (const item of records(extracted.document[field])) {
      const key = keyFor(item, keys);
      if (!key.replace(/\|/g, "")) continue;
      const evidence = itemEvidence(extracted.proposalDocumentId, item);
      const existing = byKey.get(key);
      if (existing) {
        existing.evidence.push(...evidence);
      } else {
        byKey.set(key, { ...item, evidence });
      }
    }
  }
  return [...byKey.values()];
}

function supplementalItems(
  documents: ProposalExtractedDocument[],
  field: "conditions" | "subjectivities",
): Array<Record<string, unknown> & { evidence: ProposalEvidenceRef[] }> {
  const byKey = new Map<
    string,
    Record<string, unknown> & { evidence: ProposalEvidenceRef[] }
  >();
  for (const extracted of documents) {
    const values = extracted.supplemental?.[field] ?? [];
    for (const item of values) {
      const description = text(item.description);
      if (!description) continue;
      const key = `${description.toLowerCase()}|${text(item.category)?.toLowerCase() ?? ""}`;
      const evidence = itemEvidence(
        extracted.proposalDocumentId,
        item as unknown as Record<string, unknown>,
      );
      const existing = byKey.get(key);
      if (existing) existing.evidence.push(...evidence);
      else byKey.set(key, { ...item, evidence });
    }
  }
  return [...byKey.values()];
}

function scalarEvidence(
  documents: ProposalExtractedDocument[],
  field: string,
): ProposalEvidenceRef[] {
  return documents.flatMap((extracted) => {
    const declaration = records(
      record(extracted.document.declarations)?.fields,
    ).find((item) => item.field === field);
    return declaration
      ? itemEvidence(extracted.proposalDocumentId, declaration)
      : [];
  });
}

function partyRows(extracted: ProposalExtractedDocument) {
  const document = extracted.document;
  const parties: Record<string, unknown>[] = [];
  const namedInsured = text(document.insuredName);
  if (namedInsured) parties.push({ role: "named_insured", name: namedInsured });
  for (const item of records(document.additionalNamedInsureds)) {
    parties.push({ role: "additional_named_insured", ...item });
  }
  const insurer = record(document.insurer);
  if (insurer)
    parties.push({ role: "insurer", name: insurer.legalName, ...insurer });
  const producer = record(document.producer);
  if (producer)
    parties.push({ role: "producer", name: producer.agencyName, ...producer });
  for (const field of [
    "additionalInsureds",
    "lossPayees",
    "mortgageHolders",
  ] as const) {
    const role =
      field === "additionalInsureds"
        ? "additional_insured"
        : field === "lossPayees"
          ? "loss_payee"
          : "mortgage_holder";
    for (const item of records(document[field]))
      parties.push({ role, ...item });
  }
  return parties;
}

export function aggregateProposalDocuments(
  documents: ProposalExtractedDocument[],
): ProposalAggregate {
  const quoteDocuments = documents.map((item) => item.document);
  const carrier = first(quoteDocuments.map((item) => text(item.carrier)));
  const quoteNumber = first(
    quoteDocuments.map((item) => text(item.quoteNumber)),
  );
  const insuredName = first(
    quoteDocuments.map((item) => text(item.insuredName)),
  );
  const proposedEffectiveDate = first(
    quoteDocuments.map((item) => text(item.proposedEffectiveDate)),
  );
  const proposedExpirationDate = first(
    quoteDocuments.map((item) => text(item.proposedExpirationDate)),
  );
  const quoteExpirationDate = first([
    ...quoteDocuments.map((item) => text(item.quoteExpirationDate)),
    ...documents.map((item) => text(item.supplemental?.quoteExpirationDate)),
  ]);
  const premium = first(quoteDocuments.map((item) => text(item.premium)));
  const premiumAmount = first(
    quoteDocuments.map((item) => finiteNumber(item.premiumAmount)),
  );

  const documentConditions = withEvidence(documents, "conditions", [
    "name",
    "content",
  ]);
  const documentSubjectivities = [
    ...withEvidence(documents, "enrichedSubjectivities", [
      "description",
      "category",
    ]),
    ...withEvidence(documents, "subjectivities", ["description", "category"]),
  ];
  const parties = new Map<
    string,
    Record<string, unknown> & { evidence: ProposalEvidenceRef[] }
  >();
  for (const extracted of documents) {
    for (const party of partyRows(extracted)) {
      const key = keyFor(party, ["role", "name"]);
      const evidence = itemEvidence(extracted.proposalDocumentId, party);
      const existing = parties.get(key);
      if (existing) existing.evidence.push(...evidence);
      else parties.set(key, { ...party, evidence });
    }
  }

  return {
    carrier,
    quoteNumber,
    insuredName,
    proposedEffectiveDate,
    proposedExpirationDate,
    quoteExpirationDate,
    premium,
    premiumAmount,
    premiums: withEvidence(documents, "premiumBreakdown", ["line", "amount"]),
    coverages: withEvidence(documents, "coverages", [
      "name",
      "limit",
      "deductible",
    ]),
    conditions: [
      ...documentConditions,
      ...supplementalItems(documents, "conditions"),
    ],
    subjectivities: [
      ...documentSubjectivities,
      ...supplementalItems(documents, "subjectivities"),
    ],
    exclusions: withEvidence(documents, "exclusions", ["name", "content"]),
    parties: [...parties.values()],
    evidence: {
      carrier: scalarEvidence(documents, "insurer"),
      quoteNumber: scalarEvidence(documents, "policyNumber"),
      insuredName: scalarEvidence(documents, "namedInsured"),
      proposedEffectiveDate: scalarEvidence(documents, "policyPeriodStart"),
      proposedExpirationDate: scalarEvidence(documents, "policyPeriodEnd"),
      quoteExpirationDate: documents.flatMap((extracted) =>
        extracted.supplemental?.quoteExpirationEvidence
          ? itemEvidence(
              extracted.proposalDocumentId,
              extracted.supplemental
                .quoteExpirationEvidence as unknown as Record<string, unknown>,
            )
          : [],
      ),
    },
  };
}
