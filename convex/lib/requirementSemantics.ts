import type { Doc } from "../_generated/dataModel";

export const REQUIREMENT_EVALUATION_TARGETS = [
  "own_policy",
  "connected_vendor_policy",
  "subcontractor_policy",
  "manual_control",
  "not_policy_checkable",
] as const;

export const REQUIREMENT_SEMANTIC_REVIEW_STATUSES = [
  "system_classified",
  "needs_review",
  "user_confirmed",
] as const;

export type RequirementEvaluationTarget =
  (typeof REQUIREMENT_EVALUATION_TARGETS)[number];

export type RequirementSemanticReviewStatus =
  (typeof REQUIREMENT_SEMANTIC_REVIEW_STATUSES)[number];

type RequirementScope = "vendors" | "own_org" | "both";

type RequirementSemanticInput = {
  appliesTo: RequirementScope;
  title?: string;
  category?: string;
  requirementText?: string;
  originalContent?: string;
  sourceExcerpt?: string;
  sourceType?: string;
  limit?: string;
  limitAmount?: number;
  deductible?: string;
  deductibleAmount?: number;
  coverageCode?: string;
  name?: string;
  evaluationTarget?: string;
  evaluationReason?: string;
  semanticReviewStatus?: string;
};

export type RequirementSemantics = {
  evaluationTarget: RequirementEvaluationTarget;
  evaluationReason?: string;
  semanticReviewStatus: RequirementSemanticReviewStatus;
};

function isEvaluationTarget(
  value: string | undefined,
): value is RequirementEvaluationTarget {
  return (
    typeof value === "string" &&
    REQUIREMENT_EVALUATION_TARGETS.includes(
      value as RequirementEvaluationTarget,
    )
  );
}

function isSemanticReviewStatus(
  value: string | undefined,
): value is RequirementSemanticReviewStatus {
  return (
    typeof value === "string" &&
    REQUIREMENT_SEMANTIC_REVIEW_STATUSES.includes(
      value as RequirementSemanticReviewStatus,
    )
  );
}

