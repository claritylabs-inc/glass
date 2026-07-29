export const CARRIER_BRAND_ENRICHMENT_VERSION = 3;

export function normalizeCarrierBrandName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function knownCarrierBrandName(value: unknown): string | undefined {
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
};

function distinctiveCarrierWords(carrierName: string) {
  return Array.from(
    new Set(
      normalizeCarrierBrandName(carrierName)
        .split(" ")
        .filter(
          (word) =>
            word.length >= 3 &&
            /[a-z]/.test(word) &&
            !GENERIC_CARRIER_WORDS.has(word),
        ),
    ),
  );
}

export function isPrimaryCarrierWebsiteCandidate(
  candidate: CarrierWebsiteCandidate,
) {
  const hostname = new URL(candidate.website).hostname
    .replace(/^www\./, "")
    .toLowerCase();
  const title = normalizeCarrierBrandName(candidate.title ?? "");
  return (
    !/^(account|accounts|login|my|portal)\./.test(hostname) &&
    !/\b(log on|log in|login|sign in)\b/.test(title)
  );
}

export function fallbackCarrierWebsiteIndex(
  carrierName: string,
  candidates: CarrierWebsiteCandidate[],
) {
  const words = distinctiveCarrierWords(carrierName);
  if (words.length === 0) return -1;

  let bestIndex = -1;
  let bestScore = 0;
  candidates.forEach((candidate, index) => {
    if (!isPrimaryCarrierWebsiteCandidate(candidate)) return;
    const hostname = new URL(candidate.website).hostname.replace(/^www\./, "");
    const compactHostname = hostname.replace(/[^a-z0-9]/g, "");
    const domainLabels = hostname.split(".");
    const titleWords = new Set(
      normalizeCarrierBrandName(candidate.title ?? "").split(" "),
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
    if (domainMatches === 0 || matchedWords / words.length < 0.75) return;
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });

  return bestScore >= 5 ? bestIndex : -1;
}
