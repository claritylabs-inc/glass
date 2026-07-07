import { z } from "zod";
import type { CoiData } from "./coiGenerator";
import type { EndorsementCitation } from "./certificateEndorsements";

export const CertificateDescriptionSchema = z.object({
  description: z.string().max(900),
});

type CertificateDescriptionRequest = {
  certificateHolder?: string;
  certificateHolderName?: string;
  requestKind?: "holder" | "additional_insured";
  additionalInsuredName?: string;
  holderRelationship?: string;
  endorsements?: EndorsementCitation[];
};

export type CertificateDescriptionContext = {
  insured: string[];
  policy: string[];
  operations: string[];
  coverages: string[];
  locations: string[];
  vehicles: string[];
  additionalInsureds: string[];
  certificateHolder: string[];
  endorsements: string[];
  declarationFacts: string[];
};

const RELEVANT_DECLARATION_FIELD_RE =
  /operation|business|location|premises|vehicle|auto|garage|additional|insured|certificate|holder|classification|schedule|description|project|job/i;
const DESCRIPTION_FACT_RE =
  /\b(operation|operations|service|services|work performed|location|locations|premises|project|job|vehicle|vehicles|auto|autos|additional insured|waiver|loss payee|mortgagee|special item)\b/i;
const POLICY_OVERVIEW_RE =
  /\bcoverage\s+for\b[\s\S]{0,180}\b(?:under|policy|term|carrier|insurer|insurance company)\b|\bunder\b[\s\S]{0,80}\bpolicy\b|\bpolicy\s+[A-Z0-9][A-Z0-9-]{5,}\b|\bterm\s+\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s+to\s+\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/i;
const UNSUPPORTED_NEGATIVE_STATUS_RE =
  /\bno\s+(?:additional insured|waiver of subrogation|loss payee|mortgagee)\b|\b(?:additional insured|waiver of subrogation|loss payee|mortgagee)\s+(?:status\s+)?(?:is\s+)?(?:not\s+)?(?:not\s+granted|not\s+included|excluded|unavailable)\b/i;