function normalizedText(input: RequirementSemanticInput) {
  return [
    input.title,
    input.category,
    input.name,
    input.coverageCode,
    input.requirementText,
    input.originalContent,
    input.sourceExcerpt,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function defaultTargetForScope(
  appliesTo: RequirementScope,
): RequirementEvaluationTarget {
  return appliesTo === "vendors"
    ? "connected_vendor_policy"
    : "own_policy";
}

export function defaultRequirementEvaluationTarget(
  appliesTo: RequirementScope,
): RequirementEvaluationTarget {
  return defaultTargetForScope(appliesTo);
}

export function classifyRequirementSemantics(
  input: RequirementSemanticInput,
): RequirementSemantics {
  const text = normalizedText(input);
  const suppliedTarget = isEvaluationTarget(input.evaluationTarget)
    ? input.evaluationTarget
    : undefined;
  const suppliedStatus = isSemanticReviewStatus(input.semanticReviewStatus)
    ? input.semanticReviewStatus
    : undefined;
  const suppliedReason = input.evaluationReason?.trim() || undefined;

  if (
    /\b(subcontractors?|downstream partners?|sub-?producers?|independent contractors?)\b/i.test(
      text,
    )
  ) {
    return {
      evaluationTarget: "subcontractor_policy",
      evaluationReason:
        "Requires subcontractor or downstream partner policy evidence.",
      semanticReviewStatus: "system_classified",
    };
  }

  if (
    /\b(certificate|certificate holder|evidence of (insurance|coverage)|proof of (insurance|coverage)|provide (a )?(certificate|evidence|proof)|notify|written notice|notice of cancellation|cancellation notice|non-?renewal notice|report (a )?(claim|demand|complaint)|demand|complaint|regulatory|disciplinary|subpoena|lawsuit|arbitration|mediation|cancelled|canceled|non-?renewed|materially changed|restricted|impaired|replaced|insolvent|financial strength|a-?rated|rating|licensed|authorized)\b/i.test(
      text,
    )
  ) {
    return {
      evaluationTarget: "manual_control",
      evaluationReason:
        "Requires manual control or document evidence rather than policy-limit matching.",
      semanticReviewStatus: "system_classified",
    };
  }

  if (suppliedTarget) {
    return {
      evaluationTarget: suppliedTarget,
      evaluationReason: suppliedReason,
      semanticReviewStatus: suppliedStatus ?? "system_classified",
    };
  }

  return {
    evaluationTarget: defaultTargetForScope(input.appliesTo),
      evaluationReason:
        input.appliesTo === "vendors"
          ? "Defaulted to connected vendor policy evidence from requirement scope."
          : input.appliesTo === "both"
            ? "Defaulted to policy evidence for both the current organization and connected vendors from requirement scope."
            : "Defaulted to current organization policy evidence from requirement scope.",
    semanticReviewStatus: "system_classified",
  };
}

export function requirementSemantics(
  requirement: RequirementSemanticInput,
): RequirementSemantics {
  if (isEvaluationTarget(requirement.evaluationTarget)) {
    return {
      evaluationTarget: requirement.evaluationTarget,
      evaluationReason: requirement.evaluationReason?.trim() || undefined,
      semanticReviewStatus: isSemanticReviewStatus(
        requirement.semanticReviewStatus,
      )
        ? requirement.semanticReviewStatus
        : "system_classified",
    };
  }
  return classifyRequirementSemantics(requirement);
}

export function requirementEvaluationTargetLabel(
  target: RequirementEvaluationTarget,
) {
  switch (target) {
    case "own_policy":
      return "Own policy";
    case "connected_vendor_policy":
      return "Vendor policy";
    case "subcontractor_policy":
      return "Subcontractor evidence";
    case "manual_control":
      return "Manual control";
    case "not_policy_checkable":
      return "Context only";
  }
}

export function requirementEvaluationTargetDescription(
  target: RequirementEvaluationTarget,
) {
  switch (target) {
    case "own_policy":
      return "Check against the organization's own policy evidence.";
    case "connected_vendor_policy":
      return "Check against connected vendor policy evidence.";
    case "subcontractor_policy":
      return "Check using subcontractor or downstream partner evidence.";
    case "manual_control":
      return "Requires manual control or document evidence.";
    case "not_policy_checkable":
      return "Stored as requirements context and not checked against policies.";
  }
}

export function shouldEvaluateOwnOrgRequirement(
  requirement: RequirementSemanticInput,
) {
  const target = requirementSemantics(requirement).evaluationTarget;
  return (
    (requirement.appliesTo === "own_org" || requirement.appliesTo === "both") &&
    target !== "connected_vendor_policy" &&
    target !== "not_policy_checkable"
  );
}

export function shouldEvaluateConnectedVendorRequirement(
  requirement: RequirementSemanticInput,
) {
  const target = requirementSemantics(requirement).evaluationTarget;
  return (
    (requirement.appliesTo === "vendors" || requirement.appliesTo === "both") &&
    target !== "not_policy_checkable"
  );
}

export function canPolicyMatchRequirement(
  requirement: RequirementSemanticInput,
) {
  const target = requirementSemantics(requirement).evaluationTarget;
  return target === "own_policy" || target === "connected_vendor_policy";
}

export function nonPolicyRequirementReviewNote(
  requirement: RequirementSemanticInput,
) {
  const target = requirementSemantics(requirement).evaluationTarget;
  if (target === "subcontractor_policy") {
    return "This requirement needs subcontractor or downstream partner policy evidence, or confirmation that no covered subcontractors are used. A direct policy held by the organization being checked does not satisfy it by itself.";
  }
  if (target === "manual_control") {
    return "This requirement needs manual control or document evidence and cannot be verified from policy limits alone.";
  }
  return "This requirement is stored as context and is not checked against policy evidence.";
}

export function requirementWithSemanticDefaults<
  T extends RequirementSemanticInput,
>(requirement: T) {
  const semantics = requirementSemantics(requirement);
  return {
    ...requirement,
    evaluationTarget: semantics.evaluationTarget,
    evaluationReason: semantics.evaluationReason,
    semanticReviewStatus: semantics.semanticReviewStatus,
  };
}

export type SemanticRequirementDoc = Doc<"insuranceRequirements"> & {
  evaluationTarget?: RequirementEvaluationTarget;
  evaluationReason?: string;
  semanticReviewStatus?: RequirementSemanticReviewStatus;
};
