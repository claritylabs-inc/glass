import { PERSONAL_LINE_KEYS } from "../policyTypes";
import {
  CERTIFICATE_FORM_CODES,
  type CertificateFormCode,
  type CertificateHolderRelationship,
} from "./types";

const propertyTypes = new Set([
  "commercial_property",
  "property",
  "builders_risk",
  "homeowners_ho3",
  "homeowners_ho5",
  "renters_ho4",
  "condo_ho6",
  "dwelling_fire",
  "mobile_home",
]);

const liabilityTypes = new Set([
  "general_liability",
  "commercial_auto",
  "non_owned_auto",
  "workers_comp",
  "umbrella",
  "excess_liability",
  "professional_liability",
  "cyber",
  "epli",
  "directors_officers",
  "fiduciary_liability",
  "product_liability",
  "bop",
  "management_liability_package",
]);

function normalizePolicyTypes(policyTypes?: string[]) {
  return (policyTypes ?? []).map((type) => type.toLowerCase().trim()).filter(Boolean);
}

function normalizeRelationship(value?: CertificateHolderRelationship) {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeFormHint(value?: string): CertificateFormCode | undefined {
  const normalized = value?.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!normalized) return undefined;
  for (const formCode of CERTIFICATE_FORM_CODES) {
    if (normalized === formCode || normalized === formCode.replace("acord", "")) {
      return formCode;
    }
  }
  return undefined;
}

function operationalProfileSuggestsGarage(value: unknown) {
  try {
    const text = JSON.stringify(value ?? "").toLowerCase();
    return /\b(garage|auto repair|repair shop|dealership|dealer|service station)\b/.test(text);
  } catch {
    return false;
  }
}

export function selectCertificateForm(args: {
  policyTypes?: string[];
  holderRelationship?: CertificateHolderRelationship;
  formHint?: string;
  operationalProfile?: unknown;
}): CertificateFormCode {
  const hint = normalizeFormHint(args.formHint);
  if (hint) return hint;

  const types = normalizePolicyTypes(args.policyTypes);
  const holderRelationship = normalizeRelationship(args.holderRelationship);
  const holderIsInterest =
    holderRelationship === "mortgagee" ||
    holderRelationship === "loss_payee" ||
    holderRelationship === "lender";

  if (types.some((type) => type === "flood_nfip" || type === "flood_private")) {
    return "acord29";
  }

  if (operationalProfileSuggestsGarage(args.operationalProfile)) {
    return "acord30";
  }

  if (types.some((type) => type === "ocean_marine" || type === "watercraft" || /energy/.test(type))) {
    return "acord31";
  }

  const hasProperty = types.some((type) => propertyTypes.has(type));
  if (hasProperty) {
    if (holderIsInterest) {
      const personal = types.some((type) => PERSONAL_LINE_KEYS.has(type));
      return personal ? "acord27" : "acord28";
    }
    return "acord24";
  }

  if (types.some((type) => liabilityTypes.has(type))) return "acord25";

  return "acord25";
}
