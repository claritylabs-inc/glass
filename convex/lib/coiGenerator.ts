"use node";

import PDFDocument from "pdfkit/js/pdfkit.standalone.js";
import { lobLabel, policyLobCodes } from "./linesOfBusiness";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * COI data interface mapping Glass's rich policy fields to ACORD 25 fields.
 * All monetary values should be pre-formatted strings (e.g. "$1,000,000").
 */
export interface CoiData {
  title: string;
  issuedDateLabel: string;

  // Producer / intermediary
  producerAgency?: string;
  producerContact?: string;
  producerLicense?: string;
  producerAddress?: string | { street1?: string; street2?: string; city?: string; state?: string; zip?: string; country?: string };
  producerPhone?: string;
  producerEmail?: string;

  // Insurance company
  insuranceCompanyAddress?: string;
  insuranceCompanyPhone?: string;

  // Insured
  insuredName: string;
  insuredDba?: string;
  insuredAddress?: string | { street1?: string; city?: string; state?: string; zip?: string };
  insuredFein?: string;

  // Insurer (ACORD 25 supports Insurers A–F; we map the primary policy insurer to A)
  insurers: Array<{
    letter: string; // "A" | "B" | ... | "F"
    name: string;
    naic?: string;
    amBest?: string;
    admitted?: string;
  }>;
  // Coverage rows — each maps to an ACORD 25 coverage section
  coverages: CoverageLine[];

  // Optional
  certificateNumber?: string;
  revisionNumber?: string;
  certificateHolder?: string;
  description?: string; // "Description of Operations / Locations / Vehicles"
}

/** One coverage section in the ACORD 25 grid. */
export interface CoverageLine {
  /** ACORD section label: "COMMERCIAL GENERAL LIABILITY", "AUTOMOBILE LIABILITY", etc. */
  type: string;
  /** Insurer letter reference (A–F) */
  insurerLetter?: string;
  /** "occurrence" | "claims_made" — for the CGL form type checkbox */
  coverageForm?: "occurrence" | "claims_made";
  /** Additional type notes (e.g. "CLAIMS MADE □  OCCUR □") */
  typeNotes?: string;
  /** Addl Insr endorsement on file */
  addlInsr?: boolean;
  /** Subrogation waiver */
  subrWvd?: boolean;
  policyNumber?: string;
  effectiveDate?: string;
  expirationDate?: string;
  /** Key/value limit pairs in ACORD 25 display order */
  limits: Array<{ label: string; value: string }>;
  deductible?: string;
  sectionRef?: string;
  description?: string;
}

// ─── Mapping helpers ──────────────────────────────────────────────────────────

/**
 * Map a Glass policy document to CoiData.
 * Produces one CoverageLine per detected coverage type.
 */

export function policyToCoiData(policy: any): CoiData {
  const profile = operationalProfile(policy);
  const limits: any = policy.limits ?? {};
  const profileLinesOfBusiness = Array.isArray(profile?.linesOfBusiness) && profile.linesOfBusiness.length > 0
    ? profile.linesOfBusiness
    : profile?.policyTypes;
  const policyTypes = policyLobCodes({
    linesOfBusiness: policy.linesOfBusiness,
    policyTypes: profileLinesOfBusiness?.length ? profileLinesOfBusiness : policy.policyTypes ?? [],
  });
  const declarations = declarationFieldMap(policy);
  const policyNumber = profileValue(profile?.policyNumber) ?? pickField(declarations, "policyNumber") ?? policy.policyNumber ?? "";
  const effDate = profileValue(profile?.effectiveDate) ?? pickField(declarations, "policyPeriodStart") ?? policy.effectiveDate ?? "";
  const expDate = profileValue(profile?.expirationDate) ?? pickField(declarations, "policyPeriodEnd") ?? policy.expirationDate ?? "";
  const coverageForm = policy.coverageForm ?? "occurrence";
  const producer = policy.producer ?? {};
  const producerName = joinLines(
    profileValue(profile?.broker) ?? pickField(declarations, "producerName") ?? producer.agencyName ?? policy.brokerAgency ?? policy.broker,
    pickField(declarations, "producerDBA"),
  );
  const producerAddress = joinLines(
    pickField(declarations, "producerAddressStreetSuite"),
    pickField(declarations, "producerAddressCityStateZip"),
  ) || producer.address;
  const insuranceCompanyAddress = joinLines(
    pickField(declarations, "insurerAddress1"),
    pickField(declarations, "insurerCityStateZip"),
  );
  const insuredAddress =
    joinLines(
      pickField(declarations, "masterPolicyHolderAndMailingAddressStreet")?.replace(/;$/, ""),
      pickField(declarations, "masterPolicyHolderAndMailingAddressCityStateZip"),
    ) || policy.insuredAddress;

  // Build insurer row for Insurer A
  const insurers = [{
    letter: "A",
    name: profileValue(profile?.insurer) ?? pickField(declarations, "insurerName") ?? policy.carrierLegalName ?? policy.insurer?.legalName ?? policy.security ?? policy.carrier ?? "N/A",
    naic: policy.carrierNaicNumber ?? policy.insurer?.naicNumber,
    amBest: policy.carrierAmBestRating,
    admitted: policy.carrierAdmittedStatus,
  }];

  const coverageLines: CoverageLine[] = buildCoverageLines(policyWithOperationalCoverages(policy, profile), {
    policyNumber,
    effectiveDate: effDate,
    expirationDate: expDate,
    coverageForm,
  });

  return {
    title: deriveCertificateTitle(),
    issuedDateLabel: "ISSUE DATE (YYYY/MM/DD)",
    producerAgency: producerName,
    producerContact: producer.contactName ?? policy.underwriter ?? policy.mga,
    producerLicense: producer.licenseNumber ?? policy.brokerLicenseNumber,
    producerAddress,
    producerPhone: producer.phone,
    producerEmail: producer.email,
    insuranceCompanyAddress,
    insuranceCompanyPhone: pickField(declarations, "insurerPhone"),
    insuredName: profileValue(profile?.namedInsured) ?? pickField(declarations, "masterPolicyHolderAndMailingAddressName")?.replace(/;$/, "") ?? policy.insuredName ?? "N/A",
    insuredDba: policy.insuredDba,
    insuredAddress,
    insuredFein: policy.insuredFein,
    insurers,
    coverages: coverageLines.length ? coverageLines : buildFallbackCoverageLines(policyTypes, limits, {
      policyNumber,
      effectiveDate: effDate,
      expirationDate: expDate,
      coverageForm,
    }),
    description: buildDescription(policyWithOperationalCoverages(policy, profile)),
  };
}

