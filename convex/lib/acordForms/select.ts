import { isPersonalLob, toLobCodes } from "../linesOfBusiness";
import {
  CERTIFICATE_FORM_CODES,
  type CertificateFormCode,
  type CertificateHolderRelationship,
} from "./types";

const propertyLobCodes = new Set([
  "PROPC",
  "PROP",
  "CFIRE",
  "CFRM",
  "HOME",
  "DFIRE",
  "MHOME",
  "INMRC",
  "INMRP",
  "SCHPR",
  "FLOOD",
]);

const liabilityLobCodes = new Set([
  "CGL",
  "GL",
  "BOP",
  "BOPGL",
  "AUTO",
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
  "CRIME",
]);

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
  holderRelationship?: CertificateHolderRelationship;
  formHint?: string;
  operationalProfile?: unknown;
}): CertificateFormCode {
  const hint = normalizeFormHint(args.formHint);
  if (hint) return hint;

  const lobCodes = toLobCodes(args.linesOfBusiness);
  const holderRelationship = normalizeRelationship(args.holderRelationship);
  const holderIsInterest =
    holderRelationship === "mortgagee" ||
    holderRelationship === "loss_payee" ||
    holderRelationship === "lender";

  if (lobCodes.includes("FLOOD")) {
    return "acord29";
  }

  if (operationalProfileSuggestsGarage(args.operationalProfile)) {
    return "acord30";
  }

  if (
    lobCodes.some((code) => code === "COMAR" || code === "BOAT")
  ) {
    return "acord31";
  }

  const hasProperty = lobCodes.some((code) => propertyLobCodes.has(code));
  if (hasProperty) {
    if (holderIsInterest) {
      const personal = lobCodes.some((code) => isPersonalLob(code));
      return personal ? "acord27" : "acord28";
    }
    return "acord24";
  }

  if (lobCodes.some((code) => liabilityLobCodes.has(code))) {
    return "acord25";
  }

  return "acord25";
}
