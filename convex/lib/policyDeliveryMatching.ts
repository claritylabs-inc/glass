import {
  ACORD_LOB_LABELS,
  LEGACY_POLICY_TYPE_TO_LOB,
  policyLobCodes,
} from "./linesOfBusiness";

type PolicyDeliveryFilters = {
  carriers?: string[];
  securities?: string[];
  underwriters?: string[];
  linesOfBusiness?: string[];
};

type PolicyDeliveryRuleLike = {
  filters: PolicyDeliveryFilters;
};

type PolicyLike = {
  carrier?: string;
  carrierLegalName?: string;
  security?: string;
  insurer?: { legalName?: string };
  underwriter?: string;
  linesOfBusiness?: string[];
  coverages?: Array<{ name?: string }>;
  programName?: string;
  summary?: string;
};

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function lower(value: unknown) {
  return clean(value)?.toLowerCase() ?? "";
}

function includesAny(haystacks: string[], needles: string[] | undefined) {
  const normalizedNeedles = (needles ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (normalizedNeedles.length === 0) return true;
  return normalizedNeedles.some((needle) =>
    haystacks.some((haystack) => haystack.includes(needle)),
  );
}

export function lineOfBusinessNeedles(rule: PolicyDeliveryRuleLike) {
  const filters = rule.filters ?? {};
  return filters.linesOfBusiness;
}

function legacyNeedlesForPolicyLobs(codes: string[]) {
  return Object.entries(LEGACY_POLICY_TYPE_TO_LOB)
    .filter(([, mappedCodes]) =>
      mappedCodes.some((code) => codes.includes(code)) &&
      !mappedCodes.includes("OLIB") &&
      !mappedCodes.includes("UN"),
    )
    .map(([legacyKey]) => legacyKey);
}

export function policyLineHaystacks(policy: PolicyLike) {
  const codes = policyLobCodes(policy);
  const labels = codes.map((code) => ACORD_LOB_LABELS[code]);
  const legacyKeys = legacyNeedlesForPolicyLobs(codes);
  return [
    ...codes,
    ...labels,
    ...legacyKeys,
    ...(policy.coverages ?? []).map((coverage) => lower(coverage.name)),
    lower(policy.programName),
    lower(policy.summary),
  ].map((value) => value.toLowerCase());
}

export function deterministicRuleMatch(rule: PolicyDeliveryRuleLike, policy: PolicyLike) {
  return (
    includesAny([lower(policy.carrier), lower(policy.carrierLegalName)], rule.filters.carriers) &&
    includesAny([lower(policy.security), lower(policy.insurer?.legalName)], rule.filters.securities) &&
    includesAny([lower(policy.underwriter)], rule.filters.underwriters) &&
    includesAny(policyLineHaystacks(policy), lineOfBusinessNeedles(rule))
  );
}
