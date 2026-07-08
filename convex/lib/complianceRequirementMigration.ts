import dayjs from "dayjs";
import type { Id } from "../_generated/dataModel";
import {
  isLobCode,
  type AcordLobCode,
} from "./linesOfBusiness";
import {
  isRequirementLimitKind,
  isRequirementProvision,
  type RequirementKind,
  type RequirementLimitKind,
  type RequirementScope,
} from "./complianceTypes";

type LegacyRequirementScope = RequirementScope | "both";

type LegacyComplianceRequirement = {
  orgId: Id<"organizations">;
  title?: string;
  requirementText?: string;
  category?: string;
  name?: string;
  coverageCode?: string;
  limit?: string;
  limitAmount?: number;
  limitType?: string;
  deductible?: string;
  deductibleAmount?: number;
  originalContent?: string;
  sourceDocumentId?: Id<"requirementSourceDocuments">;
  sourceDocumentName?: string;
  sourceType?:
    | "manual"
    | "bulk_import"
    | "lease_agreement"
    | "client_contract"
    | "vendor_requirements"
    | "other";
  sourceExcerpt?: string;
  sourcePageStart?: number;
  sourcePageEnd?: number;
  appliesTo?: LegacyRequirementScope;
  evaluationTarget?:
    | "own_policy"
    | "connected_vendor_policy"
    | "subcontractor_policy"
    | "manual_control"
    | "not_policy_checkable";
  status?: "active" | "archived";
  createdByUserId: Id<"users">;
  updatedByUserId: Id<"users">;
  createdAt?: number;
  updatedAt?: number;
};

export type MigratedComplianceRequirement = {
  orgId: Id<"organizations">;
  kind: RequirementKind;
  scope: RequirementScope;
  title: string;
  requirementText: string;
  lineOfBusiness?: string;
  limits?: Array<{ kind: string; amount: number; label?: string }>;
  maxDeductible?: { amount: number; label?: string };
  coverageForm?: "occurrence" | "claims_made";
  retroactiveDateOnOrBefore?: string;
  provisions?: string[];
  requiredForms?: string[];
  minAmBestRating?: string;
  minAmBestFinancialSize?: string;
  admittedRequired?: boolean;
  conditionType?:
    | "cancellation_notice"
    | "certificate_delivery"
    | "claims_reporting"
    | "subcontractor_insurance"
    | "other";
  noticeDays?: number;
  sourceDocumentId?: Id<"requirementSourceDocuments">;
  sourceDocumentName?: string;
  sourceType?:
    | "manual"
    | "bulk_import"
    | "lease_agreement"
    | "client_contract"
    | "vendor_requirements"
    | "other";
  sourceExcerpt?: string;
  sourcePageStart?: number;
  sourcePageEnd?: number;
  status: "active" | "archived";
  createdByUserId: Id<"users">;
  updatedByUserId: Id<"users">;
  createdAt: number;
  updatedAt: number;
};

const CATEGORY_LOB: Record<string, AcordLobCode> = {
  general_liability: "CGL",
  auto: "AUTOB",
  workers_comp: "WORK",
  umbrella: "UMBRC",
  professional: "EO",
  cyber: "OLIB",
  property: "PROPC",
};

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scopeFromLegacy(value: LegacyRequirementScope | undefined): RequirementScope {
  return value === "own_org" ? "own_org" : "vendors";
}

function lineOfBusinessFromLegacy(row: LegacyComplianceRequirement) {
  const direct = cleanString(row.coverageCode).toUpperCase();
  if (isLobCode(direct)) return direct;
  const category = cleanString(row.category);
  if (category && CATEGORY_LOB[category]) return CATEGORY_LOB[category];

  const text = normalizeText(
    [row.title, row.name, row.requirementText, row.originalContent].join(" "),
  );
  if (/\b(crime|fidelity)\b/.test(text)) return "CRIME";
  if (/\b(umbrella|excess)\b/.test(text)) return "UMBRC";
  if (/\b(workers?|employers?)\b/.test(text)) return "WORK";
  if (/\b(auto|automobile|vehicle)\b/.test(text)) return "AUTOB";
  if (/\b(cyber|privacy|network security)\b/.test(text)) return "OLIB";
  if (/\b(e&o|errors?\s+and\s+omissions?|professional)\b/.test(text)) return "EO";
  if (/\b(property)\b/.test(text)) return "PROPC";
  if (/\b(general liability|commercial general liability|cgl)\b/.test(text)) {
    return "CGL";
  }
  return "UN";
}

function legacyLimitKind(row: LegacyComplianceRequirement): RequirementLimitKind {
  const text = normalizeText(
    [row.limitType, row.limit, row.title, row.requirementText].join(" "),
  );
  const direct = cleanString(row.limitType);
  if (isRequirementLimitKind(direct)) return direct;
  if (/\b(combined single|csl)\b/.test(text)) return "combined_single_limit";
  if (/\b(per claim|each claim|claim)\b/.test(text)) return "per_claim";
  if (/\b(each accident|per accident)\b/.test(text)) return "el_each_accident";
  if (/\b(disease each employee|each employee)\b/.test(text)) {
    return "el_disease_each_employee";
  }
  if (/\b(disease policy limit|policy limit)\b/.test(text)) {
    return "el_disease_policy_limit";
  }
  if (/\b(products?|completed operations?)\b/.test(text)) {
    return "products_completed_ops_aggregate";
  }
  if (/\bgeneral aggregate\b/.test(text)) return "general_aggregate";
  if (/\baggregate\b/.test(text)) return "aggregate";
  if (/\b(per occurrence|each occurrence|occurrence)\b/.test(text)) {
    return "per_occurrence";
  }
  return "other";
}

