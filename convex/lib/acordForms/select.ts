import { isPersonalLob, toLobCodes } from "../linesOfBusiness";
import {
  CERTIFICATE_FORM_CODES,
  type CertificateFormCode,
  type CertificateHolderRelationship,
} from "./types";

const propertyLobs = new Set([
  "PROPC",
  "PROP",
  "BOPPR",
  "CFIRE",
  "AGPR",
  "HOME",
  "DFIRE",
  "MHOME",
]);

const liabilityLobs = new Set([
  "CGL",
  "GL",
  "BOP",
  "BOPGL",
  "AUTOB",
  "AUTOP",
  "GARAG",
  "TRUCK",
  "WORK",
  "WCMA",
  "WORKP",
  "WORKV",
  "UMBRC",
  "UMBRL",
  "UMBRP",
  "EXLIA",
  "EO",
  "PL",
  "OLIB",
  "EPLI",
  "DO",
  "FIDUC",
]);

const marineLobs = new Set(["COMAR", "INMAR", "INMRC", "INMRP"]);

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
  linesOfBusiness?: string[];
  policyTypes?: string[];
  holderRelationship?: CertificateHolderRelationship;
  formHint?: string;
  operationalProfile?: unknown;
}): CertificateFormCode {
  const hint = normalizeFormHint(args.formHint);
  if (hint) return hint;

  const linesOfBusiness = toLobCodes(args.linesOfBusiness ?? args.policyTypes);
  const holderRelationship = normalizeRelationship(args.holderRelationship);
  const holderIsInterest =
    holderRelationship === "mortgagee" ||
    holderRelationship === "loss_payee" ||
    holderRelationship === "lender";

  if (linesOfBusiness.includes("FLOOD")) {
    return "acord29";
  }

  if (linesOfBusiness.includes("GARAG") || operationalProfileSuggestsGarage(args.operationalProfile)) {
    return "acord30";
  }

  if (linesOfBusiness.some((code) => marineLobs.has(code))) {
    return "acord31";
  }

  const hasProperty = linesOfBusiness.some((code) => propertyLobs.has(code));
  if (hasProperty) {
    if (holderIsInterest) {
      const personal = linesOfBusiness.some(isPersonalLob);
      return personal ? "acord27" : "acord28";
    }
    return "acord24";
  }

  if (linesOfBusiness.some((code) => liabilityLobs.has(code))) return "acord25";

  return "acord25";
}
