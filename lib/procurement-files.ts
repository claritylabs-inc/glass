export type InferredProcurementFilePurpose =
  | "requirements"
  | "application"
  | "quote"
  | "correspondence";

export function inferProcurementUploadPurpose(
  fileName: string,
): InferredProcurementFilePurpose {
  const normalized = fileName.toLowerCase().replace(/[_-]+/g, " ");

  if (/\b(quote|proposal|indication|premium)\b/.test(normalized)) {
    return "quote";
  }
  if (/\b(acord|application|supplemental)\b/.test(normalized)) {
    return "application";
  }
  if (
    /\.(eml|msg)$/i.test(fileName) ||
    /\b(email|correspondence)\b/.test(normalized)
  ) {
    return "correspondence";
  }
  return "requirements";
}