function operationalProfile(policy: any): any | undefined {
  return policy?.operationalProfile && typeof policy.operationalProfile === "object" && !Array.isArray(policy.operationalProfile)
    ? policy.operationalProfile
    : undefined;
}

function profileValue(value: any): string | undefined {
  return value && typeof value === "object" && typeof value.value === "string" && value.value.trim()
    ? value.value.trim()
    : undefined;
}

function policyWithOperationalCoverages(policy: any, profile: any | undefined): any {
  if (!Array.isArray(profile?.coverages) || profile.coverages.length === 0) return policy;
  return {
    ...policy,
    coverages: profile.coverages.map((coverage: any) => ({
      name: coverage.name,
      coverageCode: coverage.coverageCode,
      limit: coverage.limit,
      deductible: coverage.deductible,
      premium: coverage.premium,
      formNumber: coverage.formNumber,
      sectionRef: coverage.sectionRef,
      isOperationalProfileCoverage: true,
      documentNodeId: coverage.sourceNodeIds?.[0],
      sourceSpanIds: coverage.sourceSpanIds,
      originalContent: [coverage.name, coverage.limit, coverage.deductible, coverage.premium].filter(Boolean).join(" | "),
    })),
    supplementaryFacts: [
      ...(Array.isArray(policy.supplementaryFacts) ? policy.supplementaryFacts : []),
      ...(Array.isArray(profile.endorsementSupport)
        ? profile.endorsementSupport.map((item: any) => ({
            key: item.kind,
            value: item.summary,
            documentNodeId: item.sourceNodeIds?.[0],
            sourceSpanIds: item.sourceSpanIds,
          }))
        : []),
    ],
  };
}

