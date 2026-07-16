export const IRS_ENTITY_TYPES = [
  { value: "sole_proprietorship", label: "Sole proprietorship" },
  { value: "partnership", label: "Partnership" },
  { value: "corporation", label: "Corporation" },
  { value: "s_corporation", label: "S corporation" },
  { value: "limited_liability_company", label: "Limited liability company (LLC)" },
  { value: "trust_estate", label: "Trust / estate" },
  { value: "tax_exempt_organization", label: "Tax-exempt organization" },
  { value: "government_entity", label: "Government entity" },
  { value: "other", label: "Other" },
] as const;

export type IrsEntityType = (typeof IRS_ENTITY_TYPES)[number]["value"];

export function irsEntityTypeLabel(value: IrsEntityType) {
  return IRS_ENTITY_TYPES.find((option) => option.value === value)?.label ?? "Other";
}

export function normalizeIrsEntityType(value: unknown): IrsEntityType | "" {
  if (typeof value !== "string" || !value.trim()) return "";
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.includes("tax exempt") || normalized.includes("nonprofit") || normalized.includes("non profit")) {
    return "tax_exempt_organization";
  }
  if (normalized.includes("government") || normalized.includes("municipality") || normalized.includes("tribal")) {
    return "government_entity";
  }
  if (normalized.includes("trust") || normalized.includes("estate")) return "trust_estate";
  if (normalized.includes("limited liability") || /\bllc\b/.test(normalized)) {
    return "limited_liability_company";
  }
  if (normalized.includes("s corporation") || /\bs corp\b/.test(normalized)) {
    return "s_corporation";
  }
  if (normalized.includes("corporation") || /\bcorp\b/.test(normalized)) {
    return "corporation";
  }
  if (normalized.includes("partnership") || /\bpartners?\b/.test(normalized)) {
    return "partnership";
  }
  if (normalized.includes("sole proprietor") || normalized.includes("individual")) {
    return "sole_proprietorship";
  }
  const exact = IRS_ENTITY_TYPES.find((option) => option.value === normalized);
  return exact?.value ?? "other";
}