function compact(value: unknown, maxLength = 220): string | undefined {
  if (value === null || value === undefined) return undefined;
  let text = "";
  if (typeof value === "string") text = value;
  else if (typeof value === "number" || typeof value === "boolean") text = String(value);
  else if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { value?: unknown }).value === "string"
  ) {
    text = (value as { value: string }).value;
  } else {
    text = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined && item !== null && item !== "")
      .map(([key, item]) => `${key}: ${String(item)}`)
      .join(", ");
  }
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trim()}...` : cleaned;
}

function pushUnique(items: string[], value: unknown, limit: number, maxLength = 220) {
  if (items.length >= limit) return;
  const text = compact(value, maxLength);
  if (!text) return;
  if (items.some((item) => item.toLowerCase() === text.toLowerCase())) return;
  items.push(text);
}

function arrayRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];
}

function addressLine(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return compact(value);
  if (typeof value !== "object" || Array.isArray(value)) return compact(value);
  const address = value as Record<string, unknown>;
  return compact([
    address.street1,
    address.street2,
    address.city,
    address.state,
    address.zip,
    address.postalCode,
    address.country,
  ].filter(Boolean).join(", "));
}

function locationLine(location: Record<string, unknown>) {
  const address = addressLine(location.address) ?? compact(location.location) ?? compact(location.premisesAddress);
  const label = compact(location.name ?? location.description ?? location.number, 80);
  const details = [
    address,
    compact(location.occupancy, 80),
    compact(location.buildingValue ? `building value ${location.buildingValue}` : undefined, 80),
    compact(location.contentsValue ? `contents value ${location.contentsValue}` : undefined, 80),
  ].filter(Boolean).join("; ");
  return [label && `Location ${label}`, details].filter(Boolean).join(": ");
}

function vehicleLine(vehicle: Record<string, unknown>) {
  const yearMakeModel = [vehicle.year, vehicle.make, vehicle.model]
    .filter(Boolean)
    .join(" ");
  return [
    yearMakeModel || compact(vehicle.description ?? vehicle.type ?? vehicle.number, 100),
    vehicle.vin ? `VIN ${vehicle.vin}` : undefined,
    vehicle.garageLocation ? `garage location ${vehicle.garageLocation}` : undefined,
    vehicle.radius ? `radius ${vehicle.radius}` : undefined,
  ].filter(Boolean).join("; ");
}

function additionalInsuredLine(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return compact(value);
  const record = value as Record<string, unknown>;
  return [
    compact(record.name ?? record.entity ?? record.value, 120),
    compact(record.relationship ?? record.status ?? record.scope, 140),
    addressLine(record.address),
  ].filter(Boolean).join("; ");
}

function declarationFields(policy: Record<string, any>) {
  const fields = Array.isArray(policy.declarations?.fields)
    ? policy.declarations.fields
    : [];
  return fields.filter(
    (field: any) =>
      typeof field?.field === "string" &&
      typeof field?.value === "string" &&
      RELEVANT_DECLARATION_FIELD_RE.test(field.field),
  );
}

function includeHolderInDescription(request: CertificateDescriptionRequest) {
  return Boolean(
    request.requestKind === "additional_insured" ||
      request.additionalInsuredName ||
      request.endorsements?.length ||
      /additional|insured|loss|payee|mortgagee|waiver|subrogation|primary|contributory/i.test(request.holderRelationship ?? ""),
  );
}

function certificateDescriptionPromptFacts(context: CertificateDescriptionContext) {
  return {
    operations: context.operations,
    locations: context.locations,
    vehicles: context.vehicles,
    additionalInsureds: context.additionalInsureds,
    endorsements: context.endorsements,
    declarationFacts: context.declarationFacts,
  };
}

export function buildCertificateDescriptionContext(
  policy: Record<string, any>,
  data: CoiData,
  request: CertificateDescriptionRequest,
): CertificateDescriptionContext {
  const profile = policy.operationalProfile && typeof policy.operationalProfile === "object"
    ? policy.operationalProfile as Record<string, unknown>
    : {};
  const declarations = policy.declarations && typeof policy.declarations === "object"
    ? policy.declarations as Record<string, unknown>
    : {};
  const context: CertificateDescriptionContext = {
    insured: [],
    policy: [],
    operations: [],
    coverages: [],
    locations: [],
    vehicles: [],
    additionalInsureds: [],
    certificateHolder: [],
    endorsements: [],
    declarationFacts: [],
  };

  pushUnique(context.insured, data.insuredName, 4);
  pushUnique(context.insured, data.insuredDba && `DBA ${data.insuredDba}`, 4);
  pushUnique(context.insured, addressLine(data.insuredAddress), 4);
  pushUnique(context.insured, policy.insuredEntityType, 4);

  pushUnique(context.policy, policy.policyNumber && `Policy ${policy.policyNumber}`, 8);
  pushUnique(context.policy, data.insurers[0]?.name && `Insurer ${data.insurers[0]?.name}`, 8);
  pushUnique(context.policy, policy.carrier && `Carrier ${policy.carrier}`, 8);
  pushUnique(context.policy, policy.effectiveDate && policy.expirationDate
    ? `Policy term ${policy.effectiveDate} to ${policy.expirationDate}`
    : undefined, 8);
  pushUnique(context.policy, Array.isArray(policy.policyTypes) ? `Policy types ${policy.policyTypes.join(", ")}` : undefined, 8);

  pushUnique(context.operations, profile.businessDescription, 8);
  pushUnique(context.operations, profile.operationsDescription, 8);
  for (const classification of arrayRecords(policy.classifications ?? declarations.classifications ?? profile.classifications)) {
    pushUnique(context.operations, [
      compact(classification.description ?? classification.classification),
      compact(classification.code ? `code ${classification.code}` : undefined, 40),
      compact(classification.locationNumber ? `location ${classification.locationNumber}` : undefined, 40),
    ].filter(Boolean).join("; "), 8);
  }
  for (const fact of arrayRecords(policy.supplementaryFacts)) {
    const value = compact(fact.value, 220);
    if (!value) continue;
    if (RELEVANT_DECLARATION_FIELD_RE.test(`${fact.key ?? ""} ${value}`)) {
      pushUnique(context.operations, value, 8);
    }
  }

  for (const coverage of data.coverages.slice(0, 8)) {
    const limits = coverage.limits
      .slice(0, 4)
      .map((limit) => `${limit.label}: ${limit.value}`)
      .join("; ");
    pushUnique(context.coverages, [
      coverage.type,
      coverage.policyNumber && `policy ${coverage.policyNumber}`,
      limits,
      coverage.addlInsr ? "additional insured checked" : undefined,
      coverage.subrWvd ? "waiver of subrogation checked" : undefined,
    ].filter(Boolean).join("; "), 8, 260);
  }

  for (const source of [policy.locations, declarations.locations, profile.locations]) {
    for (const location of arrayRecords(source)) {
      pushUnique(context.locations, locationLine(location), 8);
    }
  }

  for (const source of [policy.vehicles, declarations.vehicles, profile.vehicles, profile.coveredAutos]) {
    for (const vehicle of arrayRecords(source)) {
      pushUnique(context.vehicles, vehicleLine(vehicle), 8);
    }
  }
  pushUnique(context.vehicles, compact(declarations.coveredAutoSymbols ?? profile.coveredAutoSymbols), 8);

  for (const source of [
    policy.additionalNamedInsureds,
    declarations.additionalNamedInsureds,
    profile.additionalNamedInsureds,
    profile.additionalInsureds,
    profile.scheduledAdditionalInsureds,
  ]) {
    for (const insured of arrayRecords(source)) {
      pushUnique(context.additionalInsureds, additionalInsuredLine(insured), 10);
    }
  }
  pushUnique(context.additionalInsureds, request.additionalInsuredName, 10);

  if (includeHolderInDescription(request)) {
    pushUnique(context.certificateHolder, request.certificateHolderName, 4);
    pushUnique(context.certificateHolder, request.certificateHolder, 4);
    pushUnique(context.certificateHolder, data.certificateHolder, 4);
    pushUnique(context.certificateHolder, request.holderRelationship && `Relationship: ${request.holderRelationship}`, 4);
    pushUnique(context.certificateHolder, request.requestKind === "additional_insured" ? "Request asks for additional insured status" : undefined, 4);
  }

  for (const endorsement of request.endorsements ?? []) {
    pushUnique(context.endorsements, [
      endorsement.kind.replace(/_/g, " "),
      endorsement.formNumbers.length ? `forms ${endorsement.formNumbers.join(", ")}` : undefined,
      endorsement.requiresWrittenContract ? "where required by written contract" : undefined,
    ].filter(Boolean).join("; "), 8);
  }

  for (const field of declarationFields(policy).slice(0, 16)) {
    pushUnique(context.declarationFacts, `${field.field}: ${field.value}`, 16, 260);
    if (/auto|vehicle|garage/i.test(field.field)) {
      pushUnique(context.vehicles, `${field.field}: ${field.value}`, 8, 260);
    }
    if (/location|premises|project|job/i.test(field.field)) {
      pushUnique(context.locations, `${field.field}: ${field.value}`, 8, 260);
    }
    if (/additional|certificate|holder|insured/i.test(field.field)) {
      pushUnique(context.additionalInsureds, `${field.field}: ${field.value}`, 10, 260);
    }
    if (/operation|business|classification|description/i.test(field.field)) {
      pushUnique(context.operations, `${field.field}: ${field.value}`, 8, 260);
    }
  }

  return context;
}

export function hasCertificateDescriptionContext(context: CertificateDescriptionContext) {
  return [
    context.operations,
    context.locations,
    context.vehicles,
    context.additionalInsureds,
    context.endorsements,
    context.declarationFacts,
  ].some((items) => items.length > 0);
}

export function buildCertificateDescriptionFallback(
  context: CertificateDescriptionContext,
  existingDescription?: string,
) {
  const lines: string[] = [];
  const existing = normalizeCertificateDescription(existingDescription);
  if (existing && isUsableCertificateDescription(existing)) {
    pushUnique(lines, existing, 4, 220);
  }
  pushUnique(lines, context.operations[0] && `Operations: ${context.operations[0]}`, 4, 220);
  pushUnique(lines, context.locations[0] && `Locations: ${context.locations.slice(0, 2).join("; ")}`, 4, 260);
  pushUnique(lines, context.vehicles[0] && `Covered autos/vehicles: ${context.vehicles.slice(0, 2).join("; ")}`, 4, 260);
  pushUnique(lines, context.additionalInsureds[0] && `Additional insured: ${context.additionalInsureds.slice(0, 2).join("; ")}`, 4, 260);
  pushUnique(lines, context.endorsements[0] && `Endorsements: ${context.endorsements.join("; ")}`, 4, 260);
  return lines.join("\n");
}

export function normalizeCertificateDescription(value: unknown) {
  return compact(value, 900)
    ?.replace(/^[-*\d.\s]+/gm, "")
    .replace(/\bACORD\s*\d*\b/gi, "")
    .replace(/\bGenerated using Glass\b/gi, "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isPolicyOverviewDescription(value: unknown) {
  const text = compact(value, 900);
  if (!text) return false;
  return POLICY_OVERVIEW_RE.test(text);
}

export function hasUnsupportedNegativeStatus(value: unknown) {
  const text = compact(value, 900);
  if (!text) return false;
  return UNSUPPORTED_NEGATIVE_STATUS_RE.test(text);
}

export function isUsableCertificateDescription(value: unknown) {
  const text = compact(value, 900);
  if (!text) return false;
  if (isPolicyOverviewDescription(text)) return false;
  if (hasUnsupportedNegativeStatus(text)) return false;
  return DESCRIPTION_FACT_RE.test(text);
}

export function certificateDescriptionSystemPrompt() {
  return [
    "You draft the Description of Operations / Locations / Vehicles / Special Items / Additional Insured box for a Certificate of Liability Insurance.",
    "Use only the supplied structured policy and declaration facts.",
    "Write actual operations, locations, autos/vehicles, special items, or supported endorsement wording only.",
    "Do not summarize the policy. Do not repeat the insured name, carrier, insurer, policy number, policy term, limits, or generic coverage line names.",
    "Combine deterministic facts into concise certificate wording; do not invent coverage, endorsements, blanket status, locations, autos, projects, or rights.",
    "Mention certificate-holder or additional-insured status only when the request or supplied endorsement/declaration facts support it.",
    "Do not say that additional insured, waiver, loss payee, or mortgagee status is absent unless an explicit supplied fact says so.",
    "Do not repeat the certificate holder name or address unless it is part of a supported additional-insured, loss-payee, mortgagee, waiver, or special-wording item.",
    "Mention covered locations, autos/vehicles, operations, and special items when they are supplied and relevant.",
    "Do not mention internal extraction, model use, Glass, Clarity Labs, or form numbers.",
    "Return plain certificate wording only: no markdown, bullets, headings, caveats, signatures, or citations.",
    "Keep the wording short enough for a small certificate description box, ideally under 90 words.",
  ].join("\n");
}

export function buildCertificateDescriptionPrompt(params: {
  context: CertificateDescriptionContext;
  existingDescription?: string;
}) {
  return [
    params.existingDescription
      ? `Existing deterministic description:\n${params.existingDescription}`
      : "Existing deterministic description: none",
    "",
    "Allowed source facts for this box:",
    JSON.stringify(certificateDescriptionPromptFacts(params.context), null, 2),
    "",
    "Policy identity, carrier, insurer, policy numbers, policy term, limits, and generic coverage names are intentionally excluded because they already appear elsewhere on the certificate.",
    "",
    "Write the final box text. If the allowed facts are too sparse for operations/location/special-item wording, return an empty description rather than generic policy overview filler.",
  ].join("\n");
}
