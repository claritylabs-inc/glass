/**
 * Shared helpers for policy extraction.
 * Used by extractPolicy, retryExtraction, and reExtractFromFile actions.
 */

/** Strip markdown code fences from AI response text. */
export function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
}

/** Map raw Claude extraction JSON to mutation-compatible fields. */
export function applyExtracted(extracted: any) {
  const meta = extracted.metadata ?? extracted;

  const policyTypes = Array.isArray(meta.policyTypes)
    ? meta.policyTypes
    : meta.policyType
      ? [meta.policyType]
      : ["other"];

  return {
    carrier: meta.carrier || meta.security || "Unknown",
    security: meta.security || undefined,
    underwriter: meta.underwriter || undefined,
    mga: meta.mga || undefined,
    broker: meta.broker || undefined,
    policyNumber: meta.policyNumber || "Unknown",
    policyTypes,
    documentType: (meta.documentType === "quote" ? "quote" : "policy") as "policy" | "quote",
    policyYear: meta.policyYear || new Date().getFullYear(),
    effectiveDate: meta.effectiveDate || "Unknown",
    expirationDate: meta.expirationDate || "Unknown",
    isRenewal: meta.isRenewal ?? false,
    coverages: extracted.coverages || meta.coverages || [],
    premium: meta.premium,
    insuredName: meta.insuredName || "Unknown",
    summary: meta.summary,
    metadataSource: extracted.metadataSource || undefined,
    document: extracted.document || undefined,
    extractionStatus: "complete" as const,
    extractionError: "",
  };
}

/** Merge document sections from chunked extraction passes. */
export function mergeChunkedSections(
  metadataResult: any,
  sectionChunks: any[],
): any {
  const allSections: any[] = [];
  let regulatoryContext: any = null;
  let complaintContact: any = null;
  let costsAndFees: any = null;

  for (const chunk of sectionChunks) {
    if (chunk.sections) {
      allSections.push(...chunk.sections);
    }
    if (chunk.regulatoryContext) regulatoryContext = chunk.regulatoryContext;
    if (chunk.complaintContact) complaintContact = chunk.complaintContact;
    if (chunk.costsAndFees) costsAndFees = chunk.costsAndFees;
  }

  return {
    metadata: metadataResult.metadata,
    metadataSource: metadataResult.metadataSource,
    coverages: metadataResult.coverages,
    document: {
      sections: allSections,
      ...(regulatoryContext && { regulatoryContext }),
      ...(complaintContact && { complaintContact }),
      ...(costsAndFees && { costsAndFees }),
    },
    totalPages: metadataResult.totalPages,
  };
}

/** Determine page ranges for chunked extraction. */
export function getPageChunks(totalPages: number, chunkSize: number = 30): Array<[number, number]> {
  const chunks: Array<[number, number]> = [];
  for (let start = 1; start <= totalPages; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, totalPages);
    chunks.push([start, end]);
  }
  return chunks;
}
