import { Doc } from "../_generated/dataModel";

// ── Category mapping ──────────────────────────────────────────────────────────

type IntelligenceCategory =
  | "company_info"
  | "operations"
  | "financial"
  | "employees"
  | "risk"
  | "observation";

const FIELD_CATEGORY_MAP: Record<string, IntelligenceCategory> = {
  legalName: "company_info",
  dba: "company_info",
  entityType: "company_info",
  fein: "company_info",
  website: "company_info",
  primaryContactName: "company_info",
  primaryContactTitle: "company_info",
  primaryContactEmail: "company_info",
  primaryContactPhone: "company_info",
  mailingAddress: "company_info",
  businessDescription: "operations",
  naicsCode: "operations",
  sicCode: "operations",
  yearsInBusiness: "operations",
  yearEstablished: "operations",
  operationsSummary: "operations",
  numberOfEmployees: "employees",
  annualRevenue: "financial",
  hasPriorBankruptcy: "risk",
  bankruptcyDetails: "risk",
  hasPriorCancellation: "risk",
  cancellationDetails: "risk",
  hasForeignOperations: "risk",
  foreignOperationsDetails: "risk",
};

export function fieldToIntelligenceCategory(
  fieldPath: string
): IntelligenceCategory {
  return FIELD_CATEGORY_MAP[fieldPath] ?? "observation";
}

// ── Human-readable fact builder ───────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  legalName: "Legal name",
  dba: "DBA",
  entityType: "Entity type",
  fein: "FEIN",
  website: "Website",
  primaryContactName: "Primary contact name",
  primaryContactTitle: "Primary contact title",
  primaryContactEmail: "Primary contact email",
  primaryContactPhone: "Primary contact phone",
  businessDescription: "Business description",
  naicsCode: "NAICS code",
  sicCode: "SIC code",
  yearsInBusiness: "Years in business",
  yearEstablished: "Year established",
  numberOfEmployees: "Number of employees",
  annualRevenue: "Annual revenue",
  operationsSummary: "Operations summary",
  hasPriorBankruptcy: "Prior bankruptcy",
  hasPriorCancellation: "Prior policy cancellation",
  hasForeignOperations: "Foreign operations",
};

export function buildPassportFact(fieldPath: string, value: unknown): string {
  const label = FIELD_LABELS[fieldPath] ?? fieldPath;
  return `${label} is ${String(value)}`;
}

// ── Requirement resolution ────────────────────────────────────────────────────

export type ExtendedSection =
  | "prior_carrier"
  | "loss_history"
  | "additional_interests"
  | "transaction_info";

export const CORE_SECTIONS = [
  "applicant_info",
  "nature_of_business",
  "locations",
  "general_info",
] as const;

export function getRequiredSections(
  clientOrg: Pick<Doc<"organizations">, "passportRequirementOverrides">,
  brokerOrg: Pick<Doc<"organizations">, "defaultRequiredPassportSections">
): string[] {
  const core = [...CORE_SECTIONS];
  // Client override takes precedence over broker default; undefined means "use broker default"
  const extras: ExtendedSection[] =
    clientOrg.passportRequirementOverrides !== undefined
      ? (clientOrg.passportRequirementOverrides as ExtendedSection[])
      : (brokerOrg.defaultRequiredPassportSections as ExtendedSection[] | undefined) ?? [];
  return [...core, ...extras];
}
