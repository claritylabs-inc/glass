import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { normalizeDeclarationValue } from "./declarationFacts";
import { normalizeExtractedDate } from "./valueNormalization";

dayjs.extend(customParseFormat);

type DeclarationFactDoc = {
  _creationTime?: number;
  orgId: Id<"organizations">;
  policyId: Id<"policies">;
  fieldPath: string;
  fieldGroup: string;
  displayValue: string;
  normalizedValue: string;
  structuredValue?: unknown;
  valueKind: "string" | "number" | "date" | "money" | "address" | "list" | "unknown";
  sourceSpanIds?: string[];
  effectiveDate?: string;
  expirationDate?: string;
  policyYear?: number;
  observedAt: number;
  active: boolean;
};

type OrgMailingAddress = {
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  formatted?: string;
};

type RelatedLegalEntity = {
  legalName: string;
  relationship?: "current" | "fka" | "dba" | "subsidiary" | "parent" | "affiliate" | "other";
  incorporationNumber?: string;
  taxId?: string;
  jurisdiction?: string;
  notes?: string;
};

const PROFILE_FIELD_GROUPS = [
  "insured_identity",
  "mailing_address",
  "dba",
  "entity_type",
  "fein",
  "additional_named_insured",
] as const;

const DATE_FORMATS = [
  "MM/DD/YYYY",
  "M/D/YYYY",
  "YYYY-MM-DD",
  "YYYY/M/D",
];

const UNUSABLE_VALUES = new Set([
  "",
  "unknown",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "extracting...",
  "extracting",
  "-",
]);

function cleanText(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed && !UNUSABLE_VALUES.has(trimmed.toLowerCase()) ? trimmed : undefined;
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = cleanText(record[key]);
    if (value) return value;
  }
  return undefined;
}

function compactAddress(value: unknown, fallbackFormatted?: string): OrgMailingAddress | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const address: OrgMailingAddress = {
      street1: stringField(record, "street1", "line1", "addressLine1", "street"),
      street2: stringField(record, "street2", "line2", "addressLine2", "unit"),
      city: stringField(record, "city", "locality"),
      state: stringField(record, "state", "region"),
      zip: stringField(record, "zip", "postalCode", "postcode"),
      country: stringField(record, "country"),
      formatted: stringField(record, "formatted", "displayValue"),
    };
    const cityStateZip = [
      address.city,
      [address.state, address.zip].filter(Boolean).join(" "),
    ].filter(Boolean).join(", ");
    const formatted = [
      address.street1,
      address.street2,
      cityStateZip,
      address.country,
    ].filter(Boolean).join(", ");
    if (!address.formatted && formatted) address.formatted = formatted;
    const compact = Object.fromEntries(
      Object.entries(address).filter((entry): entry is [keyof OrgMailingAddress, string] =>
        typeof entry[1] === "string" && entry[1].trim().length > 0,
      ),
    ) as OrgMailingAddress;
    return Object.keys(compact).length > 0 ? compact : undefined;
  }

  const formatted = cleanText(fallbackFormatted);
  return formatted ? { formatted } : undefined;
}

function parsedDateMs(value: unknown): number | undefined {
  const normalized = normalizeExtractedDate(value);
  if (!normalized) return undefined;
  const parsed = dayjs(normalized, DATE_FORMATS, true);
  return parsed.isValid() ? parsed.valueOf() : undefined;
}

function policyYearMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const parsed = dayjs(`${Math.trunc(value)}-01-01`, "YYYY-MM-DD", true);
  return parsed.isValid() ? parsed.valueOf() : undefined;
}

function policyDateRank(fact: DeclarationFactDoc): number {
  return parsedDateMs(fact.effectiveDate)
    ?? parsedDateMs(fact.expirationDate)
    ?? policyYearMs(fact.policyYear)
    ?? 0;
}

function sourceQualityRank(fact: DeclarationFactDoc): number {
  return (fact.fieldPath.startsWith("operationalProfile.declarationFacts.") ? 2 : 0)
    + ((fact.sourceSpanIds?.length ?? 0) > 0 ? 1 : 0)
    + (fact.structuredValue ? 1 : 0);
}