function buildFallbackCoverageLines(
  policyTypes: string[],
  limits: any,
  defaults: {
    policyNumber: string;
    effectiveDate: string;
    expirationDate: string;
    coverageForm: string;
  },
): CoverageLine[] {
  const hasNamedPolicyType = policyTypes.some((t) => t !== "UN");
  const coverageLines: CoverageLine[] = [];

  // ── Commercial General Liability ──────────────────────────────────────────
  const hasGL = policyTypes.some((t) =>
    ["CGL", "GL", "BOP", "BOPGL"].includes(t)
  );
  if (hasGL || (!hasNamedPolicyType && (limits.perOccurrence || limits.generalAggregate))) {
    const glLimits: Array<{ label: string; value: string }> = [];
    if (limits.perOccurrence) glLimits.push({ label: "EACH OCCURRENCE", value: limits.perOccurrence });
    if (limits.fireDamage) glLimits.push({ label: "DAMAGE TO RENTED\nPREMISES (Ea occurrence)", value: limits.fireDamage });
    if (limits.medicalExpense) glLimits.push({ label: "MED EXP (Any one person)", value: limits.medicalExpense });
    if (limits.personalAdvertisingInjury) glLimits.push({ label: "PERSONAL & ADV INJURY", value: limits.personalAdvertisingInjury });
    if (limits.generalAggregate) glLimits.push({ label: "GENERAL AGGREGATE", value: limits.generalAggregate });
    if (limits.productsCompletedOpsAggregate) glLimits.push({ label: "PRODUCTS - COMP/OP AGG", value: limits.productsCompletedOpsAggregate });
    if (glLimits.length === 0 && limits.eachEmployee) glLimits.push({ label: "EACH EMPLOYEE", value: limits.eachEmployee });

    coverageLines.push({
      type: "COMMERCIAL GENERAL LIABILITY",
      insurerLetter: "A",
      coverageForm: defaults.coverageForm === "claims_made" ? "claims_made" : "occurrence",
      policyNumber: defaults.policyNumber,
      effectiveDate: defaults.effectiveDate,
      expirationDate: defaults.expirationDate,
      limits: glLimits,
    });
  }

  // ── Automobile Liability ──────────────────────────────────────────────────
  const hasAuto = policyTypes.some((t) =>
    ["AUTO", "AUTOB", "AUTOP", "GARAG", "TRUCK"].includes(t)
  );
  if (hasAuto || (!hasNamedPolicyType && (limits.combinedSingleLimit || limits.bodilyInjuryPerPerson))) {
    const autoLimits: Array<{ label: string; value: string }> = [];
    if (limits.combinedSingleLimit) autoLimits.push({ label: "COMBINED SINGLE LIMIT\n(Ea accident)", value: limits.combinedSingleLimit });
    if (limits.bodilyInjuryPerPerson) autoLimits.push({ label: "BODILY INJURY (Per person)", value: limits.bodilyInjuryPerPerson });
    if (limits.bodilyInjuryPerAccident) autoLimits.push({ label: "BODILY INJURY (Per accident)", value: limits.bodilyInjuryPerAccident });
    if (limits.propertyDamage) autoLimits.push({ label: "PROPERTY DAMAGE\n(Per accident)", value: limits.propertyDamage });

    const autoTypeNote = "ANY AUTO";

    coverageLines.push({
      type: "AUTOMOBILE LIABILITY",
      insurerLetter: "A",
      typeNotes: autoTypeNote,
      policyNumber: defaults.policyNumber,
      effectiveDate: defaults.effectiveDate,
      expirationDate: defaults.expirationDate,
      limits: autoLimits,
    });
  }

  // ── Umbrella / Excess Liability ───────────────────────────────────────────
  const hasUmbrella = policyTypes.some((t) => ["UMBRC", "UMBRL", "UMBRP", "EXLIA"].includes(t));
  if (hasUmbrella || (!hasNamedPolicyType && (limits.eachOccurrenceUmbrella || limits.umbrellaAggregate))) {
    const umbLimits: Array<{ label: string; value: string }> = [];
    if (limits.eachOccurrenceUmbrella) umbLimits.push({ label: "EACH OCCURRENCE", value: limits.eachOccurrenceUmbrella });
    if (limits.umbrellaAggregate) umbLimits.push({ label: "AGGREGATE", value: limits.umbrellaAggregate });
    if (limits.umbrellaRetention) umbLimits.push({ label: "DED  RETENTION", value: limits.umbrellaRetention });

    coverageLines.push({
      type: policyTypes.includes("EXLIA") ? "EXCESS LIAB" : "UMBRELLA LIAB",
      insurerLetter: "A",
      coverageForm: defaults.coverageForm === "claims_made" ? "claims_made" : "occurrence",
      policyNumber: defaults.policyNumber,
      effectiveDate: defaults.effectiveDate,
      expirationDate: defaults.expirationDate,
      limits: umbLimits,
    });
  }

  // ── Workers Compensation ──────────────────────────────────────────────────
  const hasWC = policyTypes.some((t) => ["WORK", "WCMA", "WORKP", "WORKV"].includes(t));
  if (hasWC || (!hasNamedPolicyType && (limits.statutory || limits.employersLiability))) {
    const el: any = limits.employersLiability ?? {};
    const wcLimits: Array<{ label: string; value: string }> = [];
    wcLimits.push({ label: "WC STAT", value: limits.statutory ? "✓" : "" });
    if (el.eachAccident) wcLimits.push({ label: "E.L. EACH ACCIDENT", value: el.eachAccident });
    if (el.diseaseEachEmployee) wcLimits.push({ label: "E.L. DISEASE - EA EMPLOYEE", value: el.diseaseEachEmployee });
    if (el.diseasePolicyLimit) wcLimits.push({ label: "E.L. DISEASE - POLICY LIMIT", value: el.diseasePolicyLimit });

    coverageLines.push({
      type: "WORKERS COMPENSATION\nAND EMPLOYERS' LIABILITY",
      insurerLetter: "A",
      policyNumber: defaults.policyNumber,
      effectiveDate: defaults.effectiveDate,
      expirationDate: defaults.expirationDate,
      limits: wcLimits,
    });
  }

  // Other lines of business (professional liability, other liability, etc.).
  const otherTypes = policyTypes.filter((t) =>
    !["CGL", "GL", "BOP", "BOPGL", "AUTO", "AUTOB", "AUTOP", "GARAG", "TRUCK",
      "UMBRC", "UMBRL", "UMBRP", "EXLIA", "WORK", "WCMA", "WORKP", "WORKV", "UN"].includes(t)
  );
  if (otherTypes.length > 0) {
    const typeLabel = otherTypes
      .map(lobLabel)
      .join(", ");
    coverageLines.push({
      type: typeLabel,
      insurerLetter: "A",
      coverageForm: defaults.coverageForm === "claims_made" ? "claims_made" : "occurrence",
      policyNumber: defaults.policyNumber,
      effectiveDate: defaults.effectiveDate,
      expirationDate: defaults.expirationDate,
      limits: buildOtherLimits(limits),
    });
  }

  // If no specific coverage lines were identified, add a generic one
  if (coverageLines.length === 0) {
    coverageLines.push({
      type: policyTypes.filter((t) => t !== "UN").map(lobLabel).join(" / ").toUpperCase() || "SEE POLICY",
      insurerLetter: "A",
      policyNumber: defaults.policyNumber,
      effectiveDate: defaults.effectiveDate,
      expirationDate: defaults.expirationDate,
      limits: flattenToLimitLines(limits),
    });
  }

  return coverageLines;
}

function deriveCertificateTitle(): string {
  return "CERTIFICATE OF INSURANCE";
}

function declarationFieldMap(policy: any): Map<string, string> {
  const fields = Array.isArray(policy.declarations?.fields) ? policy.declarations.fields : [];
  const map = new Map<string, string>();
  for (const field of fields) {
    if (typeof field?.field !== "string" || typeof field?.value !== "string") continue;
    const value = field.value.trim();
    if (value && !map.has(field.field)) map.set(field.field, value);
  }
  return map;
}

function pickField(fields: Map<string, string>, name: string): string | undefined {
  return fields.get(name);
}

function joinLines(...values: Array<string | undefined | null | false>): string | undefined {
  const parts = values
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter(Boolean);
  return parts.length ? parts.join("\n") : undefined;
}

