export type CertificateHolderRelationshipKind =
  | "additional_insured"
  | "loss_payee"
  | "mortgagee"
  | "certificate_holder";

export type CertificateHolderAddress = {
  formatted?: string;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
};

export type CertificateHolderCandidate = {
  name: string;
  normalizedName: string;
  address?: CertificateHolderAddress;
  normalizedAddress: string;
  email?: string;
  normalizedEmail: string;
  phone?: string;
  normalizedPhone?: string;
  mapbox?: unknown;
  relationshipKind: CertificateHolderRelationshipKind;
  sourceNodeIds: string[];
  sourceSpanIds: string[];
  sourceSummary: string;
  sourceProfilePath: string;
};

type CandidateInput = {
  value: unknown;
  relationshipKind: CertificateHolderRelationshipKind;
  sourceProfilePath: string;
  defaultSummary: string;
};

const RELATIONSHIP_LABELS: Record<CertificateHolderRelationshipKind, string> = {
  additional_insured: "additional insured",
  loss_payee: "loss payee",
  mortgagee: "mortgagee",
  certificate_holder: "certificate holder",
};

const EXCLUDED_PARTY_ROLES = new Set(["named_insured", "insured", "insurer", "carrier", "broker", "producer"]);

export function normalizeHolderName(value: unknown): string {
  return normalizeWhitespace(String(value ?? ""))
    .replace(/[.,;:]+$/g, "")
    .toLowerCase();
}

export function normalizeHolderEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeHolderPhone(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const digits = value.replace(/\D/g, "");
  return digits || undefined;
}

export function normalizeHolderAddress(value: unknown): string {
  const address = parseAddress(value);
  if (!address) return "";
  return [
    address.formatted,
    address.street1,
    address.street2,
    address.city,
    address.state,
    address.zip,
    address.country,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ")
    .toLowerCase()
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(suite)\b/g, "ste")
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCertificateHolderCandidates(params: {
  operationalProfile?: unknown;
  policy?: unknown;
}): CertificateHolderCandidate[] {
  const inputs: CandidateInput[] = [];
  const profile = record(params.operationalProfile);
  const policy = record(params.policy);
  const eligibility = record(profile?.additionalInsuredEligibility);

  pushArray(inputs, profile?.additionalInsureds, "additional_insured", "operationalProfile.additionalInsureds", "Named additional insured from source-backed operational profile");
  pushArray(inputs, eligibility?.scheduledAdditionalInsureds, "additional_insured", "operationalProfile.additionalInsuredEligibility.scheduledAdditionalInsureds", "Scheduled additional insured from source-backed operational profile");
  pushArray(inputs, profile?.lossPayees, "loss_payee", "operationalProfile.lossPayees", "Loss payee from source-backed operational profile");
  pushArray(inputs, profile?.mortgagees, "mortgagee", "operationalProfile.mortgagees", "Mortgagee from source-backed operational profile");
  pushArray(inputs, profile?.mortgageHolders, "mortgagee", "operationalProfile.mortgageHolders", "Mortgagee from source-backed operational profile");
  pushArray(inputs, profile?.certificateHolders, "certificate_holder", "operationalProfile.certificateHolders", "Specifically allowed certificate holder from source-backed operational profile");

  if (Array.isArray(profile?.parties)) {
    for (const [index, party] of profile.parties.entries()) {
      const partyRecord = record(party);
      const kind = relationshipKindForRole(partyRecord?.role);
      if (!kind) continue;
      inputs.push({
        value: party,
        relationshipKind: kind,
        sourceProfilePath: `operationalProfile.parties[${index}]`,
        defaultSummary: `${RELATIONSHIP_LABELS[kind]} party from source-backed operational profile`,
      });
    }
  }

  pushArray(inputs, policy?.lossPayees, "loss_payee", "policy.lossPayees", "Loss payee from extracted policy projection");
  pushArray(inputs, policy?.mortgageHolders, "mortgagee", "policy.mortgageHolders", "Mortgagee from extracted policy projection");

  const byKey = new Map<string, CertificateHolderCandidate>();
  for (const input of inputs) {
    const candidate = candidateFromInput(input);
    if (!candidate) continue;
    const key = [
      candidate.relationshipKind,
      candidate.normalizedName,
      candidate.normalizedAddress,
      candidate.normalizedEmail,
    ].join("|");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }
    existing.sourceNodeIds = unique([...existing.sourceNodeIds, ...candidate.sourceNodeIds]);
    existing.sourceSpanIds = unique([...existing.sourceSpanIds, ...candidate.sourceSpanIds]);
    if (!existing.email && candidate.email) existing.email = candidate.email;
    if (!existing.phone && candidate.phone) existing.phone = candidate.phone;
    if (!existing.address && candidate.address) existing.address = candidate.address;
  }
  return [...byKey.values()];
}

