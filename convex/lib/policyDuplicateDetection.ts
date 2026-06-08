import dayjs from "dayjs";

export type PolicyDuplicateCandidate = {
  _id?: unknown;
  policyId?: unknown;
  policyNumber?: string | null;
  carrier?: string | null;
  insuredName?: string | null;
  effectiveDate?: string | null;
  expirationDate?: string | null;
  policyTypes?: unknown;
};

export type PolicyDuplicateMatch = {
  isMatch: boolean;
  score: number;
};

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePolicyTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function sameKnownValue(a: unknown, b: unknown): boolean {
  const left = normalizeText(a);
  return left !== "" && left === normalizeText(b);
}

function parsedDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
}

function policyPeriodsOverlap(a: PolicyDuplicateCandidate, b: PolicyDuplicateCandidate): boolean {
  const startA = parsedDate(a.effectiveDate);
  const endA = parsedDate(a.expirationDate);
  const startB = parsedDate(b.effectiveDate);
  const endB = parsedDate(b.expirationDate);
  if (!startA || !endA || !startB || !endB) return false;
  return !startA.isAfter(endB) && !startB.isAfter(endA);
}

function samePolicyTerm(a: PolicyDuplicateCandidate, b: PolicyDuplicateCandidate): boolean {
  const startA = parsedDate(a.effectiveDate);
  const endA = parsedDate(a.expirationDate);
  const startB = parsedDate(b.effectiveDate);
  const endB = parsedDate(b.expirationDate);
  if (!startA || !endA || !startB || !endB) return false;
  return startA.isSame(startB, "day") && endA.isSame(endB, "day");
}

function hasPolicyTypeOverlap(a: PolicyDuplicateCandidate, b: PolicyDuplicateCandidate): boolean {
  const left = new Set(normalizePolicyTypes(a.policyTypes));
  if (left.size === 0) return false;
  return normalizePolicyTypes(b.policyTypes).some((type) => left.has(type));
}

export function policyIdForDuplicateCheck(policy: PolicyDuplicateCandidate): string {
  return String(policy.policyId ?? policy._id ?? "");
}

export function compareDuplicatePolicies(
  a: PolicyDuplicateCandidate,
  b: PolicyDuplicateCandidate,
): PolicyDuplicateMatch {
  const sameNumber = sameKnownValue(a.policyNumber, b.policyNumber);
  const sameCarrier = sameKnownValue(a.carrier, b.carrier);
  const sameInsured = sameKnownValue(a.insuredName, b.insuredName);
  const sameTerm = samePolicyTerm(a, b);
  const termOverlap = policyPeriodsOverlap(a, b);
  const typeOverlap = hasPolicyTypeOverlap(a, b);

  if (!termOverlap) return { isMatch: false, score: 0 };

  if (sameNumber && sameInsured) {
    return { isMatch: true, score: sameCarrier ? 95 : typeOverlap ? 90 : 85 };
  }

  if (sameNumber && sameCarrier) {
    return { isMatch: true, score: sameInsured ? 95 : typeOverlap ? 85 : 80 };
  }

  if (sameInsured && sameCarrier && sameTerm && typeOverlap) {
    return { isMatch: true, score: 80 };
  }

  return { isMatch: false, score: 0 };
}

export function nearDuplicatePolicyIds(policies: PolicyDuplicateCandidate[]): Set<string> {
  const policyIds = new Set<string>();
  for (let leftIndex = 0; leftIndex < policies.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < policies.length; rightIndex += 1) {
      const left = policies[leftIndex];
      const right = policies[rightIndex];
      if (!compareDuplicatePolicies(left, right).isMatch) continue;
      const leftId = policyIdForDuplicateCheck(left);
      const rightId = policyIdForDuplicateCheck(right);
      if (leftId) policyIds.add(leftId);
      if (rightId) policyIds.add(rightId);
    }
  }
  return policyIds;
}