function buildDescription(policy: any): string | undefined {
  const facts = Array.isArray(policy.supplementaryFacts) ? policy.supplementaryFacts : [];
  const operations = facts
    .map((fact: any) => typeof fact?.value === "string" ? fact.value.trim() : "")
    .filter((value: string) => /operations|location|additional insured|certificate holder/i.test(value))
    .slice(0, 2);
  return operations.length ? operations.join("\n") : undefined;
}

function buildCoverageLines(
  policy: any,
  defaults: {
    policyNumber: string;
    effectiveDate: string;
    expirationDate: string;
    coverageForm: string;
  },
): CoverageLine[] {
  const rawCoverages = Array.isArray(policy.coverages) ? policy.coverages : [];
  if (!rawCoverages.length) return [];

  const grouped = new Map<
    string,
    {
      limits: Array<{ label: string; value: string }>;
      deductible?: string;
      sectionRef?: string;
      description?: string;
    }
  >();
  for (const coverage of rawCoverages) {
    const group = coverage.isOperationalProfileCoverage
      ? titleCase(String(coverage.name ?? coverage.type ?? "Coverage"))
      : coverageGroupName(coverage.name ?? coverage.type ?? "");
    const row = grouped.get(group) ?? { limits: [] };
    const value = formatMoneyLike(coverage.limit);
    const label = coverageLimitLabel(coverage);
    if (value) {
      const key = `${label}:${value}`;
      if (!row.limits.some((item) => `${item.label}:${item.value}` === key)) {
        row.limits.push({ label, value });
      }
    }
    const deductible = formatMoneyLike(coverage.deductible);
    if (deductible && !row.deductible) {
      row.deductible = deductible;
      const key = `Deductible:${deductible}`;
      if (!row.limits.some((item) => `${item.label}:${item.value}` === key)) {
        row.limits.push({ label: "Deductible", value: deductible });
      }
    }
    if (!row.sectionRef && coverage.sectionRef) row.sectionRef = String(coverage.sectionRef);
    if (!row.description) {
      row.description = String(
        coverage.originalContent ?? coverage.description ?? coverage.content ?? "",
      ).trim();
    }
    if (row.limits.length > 0 || row.deductible || row.description || row.sectionRef) {
      grouped.set(group, row);
    }
  }

  return Array.from(grouped.entries())
    .map(([type, row]) => ({
      type,
      insurerLetter: "A",
      coverageForm: defaults.coverageForm === "claims_made" ? "claims_made" as const : "occurrence" as const,
      policyNumber: defaults.policyNumber,
      effectiveDate: defaults.effectiveDate,
      expirationDate: defaults.expirationDate,
      limits: row.limits.slice(0, 8),
      deductible: row.deductible,
      sectionRef: row.sectionRef,
      description: row.description,
    }))
    .slice(0, 5);
}

function coverageGroupName(name: string): string {
  const normalized = name.toLowerCase();
  if (/cyber|network|privacy|social engineering|selling away/.test(normalized)) return "Cyber Liability";
  if (/employment|epli|employee practices/.test(normalized)) return "Employment Practices Liability";
  if (/professional|agent|broker|dealer|errors|omissions/.test(normalized)) return "Professional Liability";
  return titleCase(name.replace(/\s*-\s*(limit of liability|deductible).*$/i, "")) || "Coverage";
}

function coverageLimitLabel(coverage: any): string {
  const name = String(coverage.name ?? coverage.type ?? "Limit")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s*-\s*Limit of Liability.*$/i, "")
    .replace(/\s*Limit of Liability\s*/i, "")
    .replace(/\s*Deductible\s*/i, "Deductible")
    .replace(/\s+/g, " ")
    .trim();
  const limitType = String(coverage.limitType ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  if (/deductible/i.test(name)) return name;
  return [name, limitType].filter(Boolean).join(" - ") || "Limit";
}

