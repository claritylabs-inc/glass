function descriptionText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { value?: unknown }).value === "string"
  ) {
    return (value as { value: string }).value;
  }
  return undefined;
}

export function normalizeCertificateDescription(value: unknown) {
  const text = descriptionText(value)?.slice(0, 900);
  if (!text?.trim()) return undefined;
  return text
    .replace(/^[ \t]*(?:[-*]|\d+[.)])[ \t]+/gm, "")
    .replace(/\bACORD\s*\d*\b/gi, "")
    .replace(/\bGenerated using Glass\b/gi, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim() || undefined;
}
