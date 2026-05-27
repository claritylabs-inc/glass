export type DeclarationFactInput = {
  orgId: string;
  policyId: string;
  policyFileId?: string;
  fieldPath: string;
  fieldGroup: string;
  displayValue: string;
  normalizedValue: string;
  valueKind: "string" | "number" | "date" | "money" | "address" | "list" | "unknown";
  sourceSpanIds?: string[];
  effectiveDate?: string;
  expirationDate?: string;
};

export type DeclarationDiscrepancyInput = {
  fieldGroup: string;
  likelyCurrentValue?: string;
  conflictingValues: Array<{
    normalizedValue: string;
    displayValue: string;
    policyIds: string[];
    newestObservedAt: number;
  }>;
  affectedPolicyIds: string[];
  severity: "info" | "warning" | "critical";
};

const ACTIONABLE_FIELD_GROUPS = new Set([
  "insured_identity",
  "policy_number",
  "carrier",
  "insurer",
  "dba",
  "entity_type",
  "fein",
  "mailing_address",
  "scheduled_location",
  "additional_named_insured",
]);

function isUserFacingDiscrepancyGroup(fieldGroup: string): boolean {
  return !(
    fieldGroup.startsWith("coverage_limit:") ||
    fieldGroup.startsWith("coverage_deductible:")
  );
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function normalizeDeclarationValue(value: unknown, valueKind: DeclarationFactInput["valueKind"] = "string"): string {
  if (value === null || value === undefined) return "";
  const raw = Array.isArray(value) ? value.join(" ") : String(value);
  const normalized = raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(incorporated|inc)\b/g, "inc")
    .replace(/\b(limited liability company|llc)\b/g, "llc")
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (valueKind === "money" || valueKind === "number") {
    return normalized.replace(/[^0-9.-]/g, "");
  }
  return normalized;
}

function pushFact(
  facts: DeclarationFactInput[],
  params: Omit<DeclarationFactInput, "normalizedValue"> & { rawValue?: unknown },
) {
  const displayValue = params.displayValue.trim();
  if (!displayValue) return;
  const normalizedValue = normalizeDeclarationValue(params.rawValue ?? displayValue, params.valueKind);
  if (!normalizedValue) return;
  facts.push({
    ...params,
    displayValue,
    normalizedValue,
  });
}

function arrayRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];
}

export function extractDeclarationFactsFromPolicy(policy: Record<string, unknown>): DeclarationFactInput[] {
  const orgId = String(policy.orgId ?? "");
  const policyId = String(policy._id ?? "");
  if (!orgId || !policyId) return [];

  const effectiveDate = typeof policy.effectiveDate === "string" ? policy.effectiveDate : undefined;
  const expirationDate = typeof policy.expirationDate === "string" ? policy.expirationDate : undefined;
  const facts: DeclarationFactInput[] = [];
  const base = { orgId, policyId, effectiveDate, expirationDate };

  pushFact(facts, {
    ...base,
    fieldPath: "insuredName",
    fieldGroup: "insured_identity",
    displayValue: typeof policy.insuredName === "string" ? policy.insuredName : "",
    valueKind: "string",
  });
  pushFact(facts, {
    ...base,
    fieldPath: "policyNumber",
    fieldGroup: "policy_number",
    displayValue: typeof policy.policyNumber === "string" ? policy.policyNumber : "",
    valueKind: "string",
  });
  pushFact(facts, {
    ...base,
    fieldPath: "carrier",
    fieldGroup: "carrier",
    displayValue: typeof policy.carrier === "string" ? policy.carrier : "",
    valueKind: "string",
  });
  pushFact(facts, {
    ...base,
    fieldPath: "security",
    fieldGroup: "insurer",
    displayValue: typeof policy.security === "string" ? policy.security : "",
    valueKind: "string",
  });
  pushFact(facts, {
    ...base,
    fieldPath: "broker",
    fieldGroup: "producer",
    displayValue: typeof policy.broker === "string" ? policy.broker : "",
    valueKind: "string",
  });

  const declarations = policy.declarations && typeof policy.declarations === "object"
    ? policy.declarations as Record<string, unknown>
    : {};
  for (const [path, group, kind] of [
    ["dba", "dba", "string"],
    ["doingBusinessAs", "dba", "string"],
    ["entityType", "entity_type", "string"],
    ["fein", "fein", "string"],
    ["mailingAddress", "mailing_address", "address"],
    ["address", "mailing_address", "address"],
  ] as const) {
    const value = declarations[path];
    if (typeof value === "string") {
      pushFact(facts, {
        ...base,
        fieldPath: `declarations.${path}`,
        fieldGroup: group,
        displayValue: value,
        valueKind: kind,
      });
    }
  }

  for (const [index, location] of arrayRecords(declarations.locations).entries()) {
    const display = [location.name, location.address, location.city, location.state, location.zip]
      .filter((item) => typeof item === "string" && item.trim())
      .join(", ");
    pushFact(facts, {
      ...base,
      fieldPath: `declarations.locations.${index}`,
      fieldGroup: "scheduled_location",
      displayValue: display,
      valueKind: "address",
    });
  }

  for (const [index, insured] of arrayRecords(declarations.additionalNamedInsureds).entries()) {
    const name = typeof insured.name === "string" ? insured.name : String(insured.value ?? "");
    pushFact(facts, {
      ...base,
      fieldPath: `declarations.additionalNamedInsureds.${index}`,
      fieldGroup: "additional_named_insured",
      displayValue: name,
      valueKind: "string",
    });
  }

  const coverages = arrayRecords(policy.coverages);
  for (const [index, coverage] of coverages.entries()) {
    const name = typeof coverage.name === "string" ? coverage.name : undefined;
    if (!name) continue;
    pushFact(facts, {
      ...base,
      fieldPath: `coverages.${index}.limit`,
      fieldGroup: `coverage_limit:${normalizeDeclarationValue(name)}`,
      displayValue: [name, coverage.limit].filter(Boolean).join(": "),
      rawValue: coverage.limitAmount ?? coverage.limit,
      valueKind: coverage.limitAmount !== undefined ? "number" : "string",
      sourceSpanIds: Array.isArray(coverage.sourceSpanIds) ? coverage.sourceSpanIds.filter((item) => typeof item === "string") : undefined,
    });
    if (coverage.deductible || coverage.deductibleAmount !== undefined) {
      pushFact(facts, {
        ...base,
        fieldPath: `coverages.${index}.deductible`,
        fieldGroup: `coverage_deductible:${normalizeDeclarationValue(name)}`,
        displayValue: [name, coverage.deductible].filter(Boolean).join(": "),
        rawValue: coverage.deductibleAmount ?? coverage.deductible,
        valueKind: coverage.deductibleAmount !== undefined ? "number" : "string",
        sourceSpanIds: Array.isArray(coverage.sourceSpanIds) ? coverage.sourceSpanIds.filter((item) => typeof item === "string") : undefined,
      });
    }
  }

  return facts.map((fact) => ({
    ...fact,
    recordHash: declarationFactHash(fact),
  } as DeclarationFactInput & { recordHash: string }));
}