function formatMoneyLike(value: unknown): string | undefined {
  if (value == null) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;
  if (/^\$/.test(raw)) return raw;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    return `$${Number(raw).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  return raw;
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function buildOtherLimits(limits: any): Array<{ label: string; value: string }> {
  const result: Array<{ label: string; value: string }> = [];
  if (limits.perOccurrence) result.push({ label: "EACH CLAIM / OCCURRENCE", value: limits.perOccurrence });
  if (limits.generalAggregate) result.push({ label: "AGGREGATE", value: limits.generalAggregate });
  if (limits.combinedSingleLimit) result.push({ label: "LIMIT", value: limits.combinedSingleLimit });
  return result;
}

function flattenToLimitLines(limits: any): Array<{ label: string; value: string }> {
  const result: Array<{ label: string; value: string }> = [];
  const labelMap: Record<string, string> = {
    perOccurrence: "EACH OCCURRENCE",
    generalAggregate: "AGGREGATE",
    combinedSingleLimit: "COMBINED SINGLE LIMIT",
    productsCompletedOpsAggregate: "PRODUCTS - COMP/OP AGG",
    personalAdvertisingInjury: "PERSONAL & ADV INJURY",
    fireDamage: "DAMAGE TO RENTED PREMISES",
    medicalExpense: "MED EXP",
    bodilyInjuryPerPerson: "BODILY INJURY (Per person)",
    bodilyInjuryPerAccident: "BODILY INJURY (Per accident)",
    propertyDamage: "PROPERTY DAMAGE",
    eachOccurrenceUmbrella: "EACH OCCURRENCE",
    umbrellaAggregate: "AGGREGATE",
  };
  for (const [key, label] of Object.entries(labelMap)) {
    if (limits[key] && typeof limits[key] === "string") {
      result.push({ label, value: limits[key] as string });
    }
  }
  return result;
}

function formatAddress(
  addr: string | { street1?: string; street2?: string; city?: string; state?: string; zip?: string; country?: string } | undefined | null,
): string {
  if (!addr) return "";
  if (typeof addr === "string") return addr;
  const parts = [
    addr.street1,
    addr.street2,
    [addr.city, addr.state && addr.zip ? `${addr.state} ${addr.zip}` : (addr.state ?? addr.zip)].filter(Boolean).join(", "),
    addr.country,
  ];
  return parts.filter(Boolean).join("\n");
}

// ─── PDF Generation ───────────────────────────────────────────────────────────

const PAGE_W = 612;
const M = 30;          // left/right margin
const W = PAGE_W - 2 * M;  // 552pt usable width

// Font sizes
const FS_LABEL = 6.5;
const FS_VALUE = 8;
const FS_SMALL = 6;
const FS_DISCLAIMER = 5.5;

// Colors
const C_BLACK = "#000000";
const C_LIGHT_GRAY = "#9ca3af";
const C_HEADER_BG = "#d0d0d0";
const C_LABEL_BG = "#e8e8e8";
const GLASS_GLOBE_PATH =
  "M31.1839 0H33.7892C33.7984 0.00163511 33.8076 0.00327022 33.8168 0.00490534C35.7548 0.103479 37.6654 0.343031 39.5637 0.756107C47.2996 2.48727 54.1398 6.97839 58.8034 13.3888C61.8198 17.5301 63.8104 22.3281 64.6122 27.3885C64.7439 28.1992 64.8423 29.015 64.907 29.8338C64.9314 30.1443 64.9549 30.873 65 31.1436V33.8838C64.9343 34.504 64.9168 35.1609 64.8518 35.7998C64.709 37.0884 64.5017 38.3687 64.2307 39.6364C62.6136 46.7854 58.6333 53.1803 52.9331 57.7875C48.8608 61.0864 44.0473 63.3455 38.908 64.3703C37.9425 64.5626 36.9691 64.7137 35.9909 64.8235C35.6881 64.8565 34.4008 64.9499 34.204 65H30.7301C30.435 64.9295 29.5167 64.8727 29.1607 64.8346C28.2788 64.7448 27.4013 64.616 26.5308 64.4487C21.7957 63.5756 17.3165 61.6519 13.4231 58.8193C7.00216 54.1649 2.50137 47.3265 0.766127 39.5884C0.345341 37.6771 0.106663 35.7729 0.00478197 33.8248C0.00318798 33.8159 0.00159399 33.8073 0 33.7984V31.2061C0.0720288 30.9269 0.0875815 29.9317 0.115877 29.5899C0.193066 28.7192 0.307883 27.8523 0.460005 26.9916C1.32508 21.9138 3.39165 17.1164 6.48737 12.9994C11.1318 6.80142 17.8355 2.4641 25.3926 0.767676C26.9685 0.426121 28.6008 0.184783 30.2088 0.0716999C30.5151 0.0501601 30.8518 0.0500306 31.1532 0.004891L31.1839 0ZM19.7861 19.7919C19.5136 21.1315 19.273 22.4775 19.0646 23.8286C18.3129 29.0375 18.2464 34.3224 18.8669 39.5488C19.1155 41.7139 19.5523 44.3961 20.1022 46.5156C24.3291 47.3313 28.499 47.8328 32.8114 47.7915C33.6004 47.7839 34.3979 47.7382 35.1844 47.736C36.8653 47.5931 38.3894 47.5208 40.0966 47.3161C42.1532 47.0495 44.1956 46.6819 46.216 46.2144C47.6884 39.5078 48.1958 33.1157 47.4583 26.2705C47.2402 24.2463 46.9523 22.0642 46.5058 20.0795C42.5972 19.1519 38.6061 18.6144 34.5912 18.4747C33.4598 18.4339 32.1725 18.4032 31.0377 18.4553C27.8976 18.5347 24.7684 18.857 21.6781 19.4194C21.1033 19.5278 20.3348 19.6515 19.7861 19.7919ZM25.3374 4.56708C23.9751 7.13654 22.8051 9.80342 21.8368 12.5457C21.5941 13.2294 21.3756 13.9445 21.1476 14.6342C21.0244 15.007 20.9145 15.5026 20.7788 15.8537C24.4615 15.1073 28.651 14.7912 32.4 14.7844C33.2389 14.7829 34.5408 14.769 35.3485 14.8499C37.627 14.8983 39.7773 15.1637 42.0221 15.4831C42.8489 15.5925 43.6716 15.7305 44.4888 15.8968C44.7916 15.9562 45.234 16.0326 45.5219 16.1151C44.665 13.0635 43.5598 10.0872 42.217 7.21608C41.9523 6.64949 41.4115 5.48282 41.0916 4.97155C40.685 4.81771 40.1537 4.69155 39.7271 4.57945C37.3417 3.95614 34.8842 3.65187 32.4184 3.67456C32.0354 3.67472 31.4734 3.66184 31.1019 3.69751C29.2399 3.80612 27.138 4.07116 25.3374 4.56708ZM6.37482 20.3486C6.76584 20.2134 7.19447 19.984 7.58418 19.823C8.26627 19.5414 8.96245 19.2398 9.65247 18.9819C11.4942 18.2806 13.366 17.6609 15.2624 17.1245C15.7537 16.9822 16.2521 16.8786 16.7333 16.742C17.6046 13.5679 18.5257 10.4937 19.8717 7.47821C19.9434 7.3177 20.3434 6.45588 20.3373 6.3494C19.4564 6.77828 18.6777 7.16796 17.8311 7.67232C13.8325 10.0484 10.4621 13.3489 8.00262 17.2968C7.44507 18.2006 6.78787 19.3442 6.37209 20.3168L6.37482 20.3486ZM60.0107 41.1046C60.1713 40.752 60.4059 39.7592 60.5103 39.3453C61.3996 35.6846 61.5669 31.8859 61.0029 28.1613C60.8785 27.3011 60.6877 26.1877 60.4338 25.3539C59.8105 24.917 58.7936 24.5139 58.0931 24.161C55.6274 22.9192 53.0582 22.0531 50.4566 21.1611C51.6385 27.7058 51.7867 34.3954 50.8958 40.9862C50.7194 42.2944 50.4997 43.8391 50.2014 45.1353C52.4335 44.4587 55.2383 43.4135 57.3523 42.4087C58.1509 42.037 59.2471 41.5419 60.0107 41.1046ZM20.3735 58.665C19.9852 57.718 19.5704 56.8172 19.1829 55.8476C18.5607 54.268 18.0044 52.6633 17.5154 51.0374C17.3813 50.588 17.1915 50.0141 17.0829 49.5669C13.8915 48.8211 10.7625 47.7179 7.74125 46.4629C7.5413 46.3801 7.33345 46.2798 7.13207 46.2052C9.53469 50.6391 13.0529 54.3689 17.3388 57.0264C18.0358 57.4634 19.6146 58.3642 20.3735 58.665ZM58.6727 20.3657C58.2458 19.5111 57.8662 18.7418 57.378 17.9112C55.3684 14.5014 52.6846 11.5374 49.4901 9.20051C48.5643 8.52322 47.2243 7.6362 46.202 7.13229C47.4897 9.97639 48.8741 14.0345 49.5765 17.0852C51.548 17.6071 53.9237 18.4172 55.8238 19.1709C56.3948 19.3991 56.9632 19.6343 57.5288 19.8764C57.8252 20.0065 58.3864 20.2764 58.6727 20.3657ZM49.2451 49.2467C48.492 51.8657 47.6801 54.4229 46.6102 56.935C46.5489 57.0784 46.2325 57.7478 46.2401 57.8468L46.2468 57.8535C50.4153 55.5118 53.9262 52.4002 56.5592 48.3898C56.7284 48.1321 57.824 46.4172 57.8373 46.2274L57.8262 46.216C55.7861 47.1488 53.5933 47.9042 51.4604 48.5945C50.7517 48.8236 49.9307 49.0074 49.2451 49.2467ZM45.0633 50.2233C44.1226 50.3788 43.2021 50.58 42.2535 50.7181C37.229 51.4887 32.1309 51.6598 27.0662 51.2278C25.6436 51.0974 24.2247 50.9291 22.811 50.7235C22.3015 50.6505 21.65 50.5064 21.1655 50.4559C21.7651 52.2364 22.3537 54.0103 23.1056 55.7356C23.3327 56.2564 23.7126 57.1911 23.9735 57.6783C24.3129 58.4048 24.9426 59.7781 25.3536 60.4392C29.7579 61.5551 34.3621 61.6256 38.7985 60.6449C39.4002 60.5084 40.5165 60.2326 41.0938 60.0266C41.4724 59.376 41.9221 58.4095 42.2421 57.723C43.2342 55.6001 44.0934 53.4174 44.8148 51.1878C44.8751 50.9952 45.1039 50.3617 45.1134 50.2271L45.0633 50.2233ZM7.96526 42.561C8.50459 42.7803 9.03874 43.0333 9.5816 43.258C10.6311 43.6938 11.6932 44.0984 12.7665 44.472C13.908 44.8741 15.006 45.1591 16.1115 45.5251C14.9091 39.7224 14.5106 33.7822 14.9273 27.8709C15.0112 26.7461 15.1248 25.6236 15.2679 24.5047C15.3159 24.1381 15.828 20.8417 15.8094 20.7949C12.746 21.6716 9.76104 22.8023 6.88565 24.1753C6.3122 24.4456 5.08298 25.0183 4.56666 25.349C3.61017 29.106 3.41948 33.017 4.00604 36.8491C4.20072 38.1751 4.5547 39.8242 4.97447 41.1058C5.68899 41.4686 6.40377 41.8422 7.13302 42.1738C7.37039 42.2817 7.73246 42.4715 7.96526 42.561Z";

/**
 * Generate an ACORD 25-style Certificate of Liability Insurance PDF.
 * Returns a Buffer.
 */
export async function generateCoiPdf(data: CoiData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "LETTER", margin: 0, autoFirstPage: true });

    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let y = 24;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "/");

    doc.font("Helvetica-Bold").fontSize(12).fillColor(C_BLACK);
    doc.text(data.title, M, y, { width: W * 0.58 });
    doc.font("Helvetica-Bold").fontSize(FS_LABEL);
    doc.text(data.issuedDateLabel, M + W * 0.72, y, { width: W * 0.28, align: "right" });
    doc.font("Helvetica").fontSize(FS_VALUE);
    doc.text(dateStr, M + W * 0.72, y + 10, { width: W * 0.28, align: "right" });
    y += 30;

    const topW = W * 0.52;
    const rightW = W - topW;
    const insurerAddress = joinLines(data.insurers[0]?.name, data.insuranceCompanyAddress, data.insuranceCompanyPhone && `Phone: ${data.insuranceCompanyPhone}`);
    drawInfoBox(doc, M, y, topW, 80, "INSURANCE COMPANY AND MAILING ADDRESS", insurerAddress);
    drawNoticeAndCompanies(doc, M + topW, y, rightW, 80, data);
    y += 80;

    const insuredText = joinLines(data.insuredName, data.insuredDba && `DBA: ${data.insuredDba}`, formatAddress(data.insuredAddress), data.insuredFein && `FEIN: ${data.insuredFein}`);
    const producerText = joinLines(
      data.producerAgency,
      formatAddress(data.producerAddress),
      data.producerContact && `Contact: ${data.producerContact}`,
      data.producerPhone && `Phone: ${data.producerPhone}`,
      data.producerEmail && `Email: ${data.producerEmail}`,
    );
    const partyH = Math.max(68, textBlockHeight(doc, insuredText, topW - 10, FS_VALUE, true) + 18, textBlockHeight(doc, producerText, rightW - 10, FS_LABEL, false) + 18);
    drawInfoBox(doc, M, y, topW, partyH, "INSURED'S FULL NAME AND MAILING ADDRESS", insuredText);
    drawInfoBox(doc, M + topW, y, rightW, partyH, "PRODUCER / CONTACT", producerText);
    y += partyH + 10;

    const coveragesTop = y;
    doc.rect(M, y, W, 16).fillAndStroke(C_HEADER_BG, C_BLACK);
    doc.font("Helvetica-Bold").fontSize(FS_LABEL).fillColor(C_BLACK);
    doc.text("COVERAGES", M + 4, y + 4, { width: W - 8, align: "center" });
    y += 16;

    doc.font("Helvetica").fontSize(FS_DISCLAIMER).fillColor(C_BLACK);
    const coverageNotice =
      "This is to certify that the policies of insurance listed below have been issued to the insured named above for the policy period indicated. The insurance afforded by the policies described herein is subject to all the terms, exclusions and conditions of such policies. Limits shown may have been reduced by paid claims.";
    const noticeH = doc.heightOfString(coverageNotice, { width: W - 8 }) + 8;
    doc.rect(M, y, W, noticeH).stroke();
    doc.text(coverageNotice, M + 4, y + 4, { width: W - 8 });
    y += noticeH;

    y = drawCoverageTable(doc, data.coverages, y);
    doc.rect(M, coveragesTop, W, y - coveragesTop).strokeColor(C_BLACK).stroke();

    const descText = data.description ?? "";
    const descH = Math.max(44, textBlockHeight(doc, descText, W - 10, FS_LABEL, false) + 18);
    drawInfoBox(doc, M, y, W, descH, "DESCRIPTION OF OPERATIONS / LOCATIONS / SPECIAL ITEMS / ADDITIONAL INSURED", descText);
    y += descH;

    const bottomW = W * 0.46;
    const cancelText = "Should any of the above described policies be cancelled before the expiration date thereof, notice will be delivered in accordance with the policy provisions.";
    const bottomH = Math.max(70, textBlockHeight(doc, data.certificateHolder ?? "", bottomW - 10, FS_VALUE, false) + 18, textBlockHeight(doc, cancelText, W - bottomW - 10, FS_DISCLAIMER, false) + 34);
    drawInfoBox(doc, M, y, bottomW, bottomH, "CERTIFICATE HOLDER", data.certificateHolder ?? "");
    drawInfoBox(doc, M + bottomW, y, W - bottomW, bottomH, "CANCELLATION", cancelText);
    sectionLabel(doc, "AUTHORIZED REPRESENTATIVE", M + bottomW + 5, y + bottomH - 16);
    y += bottomH + 6;

    drawGeneratedUsingLockup(doc, M, y, W);

    doc.end();
  });
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

function drawInfoBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value?: string,
) {
  doc.rect(x, y, w, h).stroke();
  sectionLabel(doc, label, x + 4, y + 4);
  if (!value) return;
  doc.font("Helvetica").fontSize(FS_VALUE).fillColor(C_BLACK);
  doc.text(value, x + 5, y + 16, { width: w - 10, height: h - 20 });
}

function drawNoticeAndCompanies(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  data: CoiData,
) {
  doc.rect(x, y, w, h).stroke();
  const notice =
    "THIS CERTIFICATE IS ISSUED AS A MATTER OF INFORMATION ONLY AND CONFERS NO RIGHTS UPON THE CERTIFICATE HOLDER. This certificate does not amend, extend, alter or certify the coverage afforded by the policies below.";
  doc.font("Helvetica").fontSize(FS_DISCLAIMER).fillColor(C_BLACK);
  doc.text(notice, x + 5, y + 5, { width: w - 10, height: 30 });

  const rowY = y + 38;
  for (let i = 0; i < 5; i++) {
    const letter = String.fromCharCode(65 + i);
    const rowTop = rowY + i * 8;
    doc.font("Helvetica-Bold").fontSize(FS_SMALL).fillColor(C_BLACK);
    doc.text(`COMPANY ${letter}`, x + 5, rowTop, { width: 44 });
    const insurer = data.insurers.find((ins) => ins.letter === letter);
    if (insurer) {
      doc.font("Helvetica").fontSize(FS_LABEL).fillColor(C_BLACK);
      doc.text(insurer.name, x + 54, rowTop, { width: w - 88, height: 8 });
      if (insurer.naic) {
        doc.font("Helvetica-Bold").fontSize(FS_SMALL);
        doc.text(insurer.naic, x + w - 30, rowTop, { width: 25, align: "right" });
      }
    }
  }
}

function drawCoverageTable(doc: PDFKit.PDFDocument, coverages: CoverageLine[], y: number): number {
  const columns = [
    { key: "type", label: "TYPE OF INSURANCE", w: 156 },
    { key: "letter", label: "CO\nLTR", w: 28 },
    { key: "policy", label: "POLICY NUMBER", w: 95 },
    { key: "effective", label: "POLICY EFFECTIVE\nDATE", w: 66 },
    { key: "expiration", label: "POLICY EXPIRATION\nDATE", w: 66 },
    { key: "limits", label: "LIMITS OF LIABILITY", w: W - 156 - 28 - 95 - 66 - 66 },
  ];
  const headerH = 24;
  let x = M;
  doc.rect(M, y, W, headerH).fillAndStroke(C_LABEL_BG, C_BLACK);
  doc.font("Helvetica-Bold").fontSize(FS_SMALL).fillColor(C_BLACK);
  for (const col of columns) {
    doc.rect(x, y, col.w, headerH).stroke();
    doc.text(col.label, x + 3, y + 5, { width: col.w - 6, align: "center" });
    x += col.w;
  }
  y += headerH;

  for (const coverage of coverages) {
    const limitsText = coverage.limits.map((limit) => `${limit.label}: ${limit.value}`).join("\n");
    const typeText = joinLines(
      coverage.type,
      coverage.coverageForm === "claims_made" ? "Claims-made" : coverage.coverageForm === "occurrence" ? "Occurrence" : undefined,
      coverage.typeNotes,
    ) ?? coverage.type;
    const rowH = Math.max(
      34,
      textBlockHeight(doc, typeText, columns[0].w - 6, FS_LABEL, true) + 8,
      textBlockHeight(doc, limitsText, columns[5].w - 6, FS_SMALL, false) + 8,
    );
    x = M;
    for (const col of columns) {
      doc.rect(x, y, col.w, rowH).stroke();
      x += col.w;
    }

    x = M;
    doc.font("Helvetica-Bold").fontSize(FS_LABEL).fillColor(C_BLACK);
    doc.text(typeText, x + 3, y + 4, { width: columns[0].w - 6, height: rowH - 8 });
    x += columns[0].w;
    doc.font("Helvetica").fontSize(FS_LABEL).fillColor(C_BLACK);
    doc.text(coverage.insurerLetter ?? "A", x + 3, y + 4, { width: columns[1].w - 6, align: "center" });
    x += columns[1].w;
    doc.text(coverage.policyNumber ?? "", x + 3, y + 4, { width: columns[2].w - 6, height: rowH - 8 });
    x += columns[2].w;
    doc.text(coverage.effectiveDate ?? "", x + 3, y + 4, { width: columns[3].w - 6, align: "center" });
    x += columns[3].w;
    doc.text(coverage.expirationDate ?? "", x + 3, y + 4, { width: columns[4].w - 6, align: "center" });
    x += columns[4].w;
    doc.font("Helvetica").fontSize(FS_SMALL).fillColor(C_BLACK);
    doc.text(limitsText, x + 3, y + 4, { width: columns[5].w - 6, height: rowH - 8 });
    y += rowH;
  }

  return y;
}

function textBlockHeight(
  doc: PDFKit.PDFDocument,
  value: string | undefined,
  width: number,
  fontSize: number,
  bold: boolean,
): number {
  if (!value) return 0;
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
  return doc.heightOfString(value, { width });
}

function drawGeneratedUsingLockup(doc: PDFKit.PDFDocument, x: number, y: number, width: number) {
  const prefix = "Generated using";
  const glass = "Glass";
  const suffix = "from Clarity Labs";
  const iconSize = 7.5;
  const gap = 3.5;
  const fontSize = FS_SMALL;

  doc.font("Helvetica").fontSize(fontSize);
  const prefixW = doc.widthOfString(prefix);
  doc.font("Helvetica-Bold").fontSize(fontSize);
  const glassW = doc.widthOfString(glass);
  doc.font("Helvetica").fontSize(fontSize);
  const suffixW = doc.widthOfString(suffix);
  const totalW = prefixW + gap + iconSize + gap + glassW + gap + suffixW;
  let cursor = x + (width - totalW) / 2;

  doc.font("Helvetica").fontSize(fontSize).fillColor(C_LIGHT_GRAY);
  doc.text(prefix, cursor, y, { width: prefixW, lineBreak: false });
  cursor += prefixW + gap;

  drawGlassIcon(doc, cursor, y + (doc.currentLineHeight() - iconSize) / 2 - 0.25, iconSize);
  cursor += iconSize + gap;

  doc.font("Helvetica-Bold").fontSize(fontSize).fillColor(C_BLACK);
  doc.text(glass, cursor, y, { width: glassW, lineBreak: false });
  cursor += glassW + gap;

  doc.font("Helvetica").fontSize(fontSize).fillColor(C_LIGHT_GRAY);
  doc.text(suffix, cursor, y, { width: suffixW, lineBreak: false });
}

function drawGlassIcon(doc: PDFKit.PDFDocument, x: number, y: number, size: number) {
  doc.save();
  doc.translate(x, y);
  doc.scale(size / 65);
  doc.lineWidth(1.25).strokeColor(C_BLACK).fillColor(C_BLACK);
  doc.circle(32.5, 32.5, 31).stroke();
  doc.path(GLASS_GLOBE_PATH).fill();
  doc.restore();
}

function sectionLabel(doc: PDFKit.PDFDocument, text: string, x: number, y: number) {
  doc.font("Helvetica-Bold").fontSize(FS_SMALL).fillColor(C_BLACK);
  doc.text(text, x, y);
}
