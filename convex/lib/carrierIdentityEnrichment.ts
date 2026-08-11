import type {
  CarrierIdentity,
  CarrierPublicNameRelationship,
} from "./carrierIdentity";

export const CARRIER_IDENTITY_ENRICHMENT_VERSION = 18;

export function normalizeCarrierIdentityName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function knownCarrierIdentityName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  if (
    !cleaned ||
    /^(unknown|extracting(?:\.\.\.)?|not applicable|n\/a)$/i.test(cleaned)
  ) {
    return undefined;
  }
  return cleaned;
}

export function carrierIdentityResearchNames(
  identity: CarrierIdentity | undefined,
  compatibilityNames: unknown[] = [],
) {
  const seen = new Set<string>();
  return [
    identity?.sourceName,
    identity?.displayName,
    identity?.operatingName,
    ...(identity?.legalEntities.map((entity) => entity.name) ?? []),
    ...compatibilityNames,
  ]
    .map(knownCarrierIdentityName)
    .filter((name): name is string => {
      if (!name) return false;
      const normalized = normalizeCarrierIdentityName(name);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

export function carrierIdentityResearchName(
  identity: CarrierIdentity | undefined,
  compatibilityNames: unknown[] = [],
) {
  return carrierIdentityResearchNames(identity, compatibilityNames)[0];
}

export type CarrierWebsiteCandidate = {
  website: string;
  title?: string;
  siteName?: string;
  identityEvidence?: string;
};

export type CarrierIdentityModelSelection = {
  candidateIndex: number;
  officialSite: boolean;
  publicName: string | null;
  nameRelationship: CarrierPublicNameRelationship | null;
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type GroundedCarrierIdentitySelection = {
  candidateIndex: number;
  publicName?: string;
  nameRelationship?: CarrierPublicNameRelationship;
  confidence: "high";
};

export function isPrimaryCarrierWebsiteCandidate(
  candidate: CarrierWebsiteCandidate,
) {
  const hostname = new URL(candidate.website).hostname
    .replace(/^www\./, "")
    .toLowerCase();
  const title = normalizeCarrierIdentityName(candidate.title ?? "");
  const path = new URL(candidate.website).pathname.toLowerCase();
  return (
    !/^(account|accounts|login|my|portal)\./.test(hostname) &&
    !/\b(log on|log in|login|sign in|redirect|redirecting|access denied|just a moment)\b/.test(
      title,
    ) &&
    !/(?:^|\/)(?:login|signin|redirect)(?:\/|$)/.test(path)
  );
}

export function verifiedCarrierPublicName(
  candidate: CarrierWebsiteCandidate,
  requestedName: unknown,
) {
  const publicName = knownCarrierIdentityName(requestedName);
  if (!publicName || publicName.length > 120) return undefined;

  const normalizedPublicName = normalizeCarrierIdentityName(publicName);
  if (normalizedPublicName.length < 2) return undefined;
  const evidence = [candidate.siteName, candidate.title]
    .map((value) =>
      typeof value === "string" ? normalizeCarrierIdentityName(value) : "",
    )
    .filter(Boolean);
  const paddedName = ` ${normalizedPublicName} `;
  const isVisibleOnOfficialSite = evidence.some(
    (value) =>
      value === normalizedPublicName || ` ${value} `.includes(paddedName),
  );
  return isVisibleOnOfficialSite ? publicName : undefined;
}

export function groundCarrierIdentitySelection(
  output: CarrierIdentityModelSelection,
  candidates: CarrierWebsiteCandidate[],
): GroundedCarrierIdentitySelection {
  const selected = candidates[output.candidateIndex];
  if (
    !output.officialSite ||
    output.confidence !== "high" ||
    !selected ||
    !selected.identityEvidence?.trim() ||
    !isPrimaryCarrierWebsiteCandidate(selected)
  ) {
    throw new Error(
      `Carrier website could not be identified confidently: ${output.reason}`,
    );
  }

  if (
    (output.publicName === null) !== (output.nameRelationship === null)
  ) {
    throw new Error(
      "Carrier identity model returned an incomplete public-name relationship",
    );
  }

  const publicName = output.publicName
    ? verifiedCarrierPublicName(selected, output.publicName)
    : undefined;
  if (output.publicName && !publicName) {
    throw new Error(
      "Carrier identity model returned a public name that is not visible on the selected site",
    );
  }

  return {
    candidateIndex: output.candidateIndex,
    ...(publicName ? { publicName } : {}),
    ...(output.nameRelationship
      ? { nameRelationship: output.nameRelationship }
      : {}),
    confidence: "high",
  };
}
