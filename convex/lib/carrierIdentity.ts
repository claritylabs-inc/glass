import type { Id } from "../_generated/dataModel";

export type CarrierLegalEntityRelationship =
  | "single"
  | "and"
  | "or"
  | "and_or"
  | "unspecified";

export type CarrierLegalEntity = {
  name: string;
  sourceNodeIds: string[];
  sourceSpanIds: string[];
};

export type CarrierPublicNameRelationship =
  | "same_legal_entity"
  | "trading_name"
  | "parent_brand"
  | "group_brand";

export type CarrierIdentityBranding = {
  website: string;
  websiteTitle?: string;
  iconStorageId?: Id<"_storage">;
  iconUrl?: string | null;
  accentColor: string;
  confidence: "high" | "medium" | "low";
  sourceUrls: string[];
  enrichmentVersion: number;
  updatedAt: number;
};

export type CarrierIdentity = {
  displayName: string;
  sourceName?: string;
  operatingName?: string;
  publicNameRelationship?: CarrierPublicNameRelationship;
  legalEntities: CarrierLegalEntity[];
  legalEntityRelationship: CarrierLegalEntityRelationship;
  sourceNodeIds: string[];
  sourceSpanIds: string[];
  branding?: CarrierIdentityBranding;
};

export type CarrierIdentityEnrichment = {
  publicName?: string;
  nameRelationship?: CarrierPublicNameRelationship;
  website: string;
  websiteTitle?: string;
  iconStorageId?: Id<"_storage">;
  accentColor: string;
  confidence: "high" | "medium" | "low";
  sourceUrls: string[];
  enrichmentVersion: number;
  updatedAt: number;
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string =>
        typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function publicNameRelationship(
  value: unknown,
): CarrierPublicNameRelationship | undefined {
  return value === "same_legal_entity" ||
    value === "trading_name" ||
    value === "parent_brand" ||
    value === "group_brand"
    ? value
    : undefined;
}

function readCarrierIdentityBranding(
  value: unknown,
): CarrierIdentityBranding | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const website = text(record.website);
  const accentColor = text(record.accentColor);
  const confidence = record.confidence;
  const enrichmentVersion = record.enrichmentVersion;
  const updatedAt = record.updatedAt;
  if (
    !website ||
    !accentColor ||
    (confidence !== "high" &&
      confidence !== "medium" &&
      confidence !== "low") ||
    typeof enrichmentVersion !== "number" ||
    typeof updatedAt !== "number"
  ) {
    return undefined;
  }
  const websiteTitle = text(record.websiteTitle);
  const iconStorageId = text(record.iconStorageId) as
    | Id<"_storage">
    | undefined;
  const iconUrl =
    record.iconUrl === null ? null : text(record.iconUrl);
  return {
    website,
    ...(websiteTitle ? { websiteTitle } : {}),
    ...(iconStorageId ? { iconStorageId } : {}),
    ...(iconUrl !== undefined ? { iconUrl } : {}),
    accentColor,
    confidence,
    sourceUrls: stringArray(record.sourceUrls),
    enrichmentVersion,
    updatedAt,
  };
}

export function sameCarrierIdentityName(left: unknown, right: unknown) {
  const normalize = (value: unknown) =>
    text(value)
      ?.toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const normalizedLeft = normalize(left);
  return Boolean(normalizedLeft && normalizedLeft === normalize(right));
}

export function readCarrierIdentity(
  value: unknown,
): CarrierIdentity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const displayName = text(record.displayName);
  if (!displayName) return undefined;
  const legalEntities = Array.isArray(record.legalEntities)
    ? record.legalEntities.flatMap((item): CarrierLegalEntity[] => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const entity = item as Record<string, unknown>;
        const name = text(entity.name);
        return name
          ? [{
              name,
              sourceNodeIds: stringArray(entity.sourceNodeIds),
              sourceSpanIds: stringArray(entity.sourceSpanIds),
            }]
          : [];
      })
    : [];
  const legalRelationship = record.legalEntityRelationship;
  const legalEntityRelationship: CarrierLegalEntityRelationship =
    legalRelationship === "single" ||
    legalRelationship === "and" ||
    legalRelationship === "or" ||
    legalRelationship === "and_or" ||
    legalRelationship === "unspecified"
      ? legalRelationship
      : legalEntities.length <= 1
        ? "single"
        : "unspecified";
  const operatingName = text(record.operatingName);
  const sourceName = text(record.sourceName);
  const nameRelationship = publicNameRelationship(
    record.publicNameRelationship,
  );
  const branding = readCarrierIdentityBranding(record.branding);
  return {
    displayName,
    ...(sourceName ? { sourceName } : {}),
    ...(operatingName ? { operatingName } : {}),
    ...(nameRelationship
      ? { publicNameRelationship: nameRelationship }
      : {}),
    legalEntities,
    legalEntityRelationship,
    sourceNodeIds: stringArray(record.sourceNodeIds),
    sourceSpanIds: stringArray(record.sourceSpanIds),
    ...(branding ? { branding } : {}),
  };
}

export function carrierLegalEntityNames(identity: CarrierIdentity | undefined) {
  return identity?.legalEntities.map((entity) => entity.name) ?? [];
}

export function applyCarrierIdentityEnrichment(
  identity: CarrierIdentity,
  enrichment: CarrierIdentityEnrichment,
): CarrierIdentity {
  const verifiedPublicName =
    enrichment.publicName && enrichment.nameRelationship
      ? enrichment.publicName
      : undefined;
  const displayName = verifiedPublicName ?? identity.displayName;
  const operatingName =
    verifiedPublicName &&
    enrichment.nameRelationship === "trading_name"
      ? verifiedPublicName
      : identity.operatingName;
  return {
    ...identity,
    sourceName: identity.sourceName ?? identity.displayName,
    displayName,
    ...(operatingName ? { operatingName } : {}),
    ...(enrichment.nameRelationship
      ? { publicNameRelationship: enrichment.nameRelationship }
      : {}),
    branding: {
      website: enrichment.website,
      ...(enrichment.websiteTitle
        ? { websiteTitle: enrichment.websiteTitle }
        : {}),
      ...(enrichment.iconStorageId
        ? { iconStorageId: enrichment.iconStorageId }
        : {}),
      accentColor: enrichment.accentColor,
      confidence: enrichment.confidence,
      sourceUrls: enrichment.sourceUrls,
      enrichmentVersion: enrichment.enrichmentVersion,
      updatedAt: enrichment.updatedAt,
    },
  };
}

export function carrierLegalEntityRelationshipLabel(
  relationship: CarrierLegalEntityRelationship,
) {
  if (relationship === "and_or") return "and/or";
  if (relationship === "and") return "and";
  if (relationship === "or") return "or";
  return undefined;
}

export function formatCarrierLegalEntityNames(
  identity: CarrierIdentity | undefined,
) {
  const names = carrierLegalEntityNames(identity);
  return formatCarrierLegalNames(
    names,
    identity?.legalEntityRelationship ?? "unspecified",
  );
}

export function formatCarrierLegalNames(
  names: string[],
  relationship: CarrierLegalEntityRelationship,
) {
  if (names.length === 0) return undefined;
  if (names.length === 1) return names[0];
  const joiner = carrierLegalEntityRelationshipLabel(relationship);
  return joiner
    ? `${names.slice(0, -1).join(", ")} ${joiner} ${names.at(-1)}`
    : names.join("; ");
}
