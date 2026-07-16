export type DeclarationFactInput = {
  orgId: string;
  policyId: string;
  policyFileId?: string;
  fieldPath: string;
  fieldGroup: string;
  displayValue: string;
  normalizedValue: string;
  structuredValue?: unknown;
  valueKind: "string" | "number" | "date" | "money" | "address" | "list" | "unknown";
  sourceNodeIds?: string[];
  sourceSpanIds?: string[];
  effectiveDate?: string;
  expirationDate?: string;
  policyYear?: number;
};

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
  const rawValue =
    params.rawValue !== undefined &&
    (params.rawValue === null || typeof params.rawValue !== "object")
      ? params.rawValue
      : displayValue;
  const normalizedValue = normalizeDeclarationValue(rawValue, params.valueKind);
  if (!normalizedValue) return;
  facts.push({
    ...params,
    displayValue,
    normalizedValue,
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function arrayRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];
}

function addressDisplay(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const address = value as Record<string, unknown>;
  const cityStateZip = [
    stringValue(address.city),
    [
      stringValue(address.state),
      stringValue(address.zip) ?? stringValue(address.postalCode) ?? stringValue(address.postcode),
    ]
      .filter(Boolean)
      .join(" "),
  ].filter(Boolean).join(", ");
  return [
    stringValue(address.street1) ?? stringValue(address.line1) ?? stringValue(address.addressLine1),
    stringValue(address.street2) ?? stringValue(address.line2) ?? stringValue(address.addressLine2),
    cityStateZip,
    stringValue(address.country),
  ].filter(Boolean).join(", ") || stringValue(address.formatted) || "";
}

function sourceSpanIdsFromValue(value: unknown): string[] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const sourceSpanIds = (value as Record<string, unknown>).sourceSpanIds;
  if (!Array.isArray(sourceSpanIds)) return undefined;
  const ids = sourceSpanIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return ids.length > 0 ? ids : undefined;
}

function sourceNodeIdsFromValue(value: unknown): string[] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const sourceNodeIds = (value as Record<string, unknown>).sourceNodeIds;
  if (!Array.isArray(sourceNodeIds)) return undefined;
  const ids = sourceNodeIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return ids.length > 0 ? ids : undefined;
}

function displayValueFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return Object.values(value as Record<string, unknown>)
    .filter((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
    .map(String)
    .join(", ");
}

const LEGAL_ENTITY_ADDRESS_SUFFIX =
  /^(.+?\b(?:incorporated|inc\.?|corporation|corp\.?|limited|ltd\.?|company|co\.?|llc|l\.l\.c\.?|llp|l\.l\.p\.?|lp|l\.p\.?))(?=\s+\d{1,6}(?:-\d{1,6})?\s+\p{L})/iu;

function insuredIdentityDisplay(value: unknown): string {
  const displayValue = displayValueFromUnknown(value).trim();
  return displayValue.match(LEGAL_ENTITY_ADDRESS_SUFFIX)?.[1]?.trim() ?? displayValue;
}

function operationalFactValueKind(value: unknown): DeclarationFactInput["valueKind"] {
  return value === "string" ||
    value === "number" ||
    value === "date" ||
    value === "money" ||
    value === "address" ||
    value === "list" ||
    value === "unknown"
    ? value
    : "string";
}

const OPERATIONAL_FACT_GROUPS: Record<string, {
  fieldGroup: string;
  valueKind: DeclarationFactInput["valueKind"];
}> = {
  namedInsured: { fieldGroup: "insured_identity", valueKind: "string" },
  mailingAddress: { fieldGroup: "mailing_address", valueKind: "address" },
  dba: { fieldGroup: "dba", valueKind: "string" },
  entityType: { fieldGroup: "entity_type", valueKind: "string" },
  taxId: { fieldGroup: "fein", valueKind: "string" },
  businessNumber: { fieldGroup: "business_number", valueKind: "string" },
  additionalNamedInsured: { fieldGroup: "additional_named_insured", valueKind: "string" },
  operationsDescription: { fieldGroup: "operations_description", valueKind: "string" },
  policyNumber: { fieldGroup: "policy_number", valueKind: "string" },
  insurer: { fieldGroup: "insurer", valueKind: "string" },
  broker: { fieldGroup: "producer", valueKind: "string" },
  effectiveDate: { fieldGroup: "effective_date", valueKind: "date" },
  expirationDate: { fieldGroup: "expiration_date", valueKind: "date" },
  premium: { fieldGroup: "premium", valueKind: "money" },
  other: { fieldGroup: "declaration_other", valueKind: "string" },
};

function pushOperationalProfileDeclarationFacts(
  facts: DeclarationFactInput[],
  base: Pick<DeclarationFactInput, "orgId" | "policyId" | "effectiveDate" | "expirationDate" | "policyYear">,
  policy: Record<string, unknown>,
) {
  const profile = policy.operationalProfile && typeof policy.operationalProfile === "object"
    ? policy.operationalProfile as Record<string, unknown>
    : {};
  const operationsDescription = profile.operationsDescription;
  if (operationsDescription && typeof operationsDescription === "object" && !Array.isArray(operationsDescription)) {
    const sourceBacked = operationsDescription as Record<string, unknown>;
    const sourceNodeIds = sourceNodeIdsFromValue(sourceBacked);
    const sourceSpanIds = sourceSpanIdsFromValue(sourceBacked);
    if (sourceNodeIds || sourceSpanIds) {
      pushFact(facts, {
        ...base,
        fieldPath: "operationalProfile.operationsDescription",
        fieldGroup: "operations_description",
        displayValue: displayValueFromUnknown(sourceBacked.value),
        rawValue: sourceBacked.normalizedValue ?? sourceBacked.value,
        valueKind: "string",
        sourceNodeIds,
        sourceSpanIds,
      });
    }
  }
  for (const [index, fact] of arrayRecords(profile.declarationFacts).entries()) {
    const field = typeof fact.field === "string" ? fact.field : "other";
    const mapping = OPERATIONAL_FACT_GROUPS[field] ?? OPERATIONAL_FACT_GROUPS.other;
    const valueKind = operationalFactValueKind(fact.valueKind ?? mapping.valueKind);
    const structuredValue = field === "mailingAddress" && fact.address && typeof fact.address === "object"
      ? fact.address
      : undefined;
    const displayValue = field === "mailingAddress"
      ? addressDisplay(structuredValue ?? fact.value)
      : field === "namedInsured"
        ? insuredIdentityDisplay(fact.value)
        : displayValueFromUnknown(fact.value);
    pushFact(facts, {
      ...base,
      fieldPath: `operationalProfile.declarationFacts.${index}`,
      fieldGroup: mapping.fieldGroup,
      displayValue,
      rawValue: field === "namedInsured"
        ? displayValue
        : typeof fact.normalizedValue === "string"
          ? fact.normalizedValue
          : fact.value,
      structuredValue,
      valueKind,
      sourceNodeIds: sourceNodeIdsFromValue(fact),
      sourceSpanIds: sourceSpanIdsFromValue(fact),
    });
  }
}

function dedupeFacts(facts: DeclarationFactInput[]) {
  const byValue = new Map<string, DeclarationFactInput>();
  for (const fact of facts) {
    const key = `${fact.fieldGroup}|${fact.normalizedValue}`;
    const existing = byValue.get(key);
    if (!existing) {
      byValue.set(key, fact);
      continue;
    }
    const existingSourceCount = (existing.sourceNodeIds?.length ?? 0) + (existing.sourceSpanIds?.length ?? 0);
    const sourceCount = (fact.sourceNodeIds?.length ?? 0) + (fact.sourceSpanIds?.length ?? 0);
    if (
      sourceCount > existingSourceCount ||
      (!existing.structuredValue && fact.structuredValue)
    ) {
      byValue.set(key, fact);
    }
  }
  return Array.from(byValue.values());
}

export function extractDeclarationFactsFromPolicy(policy: Record<string, unknown>): DeclarationFactInput[] {
  const orgId = String(policy.orgId ?? "");
  const policyId = String(policy._id ?? "");
  if (!orgId || !policyId) return [];

  const effectiveDate = typeof policy.effectiveDate === "string" ? policy.effectiveDate : undefined;
  const expirationDate = typeof policy.expirationDate === "string" ? policy.expirationDate : undefined;
  const policyYear = typeof policy.policyYear === "number" && Number.isFinite(policy.policyYear)
    ? policy.policyYear
    : undefined;
  const facts: DeclarationFactInput[] = [];
  const base = { orgId, policyId, effectiveDate, expirationDate, policyYear };

  pushOperationalProfileDeclarationFacts(facts, base, policy);

  pushFact(facts, {
    ...base,
    fieldPath: "insuredName",
    fieldGroup: "insured_identity",
    displayValue: insuredIdentityDisplay(policy.insuredName),
    valueKind: "string",
  });
  pushFact(facts, {
    ...base,
    fieldPath: "insuredDba",
    fieldGroup: "dba",
    displayValue: typeof policy.insuredDba === "string" ? policy.insuredDba : "",
    valueKind: "string",
  });
  pushFact(facts, {
    ...base,
    fieldPath: "insuredEntityType",
    fieldGroup: "entity_type",
    displayValue: typeof policy.insuredEntityType === "string" ? policy.insuredEntityType : "",
    valueKind: "string",
  });
  pushFact(facts, {
    ...base,
    fieldPath: "insuredFein",
    fieldGroup: "fein",
    displayValue: typeof policy.insuredFein === "string" ? policy.insuredFein : "",
    valueKind: "string",
  });
  const insuredAddressDisplay = addressDisplay(policy.insuredAddress);
  pushFact(facts, {
    ...base,
    fieldPath: "insuredAddress",
    fieldGroup: "mailing_address",
    displayValue: insuredAddressDisplay,
    rawValue: policy.insuredAddress ?? insuredAddressDisplay,
    structuredValue: policy.insuredAddress,
    valueKind: "address",
    sourceNodeIds: sourceNodeIdsFromValue(policy.insuredAddress),
    sourceSpanIds: sourceSpanIdsFromValue(policy.insuredAddress),
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
  for (const [index, fact] of arrayRecords(declarations.fields).entries()) {
    const field = stringValue(fact.field)?.replace(/[\s_-]+/g, "").toLowerCase();
    if (!field || !["operationsdescription", "descriptionofoperations", "businessdescription"].includes(field)) {
      continue;
    }
    const sourceNodeIds = sourceNodeIdsFromValue(fact);
    const sourceSpanIds = sourceSpanIdsFromValue(fact);
    if (!sourceNodeIds && !sourceSpanIds) continue;
    pushFact(facts, {
      ...base,
      fieldPath: `declarations.fields.${index}`,
      fieldGroup: "operations_description",
      displayValue: displayValueFromUnknown(fact.value),
      rawValue: fact.normalizedValue ?? fact.value,
      valueKind: "string",
      sourceNodeIds,
      sourceSpanIds,
    });
  }
  for (const [path, group, kind] of [
    ["dba", "dba", "string"],
    ["doingBusinessAs", "dba", "string"],
    ["entityType", "entity_type", "string"],
    ["fein", "fein", "string"],
    ["taxId", "fein", "string"],
    ["businessNumber", "business_number", "string"],
    ["craBusinessNumber", "business_number", "string"],
    ["bn", "business_number", "string"],
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

  for (const [index, insured] of arrayRecords(policy.additionalNamedInsureds).entries()) {
    const name = typeof insured.name === "string" ? insured.name : String(insured.value ?? "");
    pushFact(facts, {
      ...base,
      fieldPath: `additionalNamedInsureds.${index}`,
      fieldGroup: "additional_named_insured",
      displayValue: name,
      valueKind: "string",
      sourceSpanIds: sourceSpanIdsFromValue(insured),
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

  return dedupeFacts(facts).map((fact) => ({
    ...fact,
    recordHash: declarationFactHash(fact),
  } as DeclarationFactInput & { recordHash: string }));
}

export function declarationFactHash(fact: Pick<DeclarationFactInput, "policyId" | "fieldPath" | "normalizedValue">): string {
  return stableHash([fact.policyId, fact.fieldPath, fact.normalizedValue].join("|"));
}