function compareFactRecency(a: DeclarationFactDoc, b: DeclarationFactDoc): number {
  return policyDateRank(b) - policyDateRank(a)
    || sourceQualityRank(b) - sourceQualityRank(a)
    || b.observedAt - a.observedAt
    || (b._creationTime ?? 0) - (a._creationTime ?? 0)
    || String(b.policyId).localeCompare(String(a.policyId));
}

function usableFact(fact: DeclarationFactDoc): boolean {
  return Boolean(cleanText(fact.displayValue) && cleanText(fact.normalizedValue));
}

function newestFact(facts: DeclarationFactDoc[], group: string): DeclarationFactDoc | undefined {
  return facts
    .filter((fact) => fact.fieldGroup === group && usableFact(fact))
    .sort(compareFactRecency)[0];
}

function newestFactSet(facts: DeclarationFactDoc[], group: string): DeclarationFactDoc[] {
  const sorted = facts
    .filter((fact) => fact.fieldGroup === group && usableFact(fact))
    .sort(compareFactRecency);
  const newest = sorted[0];
  if (!newest) return [];
  const newestRank = policyDateRank(newest);
  const seen = new Set<string>();
  return sorted.filter((fact) => {
    if (policyDateRank(fact) !== newestRank) return false;
    if (seen.has(fact.normalizedValue)) return false;
    seen.add(fact.normalizedValue);
    return true;
  });
}

function sourceForFact(fact: DeclarationFactDoc) {
  return {
    policyId: fact.policyId,
    fieldPath: fact.fieldPath,
    fieldGroup: fact.fieldGroup,
    displayValue: fact.displayValue,
    normalizedValue: fact.normalizedValue,
    valueKind: fact.valueKind,
    sourceSpanIds: fact.sourceSpanIds,
    effectiveDate: fact.effectiveDate,
    expirationDate: fact.expirationDate,
    policyYear: fact.policyYear,
    observedAt: fact.observedAt,
  };
}

function scalarProfileFact(fact: DeclarationFactDoc | undefined) {
  const value = cleanText(fact?.displayValue);
  return fact && value ? { value, source: sourceForFact(fact) } : undefined;
}

function addressProfileFact(fact: DeclarationFactDoc | undefined) {
  if (!fact) return undefined;
  const value = compactAddress(fact.structuredValue, fact.displayValue);
  return value ? { value, source: sourceForFact(fact) } : undefined;
}

function normalizedEntityName(value: string | undefined): string {
  return normalizeDeclarationValue(value ?? "");
}

function mergeRelatedLegalEntities(
  current: unknown,
  orgName: string | undefined,
  profileFacts: {
    namedInsured?: ReturnType<typeof scalarProfileFact>;
    dba?: ReturnType<typeof scalarProfileFact>;
    taxId?: ReturnType<typeof scalarProfileFact>;
    entityType?: ReturnType<typeof scalarProfileFact>;
    additionalNamedInsureds?: Array<NonNullable<ReturnType<typeof scalarProfileFact>>>;
  },
): RelatedLegalEntity[] | undefined {
  const existing = Array.isArray(current)
    ? current.filter((item): item is RelatedLegalEntity =>
      !!item &&
      typeof item === "object" &&
      typeof (item as RelatedLegalEntity).legalName === "string" &&
      (item as RelatedLegalEntity).legalName.trim().length > 0,
    )
    : [];
  const next = existing.map((entity) => ({ ...entity }));
  const seen = new Set(next.map((entity) => normalizedEntityName(entity.legalName)));
  const orgNameKey = normalizedEntityName(orgName);
  if (orgNameKey) seen.add(orgNameKey);

  const addEntity = (
    value: string | undefined,
    relationship: RelatedLegalEntity["relationship"],
    details?: Partial<RelatedLegalEntity>,
  ) => {
    const legalName = cleanText(value);
    const key = normalizedEntityName(legalName);
    if (!legalName || !key || seen.has(key)) return;
    seen.add(key);
    next.push({
      legalName,
      relationship,
      ...details,
    });
  };

  addEntity(profileFacts.namedInsured?.value, "current", {
    taxId: profileFacts.taxId?.value,
    notes: profileFacts.entityType?.value ? `Entity type: ${profileFacts.entityType.value}` : undefined,
  });
  addEntity(profileFacts.dba?.value, "dba");
  for (const insured of profileFacts.additionalNamedInsureds ?? []) {
    addEntity(insured.value, "other");
  }

  return JSON.stringify(existing) === JSON.stringify(next) ? undefined : next;
}

