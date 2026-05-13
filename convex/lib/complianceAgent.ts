import type { Doc } from "../_generated/dataModel";

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
  }: {
    query?: string;
    appliesTo?: "vendors" | "own_org" | "both" | "all";
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
    if (!queryTerms.length) return true;
    const haystack = normalizeText(
      [
        requirement.title,
        requirement.category,
        CATEGORY_LABELS[requirement.category],
        requirement.requirementText,
        requirement.limit,
        requirement.deductible,
        requirement.appliesTo,
        SCOPE_LABELS[requirement.appliesTo],
      ].join(" "),
    );
    return queryTerms.some((term) => haystack.includes(term));
  });
}

export function formatComplianceRequirement(requirement: Requirement) {
  const details = [
    requirement.clientRequirementSource
      ? `source: client requirements from ${requirement.clientRequirementSource.clientOrg?.name ?? "client"}`
      : undefined,
    `scope: ${SCOPE_LABELS[requirement.appliesTo]}`,
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
  return `- ${requirement.title} (${details})\n  ${requirement.requirementText}`;
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

  return `\n\nCOMPLIANCE REQUIREMENTS:\nThese are the organization's saved insurance requirements. Use them for questions about contractor/vendor requirements, the organization's own insurance standards, minimum limits, deductibles, endorsements, and certificate instructions. Prefer these records over policy documents when the user asks what the org requires.\n${sections.join("\n\n")}`;
}
