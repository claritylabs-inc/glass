import dayjs from "dayjs";
import type { Doc, Id } from "../_generated/dataModel";
import { isLobCode, lobLabel, policyLobCodes } from "./linesOfBusiness";
import {
  isRequirementLimitKind,
  isRequirementProvision,
  REQUIREMENT_LIMIT_KIND_LABELS,
  REQUIREMENT_PROVISION_LABELS,
  type ComplianceCheckStatus,
  type RequirementLimitKind,
  type RequirementProvision,
} from "./complianceTypes";

export type ComplianceCheckResult = {
  requirementId: Id<"insuranceRequirements">;
  status: ComplianceCheckStatus;
  reasons: string[];
  matchedPolicyIds: Id<"policies">[];
  matchedPolicy?: {
    _id: Id<"policies">;
    carrier?: string;
    policyNumber?: string;
    insuredName?: string;
    expectedInsuredName?: string;
    expirationDate?: string;
    dataStage: "placeholder" | "preview" | "final";
    provisional: boolean;
    coverageName?: string;
    coverageLimit?: string;
    detectedLimitAmount?: number;
  };
  matchedSummary?: string;
  expiresAt?: string;
  daysUntilExpiration?: number;
  checkedAt: number;
  checkedBy: "system" | "user" | "agent";
  evidence?: {
    note?: string;
    fileId?: Id<"_storage">;
    fileName?: string;
    validUntil?: string;
  };
};

type ManualCheck = Pick<
  Doc<"complianceChecks">,
  | "status"
  | "reasons"
  | "matchedPolicyIds"
  | "matchedSummary"
  | "expiresAt"
  | "evidence"
  | "checkedAt"
  | "checkedBy"
  | "checkedByUserId"
>;

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const INSURED_NAME_STOPWORDS = new Set([
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "company",
  "co",
  "the",
]);

function significantNameTokens(value: string | undefined | null) {
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !INSURED_NAME_STOPWORDS.has(token));
}

export function insuredNameMatches(
  actual: string | undefined | null,
  expected: string | undefined | null,
) {
  const actualText = normalizeText(actual);
  const expectedText = normalizeText(expected);
  if (!expectedText) return true;
  if (!actualText) return false;
  if (actualText.includes(expectedText) || expectedText.includes(actualText)) {
    return true;
  }
  const expectedTokens = significantNameTokens(expected);
  if (expectedTokens.length === 0) return true;
  const actualTokens = new Set(significantNameTokens(actual));
  const matched = expectedTokens.filter((token) => actualTokens.has(token));
  return matched.length / expectedTokens.length >= 0.7;
}

function parseDate(value: string | undefined) {
  if (!value) return Number.NaN;
  const time = dayjs(value).valueOf();
  return Number.isFinite(time) ? time : Number.NaN;
}

function policyDataStage(policy: Doc<"policies">) {
  if (
    policy.extractionDataStage === "placeholder" ||
    policy.extractionDataStage === "preview" ||
    policy.extractionDataStage === "final"
  ) {
    return policy.extractionDataStage;
  }
  return policy.pipelineStatus === "complete" ? "final" : "placeholder";
}

export function policyReadableForCompliance(
  policy: Doc<"policies">,
  includePreviewPolicies: boolean,
) {
  if (policy.deletedAt || policy.dismissed) return false;
  const dataStage = policyDataStage(policy);
  if (policy.pipelineStatus === "complete" && dataStage === "final") {
    return true;
  }
  return (
    includePreviewPolicies &&
    dataStage === "preview" &&
    policy.pipelineStatus !== "complete"
  );
}

function normalizeLimitKind(value: unknown): RequirementLimitKind | undefined {
  if (typeof value !== "string") return undefined;
  const direct = value.trim().toLowerCase();
  if (isRequirementLimitKind(direct)) return direct;
  const text = normalizeText(value);
  if (/\b(per occurrence|each occurrence|occurrence)\b/.test(text)) {
    return "per_occurrence";
  }
  if (/\b(general aggregate|aggregate limit)\b/.test(text)) {
    return "general_aggregate";
  }
  if (/\b(products?|completed operations?)\b/.test(text)) {
    return "products_completed_ops_aggregate";
  }
  if (/\b(personal|advertising injury)\b/.test(text)) {
    return "personal_adv_injury";
  }
  if (/\b(rented premises|damage to premises)\b/.test(text)) {
    return "damage_to_rented_premises";
  }
  if (/\b(medical expense|med exp)\b/.test(text)) return "medical_expense";
  if (/\b(each claim|per claim|claim)\b/.test(text)) return "per_claim";
  if (/\b(combined single|csl)\b/.test(text)) return "combined_single_limit";
  if (/\b(each accident|el each accident|bodily injury by accident)\b/.test(text)) {
    return "el_each_accident";
  }
  if (/\b(disease each employee|each employee)\b/.test(text)) {
    return "el_disease_each_employee";
  }
  if (/\b(disease policy limit|policy limit)\b/.test(text)) {
    return "el_disease_policy_limit";
  }
  if (/\baggregate\b/.test(text)) return "aggregate";
  return undefined;
}

