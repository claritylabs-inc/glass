import type { CertificateEndorsementKind } from "./certificateRequestGate";

export type EndorsementRequestEmail = {
  subject: string;
  body: string;
  recipientEmail?: string;
  recipientName?: string;
};

const KIND_COPY: Partial<Record<CertificateEndorsementKind, string>> = {
  additional_insured:
    "Add the certificate holder as additional insured (CG 20 10 / CG 20 37, or the applicable blanket additional-insured equivalent).",
  waiver_of_subrogation:
    "Add waiver of subrogation in favor of the certificate holder (CG 24 04 or equivalent).",
  primary_non_contributory:
    "Add primary and non-contributory wording for the certificate holder (CG 20 01 or equivalent).",
  loss_payee:
    "Add the certificate holder as loss payee by name on the applicable property coverage.",
  mortgagee:
    "Add the certificate holder as mortgagee/lender by name on the applicable property coverage.",
  named_insured:
    "Update the named insured as requested before the certificate is issued.",
  special_wording:
    "Review and add the requested special certificate wording if acceptable to the carrier.",
  policy_change:
    "Review and issue the required policy change before the certificate is issued.",
};

function clean(value?: string) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function policyContext(args: {
  insuredName?: string;
  policyNumber?: string;
  carrierName?: string;
}) {
  return [
    args.insuredName ? `Insured: ${args.insuredName}` : undefined,
    args.policyNumber ? `Policy: ${args.policyNumber}` : undefined,
    args.carrierName ? `Carrier: ${args.carrierName}` : undefined,
  ].filter(Boolean).join("\n");
}

export function buildEndorsementRequestEmail(args: {
  holderLegalName: string;
  additionalInsuredName?: string;
  insuredName?: string;
  policyNumber?: string;
  carrierName?: string;
  requiredChanges: CertificateEndorsementKind[];
  reasonMessage?: string;
  recipientEmail?: string;
  recipientName?: string;
}): EndorsementRequestEmail {
  const holder = clean(args.additionalInsuredName) ?? clean(args.holderLegalName) ?? "the certificate holder";
  const policyRef = clean(args.policyNumber);
  const subject = [
    "Endorsement request",
    policyRef ? `Policy ${policyRef}` : undefined,
    holder,
  ].filter(Boolean).join(" - ");
  const greeting = clean(args.recipientName)
    ? `Hi ${args.recipientName},`
    : "Hi,";
  const bullets = args.requiredChanges.length
    ? args.requiredChanges.map((kind) => {
        const copy = KIND_COPY[kind] ?? `Review requested endorsement: ${kind.replace(/_/g, " ")}.`;
        return `- ${copy.replace("the certificate holder", holder)}`;
      })
    : [`- Review and issue the endorsement needed before a certificate can be issued for ${holder}.`];
  const context = policyContext(args);
  const reason = clean(args.reasonMessage);
  const body = [
    greeting,
    "",
    "Please review the following endorsement request so Glass can issue the certificate once the policy supports the requested wording.",
    context ? `\n${context}` : undefined,
    "",
    ...bullets,
    reason ? `\nGlass hold reason: ${reason}` : undefined,
    "",
    "Once the endorsement is issued, please send a copy so the certificate can be issued.",
    "",
    "Thank you.",
  ].filter((part) => part !== undefined).join("\n");

  return {
    subject,
    body,
    recipientEmail: clean(args.recipientEmail),
    recipientName: clean(args.recipientName),
  };
}
