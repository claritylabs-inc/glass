import type { Doc } from "../_generated/dataModel";
import {
  REQUIREMENT_CONDITION_TYPE_LABELS,
  REQUIREMENT_LIMIT_KIND_LABELS,
  REQUIREMENT_PROVISION_LABELS,
  REQUIREMENT_SOURCE_TYPE_LABELS,
  type RequirementKind,
  type RequirementScope,
} from "./complianceTypes";
import { lobLabel } from "./linesOfBusiness";

type Requirement = Pick<
  Doc<"insuranceRequirements">,
  | "_id"
  | "kind"
  | "scope"
  | "title"
  | "requirementText"
  | "lineOfBusiness"
  | "limits"
  | "maxDeductible"
  | "provisions"
  | "requiredForms"
  | "minAmBestRating"
  | "minAmBestFinancialSize"
  | "admittedRequired"
  | "conditionType"
  | "noticeDays"
  | "sourceType"
  | "sourceDocumentName"
  | "sourceExcerpt"
  | "sourcePageStart"
  | "sourcePageEnd"
> & {
  clientRequirementSource?: {
    clientOrg: {
      name: string;
    } | null;
  };
};

const SCOPE_LABELS: Record<RequirementScope, string> = {
  vendors: "Vendor",
  own_org: "My",
};

function normalizeText(value: string | undefined | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatLimits(requirement: Requirement) {
  const limits = requirement.limits ?? [];
  return limits
    .map((limit) => {
      const label =
        REQUIREMENT_LIMIT_KIND_LABELS[
          limit.kind as keyof typeof REQUIREMENT_LIMIT_KIND_LABELS
        ] ?? limit.kind;
      return `${label}: ${limit.label ?? `$${limit.amount.toLocaleString()}`}`;
    })
    .join(", ");
}

function formatRequirementDetails(requirement: Requirement) {
  const details = [
    requirement.clientRequirementSource
      ? `source: client requirements from ${requirement.clientRequirementSource.clientOrg?.name ?? "client"}`
      : undefined,
    requirement.sourceType
      ? `sourceType: ${REQUIREMENT_SOURCE_TYPE_LABELS[requirement.sourceType]}`
      : undefined,
    requirement.sourceDocumentName
      ? `sourceDocument: ${requirement.sourceDocumentName}`
      : undefined,
    requirement.sourcePageStart
      ? `sourcePage: ${
          requirement.sourcePageEnd &&
          requirement.sourcePageEnd !== requirement.sourcePageStart
            ? `${requirement.sourcePageStart}-${requirement.sourcePageEnd}`
            : requirement.sourcePageStart
        }`
      : undefined,
    `scope: ${SCOPE_LABELS[requirement.scope]}`,
    `kind: ${requirement.kind}`,
    requirement.lineOfBusiness
      ? `lineOfBusiness: ${requirement.lineOfBusiness} (${lobLabel(requirement.lineOfBusiness)})`
      : undefined,
    requirement.limits?.length ? `limits: ${formatLimits(requirement)}` : undefined,
    requirement.maxDeductible
      ? `maxDeductible: ${requirement.maxDeductible.label ?? requirement.maxDeductible.amount}`
      : undefined,
    requirement.provisions?.length
      ? `provisions: ${requirement.provisions
          .map(
            (provision) =>
              REQUIREMENT_PROVISION_LABELS[
                provision as keyof typeof REQUIREMENT_PROVISION_LABELS
              ] ?? provision,
          )
          .join(", ")}`
      : undefined,
    requirement.requiredForms?.length
      ? `requiredForms: ${requirement.requiredForms.join(", ")}`
      : undefined,
    requirement.minAmBestRating
      ? `minAmBestRating: ${requirement.minAmBestRating}`
      : undefined,
    requirement.minAmBestFinancialSize
      ? `minAmBestFinancialSize: ${requirement.minAmBestFinancialSize}`
      : undefined,
    requirement.admittedRequired ? "admittedRequired: true" : undefined,
    requirement.conditionType
      ? `conditionType: ${REQUIREMENT_CONDITION_TYPE_LABELS[requirement.conditionType]}`
      : undefined,
    requirement.noticeDays !== undefined
      ? `noticeDays: ${requirement.noticeDays}`
      : undefined,
  ];
  return details.filter(Boolean).join("; ");
}

export function filterComplianceRequirements(
  requirements: Requirement[],
  {
    query,
    scope,
    kind,
  }: {
    query?: string;
    scope?: RequirementScope | "all";
    kind?: RequirementKind | "all";
  },
) {
  const queryTerms = normalizeText(query)
    .split(/\s+/)
    .filter((term) => term.length >= 3);

  return requirements.filter((requirement) => {
    if (scope && scope !== "all" && requirement.scope !== scope) return false;
    if (kind && kind !== "all" && requirement.kind !== kind) return false;
    if (!queryTerms.length) return true;
    const haystack = normalizeText(
      [
        requirement.title,
        requirement.kind,
        requirement.scope,
        requirement.lineOfBusiness,
        requirement.lineOfBusiness ? lobLabel(requirement.lineOfBusiness) : "",
        requirement.requirementText,
        formatRequirementDetails(requirement),
        requirement.sourceType,
        requirement.sourceDocumentName,
        requirement.sourceExcerpt,
      ].join(" "),
    );
    return queryTerms.some((term) => haystack.includes(term));
  });
}

export function formatComplianceRequirement(requirement: Requirement) {
  const details = formatRequirementDetails(requirement);
  const source = requirement.sourceExcerpt
    ? `\n  Source language: ${requirement.sourceExcerpt}`
    : "";
  return `- ${requirement.title} (${details})\n  ${requirement.requirementText}${source}`;
}

export function formatComplianceRequirementsContext(
  requirements: Requirement[],
) {
  if (requirements.length === 0) return "";

  const vendorRequirements = requirements.filter(
    (requirement) => requirement.scope === "vendors",
  );
  const myRequirements = requirements.filter(
    (requirement) => requirement.scope === "own_org",
  );
  const sections = [];
  if (vendorRequirements.length > 0) {
    sections.push(
      `Vendor requirements:\n${vendorRequirements
        .map(formatComplianceRequirement)
        .join("\n")}`,
    );
  }
  if (myRequirements.length > 0) {
    sections.push(
      `My requirements:\n${myRequirements
        .map(formatComplianceRequirement)
        .join("\n")}`,
    );
  }

  return `\n\nCOMPLIANCE REQUIREMENTS:\nThese are typed insurance compliance rules. scope says whose obligation this is. kind says how it is evaluated: coverage rules are checked against structured policy coverage evidence, insurer rules are manually verified carrier standards, and condition rules are manually verified administrative obligations. Prefer these records over policy documents when the user asks what the org requires.\n${sections.join("\n\n")}`;
}
