export const PCE_REQUEST_KINDS = [
  "named_insured_change",
  "additional_insured_change",
  "coverage_change",
  "limit_change",
  "deductible_change",
  "location_change",
  "vehicle_change",
  "certificate_endorsement_request",
  "cancellation",
  "nonrenewal",
  "renewal_submission_update",
  "general_endorsement",
  "certificate_holder_only",
  "unclear",
] as const;

export type PceRequestKind = (typeof PCE_REQUEST_KINDS)[number];

export type PceIntakeDecision =
  | { allowed: true; kind: Exclude<PceRequestKind, "certificate_holder_only" | "unclear"> }
  | { allowed: false; kind: "certificate_holder_only" | "unclear"; message: string };

const POLICY_CHANGE_TERMS =
  /\b(endorse(?:ment|d)?|policy change|change request|named insured|additional insured|waiver of subrogation|primary and non[-\s]?contributory|loss payee|mortgagee|mortgage holder|increase limit|decrease limit|deductible|cancel(?:lation)?|nonrenew(?:al)?|add location|remove location|add vehicle|remove vehicle)\b/i;

const CERTIFICATE_HOLDER_TERMS =
  /\b(certificate holder|holder on (?:the )?(?:coi|certificate)|coi holder|issue (?:a )?(?:coi|certificate)|generate (?:a )?(?:coi|certificate)|send (?:a )?(?:coi|certificate))\b/i;

export function evaluatePceIntake(params: {
  requestKind?: PceRequestKind;
  requestText: string;
}): PceIntakeDecision {
  const text = params.requestText.trim();
  const kind = params.requestKind ?? inferPceRequestKind(text);

  if (kind === "unclear") {
    return {
      allowed: false,
      kind,
      message:
        "I need one detail before I can prepare the policy update: what should be changed?",
    };
  }

  if (kind === "certificate_holder_only") {
    return {
      allowed: false,
      kind,
      message:
        "Use the requested organization as the certificate holder on the COI. No separate broker follow-up is needed for that.",
    };
  }

  if (kind === "certificate_endorsement_request" && isCertificateHolderOnly(text)) {
    return {
      allowed: false,
      kind: "certificate_holder_only",
      message:
        "Use the requested organization as the certificate holder on the COI. Ask for clarification only if the user also wants an endorsement such as additional insured, waiver of subrogation, primary and non-contributory wording, or another policy-record update.",
    };
  }

  return { allowed: true, kind };
}

function inferPceRequestKind(text: string): PceRequestKind {
  if (isCertificateHolderOnly(text)) return "certificate_holder_only";
  if (/\bnamed insured\b/i.test(text)) return "named_insured_change";
  if (/\badditional insured\b/i.test(text)) return "additional_insured_change";
  if (/\b(limit|sublimit)\b/i.test(text)) return "limit_change";
  if (/\bdeductible\b/i.test(text)) return "deductible_change";
  if (/\blocation|premises|address\b/i.test(text)) return "location_change";
  if (/\bvehicle|auto|driver\b/i.test(text)) return "vehicle_change";
  if (/\bcancel|cancellation\b/i.test(text)) return "cancellation";
  if (/\bnonrenew|non-renew\b/i.test(text)) return "nonrenewal";
  if (/\brenewal\b/i.test(text)) return "renewal_submission_update";
  if (/\bendorse|waiver of subrogation|primary and non[-\s]?contributory|loss payee|mortgagee|mortgage holder\b/i.test(text)) {
    return "certificate_endorsement_request";
  }
  if (POLICY_CHANGE_TERMS.test(text)) return "general_endorsement";
  return "unclear";
}

function isCertificateHolderOnly(text: string): boolean {
  return CERTIFICATE_HOLDER_TERMS.test(text) && !POLICY_CHANGE_TERMS.test(text);
}