function coverageLobMatches(
  requirement: Doc<"insuranceRequirements">,
  policy: Doc<"policies">,
) {
  const required = requirement.lineOfBusiness;
  if (!required || required === "UN") return true;
  if (isLobCode(required) && policyLobCodes(policy).includes(required)) {
    return true;
  }
  const requiredText = normalizeText(`${required} ${lobLabel(required)}`);
  return (policy.coverages ?? []).some((coverage) =>
    normalizeText(
      [
        coverage.lineOfBusiness,
        coverage.name,
        coverage.coverageCode,
        coverage.originalContent,
      ].join(" "),
    ).includes(requiredText),
  );
}

function coverageText(coverage: NonNullable<Doc<"policies">["coverages"]>[number]) {
  return normalizeText(
    [
      coverage.name,
      coverage.lineOfBusiness,
      coverage.coverageCode,
      coverage.limit,
      coverage.limitType,
      coverage.formNumber,
      coverage.originalContent,
      coverage.resolvedOriginalContent,
    ].join(" "),
  );
}

function policyText(policy: Doc<"policies">) {
  return normalizeText(
    [
      policy.summary,
      policy.carrier,
      policy.security,
      policy.mga,
      policy.broker,
      policy.insuredName,
      policy.formInventory,
      policy.operationalProfile,
      ...(policy.coverages ?? []),
    ].join(" "),
  );
}

function policyHasRequiredForm(policy: Doc<"policies">, form: string) {
  const needle = normalizeText(form);
  if (!needle) return true;
  return policyText(policy).includes(needle);
}

function policyHasProvision(
  policy: Doc<"policies">,
  provision: RequirementProvision,
) {
  const text = policyText(policy);
  switch (provision) {
    case "additional_insured":
      return /\badditional insured\b/.test(text);
    case "waiver_of_subrogation":
      return /\bwaiver of subrogation\b|\bsubrogation waived\b|\bwos\b/.test(
        text,
      );
    case "primary_non_contributory":
      return /\bprimary\b/.test(text) && /\bnon contributory\b/.test(text);
  }
}

function coverageAmountForKind(
  coverage: NonNullable<Doc<"policies">["coverages"]>[number],
  requiredKind: RequirementLimitKind,
) {
  const candidates: Array<{
    kind?: RequirementLimitKind;
    amount?: number;
    label?: string;
  }> = [];
  if (coverage.limitAmount !== undefined) {
    candidates.push({
      kind: normalizeLimitKind(coverage.limitType ?? coverage.limit),
      amount: coverage.limitAmount,
      label: coverage.limit,
    });
  }
  for (const limit of coverage.limits ?? []) {
    candidates.push({
      kind: normalizeLimitKind(limit.kind ?? limit.label ?? limit.appliesTo),
      amount: limit.amount,
      label: [limit.label, limit.value].filter(Boolean).join(": "),
    });
  }

  const exact = candidates.find(
    (candidate) =>
      candidate.kind === requiredKind && typeof candidate.amount === "number",
  );
  if (exact) return exact;
  if (
    (requiredKind === "aggregate" || requiredKind === "general_aggregate") &&
    candidates.length === 1 &&
    candidates[0]?.amount !== undefined
  ) {
    return candidates[0];
  }
  if (
    requiredKind === "other" &&
    candidates.length === 1 &&
    candidates[0]?.amount !== undefined
  ) {
    return candidates[0];
  }
  return undefined;
}