function kindFromLegacy(row: LegacyComplianceRequirement): RequirementKind {
  const text = normalizeText(
    [row.title, row.name, row.category, row.requirementText, row.originalContent].join(" "),
  );
  if (
    !row.limitAmount &&
    /\b(a rated|a minus|a- rated|am best|a m best|financial size|admitted|licensed|authorized|carrier rating)\b/.test(text)
  ) {
    return "insurer";
  }
  if (row.limitAmount || cleanString(row.category) !== "other") return "coverage";
  return "condition";
}

function coverageFormFromText(text: string) {
  if (/\bclaims made\b/.test(text)) return "claims_made";
  if (/\boccurrence\b/.test(text)) return "occurrence";
  return undefined;
}

function provisionsFromText(text: string) {
  const provisions = [
    /\badditional insured\b/.test(text) ? "additional_insured" : undefined,
    /\bwaiver of subrogation\b|\bsubrogation waived\b|\bwos\b/.test(text)
      ? "waiver_of_subrogation"
      : undefined,
    /\bprimary\b/.test(text) && /\bnon contributory\b/.test(text)
      ? "primary_non_contributory"
      : undefined,
  ].filter((value): value is string => Boolean(value));
  return provisions.filter(isRequirementProvision);
}

function conditionTypeFromText(text: string): MigratedComplianceRequirement["conditionType"] {
  if (/\bcancellation|non renewal|nonrenewal\b/.test(text)) {
    return "cancellation_notice";
  }
  if (/\bcertificate|evidence of insurance|proof of insurance|coi\b/.test(text)) {
    return "certificate_delivery";
  }
  if (/\bclaim|demand|complaint|lawsuit|arbitration|mediation\b/.test(text)) {
    return "claims_reporting";
  }
  if (/\bsubcontractor|sub contractor|downstream\b/.test(text)) {
    return "subcontractor_insurance";
  }
  return "other";
}

function noticeDaysFromText(text: string) {
  const match = text.match(/\b(\d{1,3})\s+days?\b/);
  if (!match) return undefined;
  const days = Number.parseInt(match[1]!, 10);
  return Number.isFinite(days) ? days : undefined;
}

function minAmBestRatingFromText(text: string) {
  if (/\ba\+\+\b/.test(text)) return "A++";
  if (/\ba\+\b/.test(text)) return "A+";
  if (/\ba-\b|\ba minus\b|\ba rated\b/.test(text)) return "A-";
  if (/\bb\+\+\b/.test(text)) return "B++";
  return undefined;
}

export function requirementNeedsLegacyShapeBackfill(row: {
  kind?: unknown;
  scope?: unknown;
}) {
  return row.kind !== "coverage" && row.kind !== "insurer" && row.kind !== "condition"
    || (row.scope !== "own_org" && row.scope !== "vendors");
}

export function migrateLegacyComplianceRequirement(
  row: LegacyComplianceRequirement,
): MigratedComplianceRequirement {
  const now = dayjs().valueOf();
  const text = normalizeText(
    [row.title, row.name, row.requirementText, row.originalContent, row.sourceExcerpt].join(" "),
  );
  const kind = kindFromLegacy(row);
  const title = cleanString(row.title) || cleanString(row.name) || "Insurance requirement";
  const requirementText =
    cleanString(row.requirementText) ||
    cleanString(row.originalContent) ||
    cleanString(row.sourceExcerpt) ||
    title;
  const migrated: MigratedComplianceRequirement = {
    orgId: row.orgId,
    kind,
    scope: scopeFromLegacy(row.appliesTo),
    title,
    requirementText,
    sourceDocumentId: row.sourceDocumentId,
    sourceDocumentName: cleanString(row.sourceDocumentName) || undefined,
    sourceType: row.sourceType ?? "bulk_import",
    sourceExcerpt: cleanString(row.sourceExcerpt) || requirementText,
    sourcePageStart: row.sourcePageStart,
    sourcePageEnd: row.sourcePageEnd,
    status: row.status === "archived" ? "archived" : "active",
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: typeof row.createdAt === "number" ? row.createdAt : now,
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : now,
  };

  if (kind === "coverage") {
    const provisions = provisionsFromText(text);
    migrated.lineOfBusiness = lineOfBusinessFromLegacy(row);
    migrated.limits =
      typeof row.limitAmount === "number" && Number.isFinite(row.limitAmount)
        ? [
          {
            kind: legacyLimitKind(row),
            amount: row.limitAmount,
            label: cleanString(row.limit) || undefined,
          },
        ]
        : undefined;
    migrated.maxDeductible =
      typeof row.deductibleAmount === "number" && Number.isFinite(row.deductibleAmount)
        ? {
          amount: row.deductibleAmount,
          label: cleanString(row.deductible) || undefined,
        }
        : undefined;
    migrated.coverageForm = coverageFormFromText(text);
    migrated.provisions = provisions.length ? provisions : undefined;
  } else if (kind === "insurer") {
    migrated.minAmBestRating = minAmBestRatingFromText(text);
    migrated.admittedRequired = /\badmitted|licensed|authorized\b/.test(text) || undefined;
  } else {
    migrated.conditionType = conditionTypeFromText(text);
    migrated.noticeDays =
      migrated.conditionType === "cancellation_notice"
        ? noticeDaysFromText(text)
        : undefined;
  }

  return migrated;
}
