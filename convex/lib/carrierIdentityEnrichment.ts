import type {
  CarrierIdentity,
  CarrierPublicNameRelationship,
} from "./carrierIdentity";

export const CARRIER_IDENTITY_ENRICHMENT_VERSION = 16;

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

const GENERIC_CARRIER_WORDS = new Set([
  "and",
  "american",
  "assurance",
  "company",
  "corp",
  "corporation",
  "general",
  "global",
  "group",
  "inc",
  "indemnity",
  "insurance",
  "led",
  "liability",
  "limited",
  "lloyd",
  "lloyds",
  "ltd",
  "managing",
  "mutual",
  "plc",
  "se",
  "specialty",
  "syndicate",
  "the",
  "underwriters",
]);

type CarrierWebsiteCandidate = {
  website: string;
  title?: string;
  siteName?: string;
  identityEvidence?: string;
};

function distinctiveCarrierWords(carrierName: string) {
  return Array.from(
    new Set(
      normalizeCarrierIdentityName(carrierName)
        .split(" ")
        .filter(
          (word) =>
            word.length >= 3 &&
            ((/[a-z]/.test(word) && !GENERIC_CARRIER_WORDS.has(word)) ||
              /^\d{3,6}$/.test(word)),
        ),
    ),
  );
}

function carrierWebsiteIdentityName(carrierName: string) {
  return carrierName
    .replace(
      /^lloyd(?:'|’)?s?\s+underwriters\s+led\s+by\s*:?\s*/i,
      "",
    )
    .replace(
      /\(\s*syndicate\s+(?:no\.?\s*)?[a-z0-9/-]+(?:\s+[a-z0-9/-]+)?\s*\)/gi,
      "",
    )
    .replace(
      /,?\s*(?:and\s+)?syndicate\s+(?:no\.?\s*)?[a-z0-9/-]+(?:\s+[a-z0-9/-]+)?/gi,
      "",
    )
    .replace(
      /,?\s*under\s+contract(?:\s+(?:no\.?|number))?\s+.*$/i,
      "",
    )
    .replace(/\s*(?:,|\band\b)\s*$/i, "")
    .trim();
}

function carrierWebsiteWords(carrierName: string) {
  return distinctiveCarrierWords(
    carrierWebsiteIdentityName(carrierName) || carrierName,
  );
}

export function carrierPublicNameHasAffinity(
  carrierName: string,
  publicName: string,
) {
  const carrierWords = carrierWebsiteWords(carrierName);
  const publicWords = new Set(
    normalizeCarrierIdentityName(publicName).split(" "),
  );
  return carrierWords.some((word) => publicWords.has(word));
}

export function carrierWebsiteCandidateHasAffinity(
  carrierName: string,
  candidate: CarrierWebsiteCandidate,
  publicName?: string,
) {
  const carrierWords = carrierWebsiteWords(carrierName);
  if (carrierWords.length === 0) return false;
  const parsed = new URL(candidate.website);
  const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const compactHostname = hostname.replace(/[^a-z0-9]/g, "");
  const visibleWords = new Set(
    normalizeCarrierIdentityName(
      [publicName, candidate.siteName, candidate.title]
        .filter(Boolean)
        .join(" "),
    ).split(" "),
  );
  const sharedDomainWord = carrierWords.some(
    (word) =>
      visibleWords.has(word) &&
      compactHostname.includes(word.replace(/[^a-z0-9]/g, "")),
  );
  const acronym = carrierWords
    .filter((word) => /[a-z]/.test(word))
    .map((word) => word[0])
    .join("");
  const acronymMatch =
    acronym.length >= 3 &&
    hostname
      .split(".")
      .some((label) => label.startsWith(acronym));
  return sharedDomainWord || acronymMatch;
}

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

export function verifiedCarrierNameRelationship(
  carrierName: string,
  publicName: string,
  requestedRelationship: CarrierPublicNameRelationship,
  evidenceText: string,
) {
  const normalizedCarrier = normalizeCarrierIdentityName(carrierName);
  const normalizedPublicName = normalizeCarrierIdentityName(publicName);
  const normalizedEvidence = normalizeCarrierIdentityName(evidenceText);
  if (
    !normalizedEvidence ||
    !` ${normalizedEvidence} `.includes(` ${normalizedPublicName} `)
  ) {
    return undefined;
  }

  switch (requestedRelationship) {
    case "trading_name":
      return /\b(?:trading name|doing business as|d b a|dba|operating as)\b/i.test(
        evidenceText,
      )
        ? requestedRelationship
        : undefined;
    case "parent_brand":
      return /\b(?:parent|parent company|subsidiary of|owned by|operates under|part of)\b/i.test(
        evidenceText,
      )
        ? requestedRelationship
        : undefined;
    case "group_brand":
      return /\b(?:group brand|member of|part of|under the .+ umbrella)\b/i.test(
        evidenceText,
      )
        ? requestedRelationship
        : undefined;
    case "same_legal_entity":
      return normalizedCarrier === normalizedPublicName
        ? requestedRelationship
        : undefined;
  }
}

export function firstPartyCarrierPublicIdentity(
  carrierName: string,
  candidates: CarrierWebsiteCandidate[],
) {
  const carrierWords = distinctiveCarrierWords(carrierName);
  const matches = candidates.flatMap((candidate, candidateIndex) => {
    if (!isPrimaryCarrierWebsiteCandidate(candidate)) return [];
    const publicName = verifiedCarrierPublicName(
      candidate,
      candidate.siteName,
    );
    const evidence = candidate.identityEvidence;
    if (
      !publicName ||
      !evidence ||
      !carrierPublicNameHasAffinity(carrierName, publicName) ||
      !carrierWebsiteCandidateHasAffinity(
        carrierName,
        candidate,
        publicName,
      )
    ) {
      return [];
    }

    const publicWords = new Set(
      normalizeCarrierIdentityName(publicName).split(" "),
    );
    const evidenceWords = new Set(
      normalizeCarrierIdentityName(evidence).split(" "),
    );
    const matchedCarrierWords = carrierWords.filter(
      (word) => !publicWords.has(word) && evidenceWords.has(word),
    );
    if (matchedCarrierWords.length < 2) return [];

    const relationships: CarrierPublicNameRelationship[] = [
      "trading_name",
      "parent_brand",
      "group_brand",
      "same_legal_entity",
    ];
    const nameRelationship = relationships.find((relationship) =>
      verifiedCarrierNameRelationship(
        carrierName,
        publicName,
        relationship,
        evidence,
      ),
    );
    if (!nameRelationship) return [];
    const hasNumericAnchor = matchedCarrierWords.some((word) =>
      /^\d+$/.test(word),
    );
    return [
      {
        candidateIndex,
        publicName,
        nameRelationship,
        score:
          matchedCarrierWords.length +
          (hasNumericAnchor ? 4 : 0) +
          (nameRelationship === "trading_name" ? 4 : 0),
      },
    ];
  });

  matches.sort((left, right) => right.score - left.score);
  if (!matches[0] || matches[0].score === matches[1]?.score) return undefined;
  return matches[0];
}

export function fallbackCarrierWebsiteIndex(
  carrierName: string,
  candidates: CarrierWebsiteCandidate[],
) {
  const words = carrierWebsiteWords(carrierName);
  if (words.length === 0) return -1;

  let bestIndex = -1;
  let bestScore = 0;
  candidates.forEach((candidate, index) => {
    if (!isPrimaryCarrierWebsiteCandidate(candidate)) return;
    const hostname = new URL(candidate.website).hostname.replace(/^www\./, "");
    const compactHostname = hostname.replace(/[^a-z0-9]/g, "");
    const domainLabels = hostname.split(".");
    const titleWords = new Set(
      normalizeCarrierIdentityName(candidate.title ?? "").split(" "),
    );
    let domainMatches = 0;
    let matchedWords = 0;
    let score = words.reduce((total, word) => {
      const compactWord = word.replace(/[^a-z0-9]/g, "");
      if (compactHostname.includes(compactWord)) {
        domainMatches += 1;
        matchedWords += 1;
        return total + (domainLabels.includes(compactWord) ? 8 : 5);
      }
      if (titleWords.has(word)) {
        matchedWords += 1;
        return total + 2;
      }
      return total;
    }, 0);
    const acronym = words
      .filter((word) => /[a-z]/.test(word))
      .map((word) => word[0])
      .join("");
    if (
      acronym.length >= 3 &&
      domainLabels.some((label) => label.startsWith(acronym))
    ) {
      domainMatches += 1;
      matchedWords = words.length;
      score += 7;
    }
    if (domainMatches === 0 || matchedWords / words.length < 0.75) return;
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });

  return bestScore >= 5 ? bestIndex : -1;
}