function bestCoverageForRequirement(
  policy: Doc<"policies">,
  requirement: Doc<"insuranceRequirements">,
) {
  const required = requirement.lineOfBusiness;
  const requiredText = normalizeText(
    [required, required ? lobLabel(required) : undefined].join(" "),
  );
  let best:
    | NonNullable<Doc<"policies">["coverages"]>[number]
    | undefined;
  for (const coverage of policy.coverages ?? []) {
    const text = coverageText(coverage);
    const matches =
      !requiredText ||
      text.includes(requiredText) ||
      (coverage.lineOfBusiness &&
        normalizeText(coverage.lineOfBusiness) === normalizeText(required));
    if (!matches) continue;
    if (!best) {
      best = coverage;
      continue;
    }
    const bestAmount = best.limitAmount ?? 0;
    const amount = coverage.limitAmount ?? 0;
    if (amount > bestAmount) best = coverage;
  }
  return best ?? policy.coverages?.[0];
}

function matchedPolicySummary(args: {
  policy: Doc<"policies">;
  coverage?: NonNullable<Doc<"policies">["coverages"]>[number];
  amount?: number;
  expectedInsuredName?: string;
}) {
  const dataStage = policyDataStage(args.policy);
  return {
    _id: args.policy._id,
    carrier: args.policy.mga || args.policy.carrier || args.policy.security,
    policyNumber: args.policy.policyNumber,
    insuredName: args.policy.insuredName,
    expectedInsuredName: args.expectedInsuredName,
    expirationDate: args.policy.expirationDate,
    dataStage,
    provisional: dataStage === "preview",
    coverageName: args.coverage?.name,
    coverageLimit: args.coverage?.limit,
    detectedLimitAmount: args.amount ?? args.coverage?.limitAmount,
  };
}

function sentenceForReason(reason: string) {
  if (reason === "no_matching_policy") return "No matching policy found.";
  if (reason === "insured_name_mismatch") return "Named insured does not match.";
  if (reason === "deductible_above_required") {
    return "Deductible is above the required maximum.";
  }
  if (reason === "limit_unverifiable") {
    return "Structured limits do not show the required amount.";
  }
  if (reason.startsWith("limit_unverifiable:")) {
    const kind = reason.split(":")[1] as RequirementLimitKind;
    return `${REQUIREMENT_LIMIT_KIND_LABELS[kind] ?? kind} limit is not structured on the matched policy.`;
  }
  if (reason.startsWith("limit_below_required:")) {
    const kind = reason.split(":")[1] as RequirementLimitKind;
    return `${REQUIREMENT_LIMIT_KIND_LABELS[kind] ?? kind} limit is below the requirement.`;
  }
  if (reason.startsWith("provision_missing:")) {
    const provision = reason.split(":")[1] as RequirementProvision;
    return `${REQUIREMENT_PROVISION_LABELS[provision] ?? provision} not confirmed.`;
  }
  if (reason.startsWith("required_form_missing:")) {
    return `Required form ${reason.split(":").slice(1).join(":")} not confirmed.`;
  }
  return reason.replace(/_/g, " ");
}

export function formatComplianceReasons(reasons: readonly string[]) {
  return reasons.map(sentenceForReason).join(" ");
}

function manualCheckIsCurrent(
  requirement: Doc<"insuranceRequirements">,
  check: ManualCheck | undefined,
  now: number,
) {
  if (!check || check.checkedBy !== "user") return false;
  if (check.checkedAt < requirement.updatedAt) return false;
  const validUntil = check.evidence?.validUntil;
  if (!validUntil) return true;
  const expires = parseDate(validUntil);
  return Number.isFinite(expires) ? expires >= now : true;
}

export function latestManualCheck(
  requirement: Doc<"insuranceRequirements">,
  checks: ManualCheck[],
  now = dayjs().valueOf(),
) {
  return checks
    .filter((check) => manualCheckIsCurrent(requirement, check, now))
    .sort((a, b) => b.checkedAt - a.checkedAt)[0];
}