async function activeOrgProfileFacts(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
): Promise<DeclarationFactDoc[]> {
  const rows: DeclarationFactDoc[] = [];
  for (const group of PROFILE_FIELD_GROUPS) {
    const facts = await ctx.db
      .query("policyDeclarationFacts")
      .withIndex("by_orgId_fieldGroup", (q) => q.eq("orgId", orgId).eq("fieldGroup", group))
      .collect();
    rows.push(...facts.filter((fact) => fact.active) as DeclarationFactDoc[]);
  }
  return rows;
}

export async function syncOrgProfileFromDeclarationFacts(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
) {
  const org = await ctx.db.get(orgId);
  if (!org) return { updated: false, reason: "org_not_found" as const };

  const facts = await activeOrgProfileFacts(ctx, orgId);
  const namedInsured = scalarProfileFact(newestFact(facts, "insured_identity"));
  const mailingAddress = addressProfileFact(newestFact(facts, "mailing_address"));
  const dba = scalarProfileFact(newestFact(facts, "dba"));
  const entityType = scalarProfileFact(newestFact(facts, "entity_type"));
  const taxId = scalarProfileFact(newestFact(facts, "fein"));
  const additionalNamedInsureds = newestFactSet(facts, "additional_named_insured")
    .map(scalarProfileFact)
    .filter((fact): fact is NonNullable<ReturnType<typeof scalarProfileFact>> => Boolean(fact));

  const profileFacts = {
    ...(namedInsured ? { namedInsured } : {}),
    ...(mailingAddress ? { mailingAddress } : {}),
    ...(dba ? { dba } : {}),
    ...(entityType ? { entityType } : {}),
    ...(taxId ? { taxId } : {}),
    ...(additionalNamedInsureds.length > 0 ? { additionalNamedInsureds } : {}),
  };
  const hasProfileFacts = Object.keys(profileFacts).length > 0;
  const orgRecord = org as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  if (hasProfileFacts) {
    if (JSON.stringify(orgRecord.profileFacts ?? null) !== JSON.stringify(profileFacts)) {
      patch.profileFacts = profileFacts;
    }
  } else if (orgRecord.profileFacts !== undefined) {
    patch.profileFacts = undefined;
  }

  if (mailingAddress) {
    if (JSON.stringify(orgRecord.mailingAddress ?? null) !== JSON.stringify(mailingAddress.value)) {
      patch.mailingAddress = mailingAddress.value;
    }
  } else if (
    orgRecord.mailingAddress !== undefined &&
    typeof orgRecord.profileFacts === "object" &&
    orgRecord.profileFacts !== null &&
    "mailingAddress" in orgRecord.profileFacts
  ) {
    patch.mailingAddress = undefined;
  }

  const relatedLegalEntities = mergeRelatedLegalEntities(orgRecord.relatedLegalEntities, org.name, {
    namedInsured,
    dba,
    entityType,
    taxId,
    additionalNamedInsureds,
  });
  if (relatedLegalEntities) patch.relatedLegalEntities = relatedLegalEntities;

  if (Object.keys(patch).length === 0) {
    return { updated: false, reason: "unchanged" as const };
  }

  patch.profileFactsUpdatedAt = dayjs().valueOf();
  await ctx.db.patch(orgId, patch as never);
  return {
    updated: true,
    keys: Object.keys(patch),
  };
}
