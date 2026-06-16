import type { Doc } from "../_generated/dataModel";
import {
  requirementEvaluationTargetDescription,
  requirementEvaluationTargetLabel,
  requirementSemantics,
  type RequirementEvaluationTarget,
} from "./requirementSemantics";

type Requirement = Pick<
  Doc<"insuranceRequirements">,
  | "_id"
  | "title"
  | "category"
  | "requirementText"
  | "appliesTo"
  | "limit"
  | "limitAmount"
  | "deductible"
  | "deductibleAmount"
  | "sourceType"
  | "sourceDocumentName"
  | "sourceExcerpt"
  | "sourcePageStart"
  | "sourcePageEnd"
  | "evaluationTarget"
  | "evaluationReason"
  | "semanticReviewStatus"
> & {
  clientRequirementSource?: {
    clientOrg: {
      name: string;
    } | null;
  };
};

const CATEGORY_LABELS: Record<Requirement["category"], string> = {
  general_liability: "General liability",
  auto: "Commercial auto",
  workers_comp: "Workers comp",
  umbrella: "Umbrella / excess",
  professional: "Professional liability",
  cyber: "Cyber",
  property: "Property",
  other: "Other",
};

const SCOPE_LABELS: Record<Requirement["appliesTo"], string> = {
  vendors: "Vendor",
  own_org: "My",
  both: "Vendor + my",
};

function normalizeText(value: string | undefined | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function filterComplianceRequirements(
  requirements: Requirement[],
  {
    query,
    appliesTo,
    evaluationTarget,
  }: {
    query?: string;
    appliesTo?: "vendors" | "own_org" | "both" | "all";
    evaluationTarget?: RequirementEvaluationTarget | "all";
  },
) {
  const normalizedQuery = normalizeText(query);
  const queryTerms = normalizedQuery
    .split(/\s+/)
    .filter((term) => term.length >= 3);

  return requirements.filter((requirement) => {
    if (
      appliesTo &&
      appliesTo !== "all" &&
      requirement.appliesTo !== "both" &&
      requirement.appliesTo !== appliesTo
    ) {
      return false;
    }
    const semantics = requirementSemantics(requirement);
    if (
      evaluationTarget &&
      evaluationTarget !== "all" &&
      semantics.evaluationTarget !== evaluationTarget
    ) {
      return false;
    }
    if (!queryTerms.length) return true;
    const haystack = normalizeText(
      [
        requirement.title,
        requirement.category,
        CATEGORY_LABELS[requirement.category],
        requirement.requirementText,
        requirement.limit,
        requirement.deductible,
        requirement.sourceType,
        requirement.sourceDocumentName,
        requirement.sourceExcerpt,
        requirement.appliesTo,
        SCOPE_LABELS[requirement.appliesTo],
        semantics.evaluationTarget,
        requirementEvaluationTargetLabel(semantics.evaluationTarget),
        requirementEvaluationTargetDescription(semantics.evaluationTarget),
        semantics.evaluationReason,
      ].join(" "),
    );
    return queryTerms.some((term) => haystack.includes(term));
  });
}

export function formatComplianceRequirement(requirement: Requirement) {
  const semantics = requirementSemantics(requirement);
  const details = [
    requirement.clientRequirementSource
      ? `source: client requirements from ${requirement.clientRequirementSource.clientOrg?.name ?? "client"}`
      : undefined,
    requirement.sourceType
      ? `sourceType: ${requirement.sourceType}`
      : undefined,
    requirement.sourceDocumentName
      ? `sourceDocument: ${requirement.sourceDocumentName}`
      : undefined,
    requirement.sourcePageStart
      ? `sourcePage: ${requirement.sourcePageEnd && requirement.sourcePageEnd !== requirement.sourcePageStart ? `${requirement.sourcePageStart}-${requirement.sourcePageEnd}` : requirement.sourcePageStart}`
      : undefined,
    `obligationOwner: ${SCOPE_LABELS[requirement.appliesTo]}`,
    `evaluationTarget: ${semantics.evaluationTarget} (${requirementEvaluationTargetLabel(semantics.evaluationTarget)})`,
    semantics.evaluationReason
      ? `evaluationReason: ${semantics.evaluationReason}`
      : undefined,
    `category: ${CATEGORY_LABELS[requirement.category]}`,
    requirement.limit ? `limit: ${requirement.limit}` : undefined,
    requirement.limitAmount !== undefined
      ? `limitAmount: ${requirement.limitAmount}`
      : undefined,
    requirement.deductible
      ? `deductible: ${requirement.deductible}`
      : undefined,
    requirement.deductibleAmount !== undefined
      ? `deductibleAmount: ${requirement.deductibleAmount}`
      : undefined,
  ]
    .filter(Boolean)
    .join("; ");
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
    (requirement) =>
      requirement.appliesTo === "vendors" || requirement.appliesTo === "both",
  );
  const myRequirements = requirements.filter(
    (requirement) =>
      requirement.appliesTo === "own_org" || requirement.appliesTo === "both",
  );

  const sections = [];
  if (vendorRequirements.length > 0) {
    sections.push(
      `Vendor/contractor requirements:\n${vendorRequirements
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

  return `\n\nCOMPLIANCE REQUIREMENTS:\nThese are the organization's saved insurance requirements. appliesTo/obligationOwner says who owns the obligation; evaluationTarget says what evidence can satisfy it. "My requirements" means obligations owned by the current organization, and those obligations may still require subcontractor/downstream evidence or manual control evidence rather than the current organization's policy. Use own_policy rows for current-policy checks, connected_vendor_policy rows with vendor compliance tools, subcontractor_policy rows with subcontractor/downstream evidence, and manual_control rows with source/control evidence. Prefer these records over policy documents when the user asks what the org requires.\n${sections.join("\n\n")}`;
}
