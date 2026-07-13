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
  acord25: "Certificate of Liability Insurance",
  acord24: "Certificate of Property Insurance",
  acord27: "Evidence of Property Insurance",
  acord28: "Evidence of Commercial Property Insurance",
  acord29: "Evidence of Flood Insurance",
  acord30: "Certificate of Garage Insurance",
  acord31: "Certificate of Marine / Energy Insurance",
};

export const CERTIFICATE_FORM_FILE_SLUGS: Record<CertificateFormCode, string> = {
  acord25: "certificate-of-liability",
  acord24: "certificate-of-property",
  acord27: "evidence-of-property",
  acord28: "evidence-of-commercial-property",
  acord29: "evidence-of-flood",
  acord30: "certificate-of-garage",
  acord31: "certificate-of-marine-energy",
};

export type CertificateHolderRelationship =
  | "additional_insured"
  | "loss_payee"
  | "mortgagee"
  | "allowed_holder"
  | string;

export type CertificateCoverageLine = {
  type: string;
  lineOfBusiness?: string;
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
    | {
        street1?: string;
        street2?: string;
        city?: string;
        state?: string;
        zip?: string;
        country?: string;
        formatted?: string;
      };
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