export function declarationFactHash(fact: Pick<DeclarationFactInput, "policyId" | "fieldPath" | "normalizedValue">): string {
  return stableHash([fact.policyId, fact.fieldPath, fact.normalizedValue].join("|"));
}

export function findDeclarationDiscrepancies(
  facts: Array<DeclarationFactInput & { policyId: string; observedAt?: number }>,
): DeclarationDiscrepancyInput[] {
  const byGroup = new Map<string, typeof facts>();
  for (const fact of facts) {
    if (!fact.normalizedValue) continue;
    const rows = byGroup.get(fact.fieldGroup) ?? [];
    rows.push(fact);
    byGroup.set(fact.fieldGroup, rows);
  }

  const discrepancies: DeclarationDiscrepancyInput[] = [];
  for (const [fieldGroup, rows] of byGroup) {
    if (!isUserFacingDiscrepancyGroup(fieldGroup)) continue;
    const values = new Map<string, { displayValue: string; policyIds: Set<string>; newestObservedAt: number }>();
    for (const row of rows) {
      const current = values.get(row.normalizedValue) ?? {
        displayValue: row.displayValue,
        policyIds: new Set<string>(),
        newestObservedAt: 0,
      };
      current.policyIds.add(row.policyId);
      current.newestObservedAt = Math.max(current.newestObservedAt, row.observedAt ?? 0);
      values.set(row.normalizedValue, current);
    }
    if (values.size <= 1) continue;

    const conflictingValues = Array.from(values.entries()).map(([normalizedValue, value]) => ({
      normalizedValue,
      displayValue: value.displayValue,
      policyIds: Array.from(value.policyIds),
      newestObservedAt: value.newestObservedAt,
    }));
    conflictingValues.sort((a, b) => b.newestObservedAt - a.newestObservedAt);
    const affectedPolicyIds = Array.from(new Set(conflictingValues.flatMap((value) => value.policyIds)));
    if (affectedPolicyIds.length <= 1) continue;
    discrepancies.push({
      fieldGroup,
      likelyCurrentValue: conflictingValues[0]?.displayValue,
      conflictingValues,
      affectedPolicyIds,
      severity: ACTIONABLE_FIELD_GROUPS.has(fieldGroup) ? "warning" : "info",
    });
  }
  return discrepancies;
}

export function shouldNotifyForDeclarationDiscrepancy(discrepancy: Pick<DeclarationDiscrepancyInput, "fieldGroup" | "severity">): boolean {
  return ACTIONABLE_FIELD_GROUPS.has(discrepancy.fieldGroup) && discrepancy.severity !== "info";
}