export function assessRequirementCompliance(
  requirement: Doc<"insuranceRequirements">,
  policies: Doc<"policies">[],
  options?: {
    now?: number;
    expectedInsuredName?: string;
    expectedInsuredNames?: string[];
    includePreviewPolicies?: boolean;
    existingChecks?: ManualCheck[];
  },
): ComplianceCheckResult {
  const now = options?.now ?? dayjs().valueOf();
  const manual = latestManualCheck(requirement, options?.existingChecks ?? [], now);
  if (manual) {
    return {
      requirementId: requirement._id,
      status: manual.status,
      reasons: manual.reasons ?? [],
      matchedPolicyIds: manual.matchedPolicyIds,
      matchedSummary: manual.matchedSummary,
      expiresAt: manual.expiresAt,
      checkedAt: manual.checkedAt,
      checkedBy: manual.checkedBy,
      evidence: manual.evidence,
    };
  }

  if (requirement.kind !== "coverage") {
    return {
      requirementId: requirement._id,
      status: "unverified",
      reasons: ["manual_verification_required"],
      matchedPolicyIds: [],
      matchedSummary: "Manual verification required.",
      checkedAt: now,
      checkedBy: "system",
    };
  }

  const includePreviewPolicies = options?.includePreviewPolicies !== false;
  const insuredNames = options?.expectedInsuredNames?.length
    ? options.expectedInsuredNames
    : options?.expectedInsuredName
      ? [options.expectedInsuredName]
      : [];
  const candidates = policies
    .filter((policy) => policyReadableForCompliance(policy, includePreviewPolicies))
    .filter((policy) => coverageLobMatches(requirement, policy))
    .map((policy) => ({
      policy,
      coverage: bestCoverageForRequirement(policy, requirement),
      expiration: parseDate(policy.expirationDate),
    }))
    .sort(
      (a, b) =>
        (Number.isFinite(b.expiration) ? b.expiration : 0) -
        (Number.isFinite(a.expiration) ? a.expiration : 0),
    );

  if (candidates.length === 0) {
    return {
      requirementId: requirement._id,
      status: "not_met",
      reasons: ["no_matching_policy"],
      matchedPolicyIds: [],
      matchedSummary: "No active policy appears to match this coverage requirement.",
      checkedAt: now,
      checkedBy: "system",
    };
  }

  const active =
    candidates.find(
      ({ expiration }) => Number.isFinite(expiration) && expiration >= now,
    ) ?? candidates[0]!;
  const reasons: string[] = [];
  let bestDetectedAmount: number | undefined;
  for (const required of requirement.limits ?? []) {
    const requiredKind = isRequirementLimitKind(required.kind)
      ? required.kind
      : "other";
    const matched = active.coverage
      ? coverageAmountForKind(active.coverage, requiredKind)
      : undefined;
    if (!matched || matched.amount === undefined) {
      reasons.push(`limit_unverifiable:${requiredKind}`);
      continue;
    }
    bestDetectedAmount =
      bestDetectedAmount === undefined
        ? matched.amount
        : Math.max(bestDetectedAmount, matched.amount);
    if (matched.amount < required.amount) {
      reasons.push(`limit_below_required:${requiredKind}`);
    }
  }
  if (
    active.coverage &&
    requirement.maxDeductible?.amount !== undefined &&
    active.coverage.deductibleAmount !== undefined &&
    active.coverage.deductibleAmount > requirement.maxDeductible.amount
  ) {
    reasons.push("deductible_above_required");
  }
  for (const rawProvision of requirement.provisions ?? []) {
    if (!isRequirementProvision(rawProvision)) continue;
    if (!policyHasProvision(active.policy, rawProvision)) {
      reasons.push(`provision_missing:${rawProvision}`);
    }
  }
  for (const form of requirement.requiredForms ?? []) {
    if (!policyHasRequiredForm(active.policy, form)) {
      reasons.push(`required_form_missing:${form}`);
    }
  }
  if (
    active.expiration >= now &&
    !insuredNames.some((name) => insuredNameMatches(active.policy.insuredName, name))
  ) {
    reasons.push("insured_name_mismatch");
  }

  const daysUntilExpiration = Number.isFinite(active.expiration)
    ? Math.ceil((active.expiration - now) / (24 * 60 * 60 * 1000))
    : undefined;
  const status: ComplianceCheckStatus =
    active.expiration < now
      ? "expired"
      : reasons.length > 0
        ? "not_met"
        : daysUntilExpiration !== undefined && daysUntilExpiration <= 30
          ? "expiring_soon"
          : "met";
  const matchedPolicy = matchedPolicySummary({
    policy: active.policy,
    coverage: active.coverage,
    amount: bestDetectedAmount,
    expectedInsuredName: insuredNames[0],
  });
  const matchedSummary =
    status === "met"
      ? `Matched ${matchedPolicy.carrier ?? "policy"} ${matchedPolicy.policyNumber ?? ""}`.trim()
      : formatComplianceReasons(reasons.length > 0 ? reasons : ["policy_expired"]);

  return {
    requirementId: requirement._id,
    status,
    reasons: status === "expired" && reasons.length === 0 ? ["policy_expired"] : reasons,
    matchedPolicyIds: [active.policy._id],
    matchedPolicy,
    matchedSummary,
    expiresAt: Number.isFinite(active.expiration)
      ? active.policy.expirationDate
      : undefined,
    daysUntilExpiration,
    checkedAt: now,
    checkedBy: "system",
  };
}
