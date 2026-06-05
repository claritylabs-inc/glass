import {
  normalizeCertificateHolderAddress,
  normalizeCertificateHolderEmail,
  normalizeCertificateHolderName,
  type CertificateHolderAddressInput,
} from "./certificateIdentity";

export type CertificateHolderRelationshipKind =
  | "additional_insured"
  | "loss_payee"
  | "mortgagee"
  | "allowed_holder";

export type CertificateHolderCandidate = {
  displayName: string;
  email?: string;
  phone?: string;
  address?: CertificateHolderAddressInput;
  mapboxMetadata?: unknown;
  relationshipKind: CertificateHolderRelationshipKind;
  sourceNodeIds: string[];
  sourceSpanIds: string[];
  sourceSummary: string;
};

type CandidateInput = {
  value: unknown;
  relationshipKind: CertificateHolderRelationshipKind;
  defaultSummary: string;
};

const EXCLUDED_PARTY_ROLES = new Set([
  "named_insured",
  "insured",
  "insurer",
  "carrier",
  "broker",
  "producer",
]);

export function parseCertificateHolderCandidates(params: {
  operationalProfile?: unknown;
  policy?: unknown;
}) {
  const profile = recordValue(params.operationalProfile);
  const policy = recordValue(params.policy);
  const eligibility = recordValue(profile?.additionalInsuredEligibility);
  const inputs: CandidateInput[] = [];

  pushArray(inputs, profile?.additionalInsureds, "additional_insured", "Named additional insured from source-backed operational profile");
  pushArray(inputs, eligibility?.scheduledAdditionalInsureds, "additional_insured", "Scheduled additional insured from source-backed operational profile");
  pushArray(inputs, profile?.lossPayees, "loss_payee", "Loss payee from source-backed operational profile");
  pushArray(inputs, profile?.mortgagees, "mortgagee", "Mortgagee from source-backed operational profile");
  pushArray(inputs, profile?.mortgageHolders, "mortgagee", "Mortgagee from source-backed operational profile");
  pushArray(inputs, profile?.certificateHolders, "allowed_holder", "Specifically allowed certificate holder from source-backed operational profile");
  pushArray(inputs, policy?.lossPayees, "loss_payee", "Loss payee from extracted policy projection");
  pushArray(inputs, policy?.mortgageHolders, "mortgagee", "Mortgagee from extracted policy projection");

  if (Array.isArray(profile?.parties)) {
    for (const party of profile.parties) {
      const partyRecord = recordValue(party);
      const relationshipKind = relationshipKindForRole(partyRecord?.role);
      if (!relationshipKind) continue;
      inputs.push({
        value: party,
        relationshipKind,
        defaultSummary: `${relationshipKind.replace(/_/g, " ")} from source-backed operational profile`,
      });
    }
  }

  const byKey = new Map<string, CertificateHolderCandidate>();
  for (const input of inputs) {
    const candidate = candidateFromInput(input);
    if (!candidate) continue;
    const key = [
      candidate.relationshipKind,
      normalizeCertificateHolderName(candidate.displayName),
      normalizeCertificateHolderAddress(candidate.address) ?? "",
      normalizeCertificateHolderEmail(candidate.email) ?? "",
    ].join("|");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }
    existing.sourceNodeIds = unique([...existing.sourceNodeIds, ...candidate.sourceNodeIds]);
    existing.sourceSpanIds = unique([...existing.sourceSpanIds, ...candidate.sourceSpanIds]);
    existing.email ??= candidate.email;
    existing.phone ??= candidate.phone;
    existing.address ??= candidate.address;
    existing.mapboxMetadata ??= candidate.mapboxMetadata;
  }

  return [...byKey.values()];
}

function candidateFromInput(input: CandidateInput): CertificateHolderCandidate | null {
  const item = recordValue(input.value);
  const displayName = firstString(item?.name, item?.partyName, item?.holderName, item?.value, input.value);
  if (!displayName || looksLikeBlanketClass(item, displayName)) return null;

  const address = parseAddress(item?.address ?? item?.mailingAddress ?? item?.holderAddress);
  const email = firstString(item?.email, item?.emailAddress, item?.holderEmail);
  const phone = firstString(item?.phone, item?.phoneNumber, item?.holderPhone);
  const sourceNodeIds = stringArray(item?.sourceNodeIds ?? item?.documentNodeIds ?? item?.sourceNodes ?? item?.sourceNodeId);
  const sourceSpanIds = stringArray(item?.sourceSpanIds ?? item?.spanIds ?? item?.sourceSpans ?? item?.sourceSpanId);
  if (sourceNodeIds.length === 0 && sourceSpanIds.length === 0) return null;

  return {
    displayName,
    email,
    phone,
    address,
    mapboxMetadata: item?.mapboxMetadata ?? item?.mapbox ?? item?.addressMetadata,
    relationshipKind: input.relationshipKind,
    sourceNodeIds,
    sourceSpanIds,
    sourceSummary: (
      firstString(item?.sourceSummary, item?.summary, item?.endorsementTitle, item?.scope)
      ?? input.defaultSummary
    ).slice(0, 1000),
  };
}

function relationshipKindForRole(role: unknown): CertificateHolderRelationshipKind | null {
  if (typeof role !== "string") return null;
  const normalized = role.toLowerCase().replace(/[\s-]+/g, "_");
  if (EXCLUDED_PARTY_ROLES.has(normalized)) return null;
  if (normalized.includes("loss_payee")) return "loss_payee";
  if (normalized.includes("mortgage")) return "mortgagee";
  if (normalized.includes("additional_insured") || normalized === "addl_insured") return "additional_insured";
  if (normalized.includes("certificate_holder") || normalized === "holder") return "allowed_holder";
  return null;
}

function pushArray(
  inputs: CandidateInput[],
  value: unknown,
  relationshipKind: CertificateHolderRelationshipKind,
  defaultSummary: string,
) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    inputs.push({ value: item, relationshipKind, defaultSummary });
  }
}

function parseAddress(value: unknown): CertificateHolderAddressInput | undefined {
  if (typeof value === "string") {
    const formatted = normalizeWhitespace(value);
    return formatted ? { formatted } : undefined;
  }
  const source = recordValue(value);
  if (!source) return undefined;
  const address: CertificateHolderAddressInput = {};
  const formatted = firstString(source.formatted, source.fullAddress, source.label, source.value);
  if (formatted) address.formatted = formatted;
  const line1 = firstString(source.line1, source.street1, source.addressLine1, source.street);
  if (line1) address.line1 = line1;
  const line2 = firstString(source.line2, source.street2, source.addressLine2, source.unit);
  if (line2) address.line2 = line2;
  const city = firstString(source.city, source.locality);
  if (city) address.city = city;
  const state = firstString(source.state, source.region, source.province);
  if (state) address.state = state;
  const postalCode = firstString(source.postalCode, source.zip, source.postcode);
  if (postalCode) address.postalCode = postalCode;
  const country = firstString(source.country);
  if (country) address.country = country;
  return Object.keys(address).length > 0 ? address : undefined;
}

function looksLikeBlanketClass(item: Record<string, unknown> | undefined, name: string) {
  const normalized = normalizeCertificateHolderName(name);
  if (item && (typeof item.category === "string" || typeof item.condition === "string") && !item.name) {
    return true;
  }
  return /\b(any|all)\b.*\b(contract|agreement|person|organization|lessor|vendor|owner)s?\b/.test(normalized);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const clean = normalizeWhitespace(value);
    if (clean) return clean;
  }
  return undefined;
}

function stringArray(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  return unique(values.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()));
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