function pushArray(
  inputs: CandidateInput[],
  value: unknown,
  relationshipKind: CertificateHolderRelationshipKind,
  sourceProfilePath: string,
  defaultSummary: string,
) {
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => {
    inputs.push({
      value: item,
      relationshipKind,
      sourceProfilePath: `${sourceProfilePath}[${index}]`,
      defaultSummary,
    });
  });
}

function candidateFromInput(input: CandidateInput): CertificateHolderCandidate | undefined {
  const item = record(input.value);
  const name = firstString(item?.name, item?.partyName, item?.holderName, item?.value, input.value);
  if (!name || looksLikeClassOnly(item, name)) return undefined;

  const normalizedName = normalizeHolderName(name);
  if (!normalizedName) return undefined;

  const address = parseAddress(item?.address ?? item?.mailingAddress ?? item?.holderAddress);
  const normalizedAddress = normalizeHolderAddress(address);
  const email = firstString(item?.email, item?.emailAddress, item?.holderEmail);
  const normalizedEmail = normalizeHolderEmail(email);
  const phone = firstString(item?.phone, item?.phoneNumber, item?.holderPhone);
  const mapbox = item?.mapbox ?? item?.mapboxAddress ?? item?.addressMetadata;
  const sourceNodeIds = stringArray(item?.sourceNodeIds ?? item?.documentNodeIds ?? item?.sourceNodes ?? item?.documentNodeId);
  const sourceSpanIds = stringArray(item?.sourceSpanIds ?? item?.spanIds ?? item?.sourceSpans ?? item?.sourceSpanId);
  const summary = firstString(item?.sourceSummary, item?.summary, item?.endorsementTitle, item?.scope) ?? input.defaultSummary;
  if (sourceNodeIds.length === 0 && sourceSpanIds.length === 0) return undefined;

  return {
    name: name.trim(),
    normalizedName,
    address,
    normalizedAddress,
    email: email?.trim(),
    normalizedEmail,
    phone: phone?.trim(),
    normalizedPhone: normalizeHolderPhone(phone),
    mapbox,
    relationshipKind: input.relationshipKind,
    sourceNodeIds,
    sourceSpanIds,
    sourceSummary: summary.trim().slice(0, 1000),
    sourceProfilePath: input.sourceProfilePath,
  };
}

function relationshipKindForRole(role: unknown): CertificateHolderRelationshipKind | undefined {
  if (typeof role !== "string") return undefined;
  const normalized = role.toLowerCase().replace(/[\s-]+/g, "_");
  if (EXCLUDED_PARTY_ROLES.has(normalized)) return undefined;
  if (normalized.includes("loss_payee")) return "loss_payee";
  if (normalized.includes("mortgage")) return "mortgagee";
  if (normalized.includes("additional_insured") || normalized === "addl_insured") return "additional_insured";
  if (normalized.includes("certificate_holder") || normalized === "holder") return "certificate_holder";
  return undefined;
}

function looksLikeClassOnly(item: Record<string, unknown> | undefined, name: string) {
  const lower = name.toLowerCase();
  if (item && (typeof item.category === "string" || typeof item.condition === "string") && !item.name) return true;
  return /\b(any|all)\b.*\b(contract|agreement|person|organization|lessor|vendor|owner)s?\b/.test(lower);
}

function parseAddress(value: unknown): CertificateHolderAddress | undefined {
  if (typeof value === "string") {
    const formatted = normalizeWhitespace(value);
    return formatted ? { formatted } : undefined;
  }
  const source = record(value);
  if (!source) return undefined;
  const address: CertificateHolderAddress = {};
  const formatted = firstString(source.formatted, source.fullAddress, source.label, source.value);
  if (formatted) address.formatted = normalizeWhitespace(formatted);
  const street1 = firstString(source.street1, source.line1, source.addressLine1, source.street);
  if (street1) address.street1 = normalizeWhitespace(street1);
  const street2 = firstString(source.street2, source.line2, source.addressLine2, source.unit);
  if (street2) address.street2 = normalizeWhitespace(street2);
  const city = firstString(source.city, source.locality);
  if (city) address.city = normalizeWhitespace(city);
  const state = firstString(source.state, source.region, source.province);
  if (state) address.state = normalizeWhitespace(state);
  const zip = firstString(source.zip, source.postalCode, source.postcode);
  if (zip) address.zip = normalizeWhitespace(zip);
  const country = firstString(source.country);
  if (country) address.country = normalizeWhitespace(country);
  return Object.keys(address).length > 0 ? address : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const clean = normalizeWhitespace(value);
    if (clean) return clean;
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return unique(values.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
