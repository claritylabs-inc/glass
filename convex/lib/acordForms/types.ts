export const CERTIFICATE_FORM_CODES = [
  "acord25",
  "acord24",
  "acord27",
  "acord28",
  "acord29",
  "acord30",
  "acord31",
] as const;

export type CertificateFormCode = (typeof CERTIFICATE_FORM_CODES)[number];

export const CERTIFICATE_FORM_LABELS: Record<CertificateFormCode, string> = {
  acord25: "ACORD 25 Certificate of Liability Insurance",
  acord24: "ACORD 24 Certificate of Property Insurance",
  acord27: "ACORD 27 Evidence of Property Insurance",
  acord28: "ACORD 28 Evidence of Commercial Property Insurance",
  acord29: "ACORD 29 Evidence of Flood Insurance",
  acord30: "ACORD 30 Certificate of Garage Insurance",
  acord31: "ACORD 31 Certificate of Marine / Energy Insurance",
};

export const CERTIFICATE_FORM_FILE_SLUGS: Record<CertificateFormCode, string> = {
  acord25: "acord-25-certificate-of-liability",
  acord24: "acord-24-certificate-of-property",
  acord27: "acord-27-evidence-of-property",
  acord28: "acord-28-evidence-of-commercial-property",
  acord29: "acord-29-evidence-of-flood",
  acord30: "acord-30-certificate-of-garage",
  acord31: "acord-31-certificate-of-marine-energy",
};

export type CertificateHolderRelationship =
  | "additional_insured"
  | "loss_payee"
  | "mortgagee"
  | "allowed_holder"
  | string;

export type CertificateCoverageLine = {
  type: string;
  insurerLetter?: string;
  coverageForm?: "occurrence" | "claims_made";
  typeNotes?: string;
  addlInsr?: boolean;
  subrWvd?: boolean;
  policyNumber?: string;
  effectiveDate?: string;
  expirationDate?: string;
  limits: Array<{ label: string; value: string }>;
  deductible?: string;
  sectionRef?: string;
  description?: string;
};

export type CertificateData = {
  formCode?: CertificateFormCode;
  title: string;
  issuedDateLabel: string;
  producerAgency?: string;
  producerContact?: string;
  producerLicense?: string;
  producerAddress?:
    | string
    | {
        street1?: string;
        street2?: string;
        city?: string;
        state?: string;
        zip?: string;
        country?: string;
      };
  producerPhone?: string;
  producerEmail?: string;
  insuranceCompanyAddress?: string;
  insuranceCompanyPhone?: string;
  insuredName: string;
  insuredDba?: string;
  insuredAddress?:
    | string
    | { street1?: string; city?: string; state?: string; zip?: string };
  insuredFein?: string;
  insurers: Array<{
    letter: string;
    name: string;
    naic?: string;
    amBest?: string;
    admitted?: string;
  }>;
  coverages: CertificateCoverageLine[];
  certificateNumber?: string;
  revisionNumber?: string;
  certificateHolder?: string;
  certificateHolderRelationship?: CertificateHolderRelationship;
  description?: string;
  propertyDescription?: string;
  propertyLocation?: string;
  interestHolder?: string;
  interestHolderRelationship?: string;
  floodZone?: string;
  floodProgram?: string;
};
