"use node";

import dayjs from "dayjs";
import PDFDocument from "pdfkit/js/pdfkit.standalone.js";
import {
  CERTIFICATE_FORM_LABELS,
  type CertificateFormCode,
  type CertificateHolderRelationship,
} from "./acordForms/types";
import { lobLabel, policyLobCodes } from "./linesOfBusiness";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * COI data interface mapping Glass's rich policy fields to ACORD 25 fields.
 * All monetary values should be pre-formatted strings (e.g. "$1,000,000").
 */
export interface CoiData {
  formCode?: CertificateFormCode;
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
  certificateHolderRelationship?: CertificateHolderRelationship;
  description?: string; // "Description of Operations / Locations / Vehicles"
  propertyDescription?: string;
  propertyLocation?: string;
  interestHolder?: string;
  interestHolderRelationship?: string;
  floodZone?: string;
  floodProgram?: string;
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
    : undefined;
  const linesOfBusiness = policyLobCodes({
    linesOfBusiness: profileLinesOfBusiness?.length ? profileLinesOfBusiness : policy.linesOfBusiness,
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
    coverages: coverageLines.length ? coverageLines : buildFallbackCoverageLines(linesOfBusiness, limits, {
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
  lobCodes: string[],
  limits: any,
  defaults: {
    policyNumber: string;
    effectiveDate: string;
    expirationDate: string;
    coverageForm: string;
  },
): CoverageLine[] {
  const hasNamedLobCode = lobCodes.some((code) => code !== "UN");
  const coverageLines: CoverageLine[] = [];

  // ── Commercial General Liability ──────────────────────────────────────────
  const hasGL = lobCodes.some((code) =>
    ["CGL", "GL", "BOP", "BOPGL"].includes(code)
  );
  if (hasGL || (!hasNamedLobCode && (limits.perOccurrence || limits.generalAggregate))) {
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
  const hasAuto = lobCodes.some((code) =>
    ["AUTO", "AUTOB", "AUTOP", "GARAG", "TRUCK"].includes(code)
  );
  if (hasAuto || (!hasNamedLobCode && (limits.combinedSingleLimit || limits.bodilyInjuryPerPerson))) {
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
  const hasUmbrella = lobCodes.some((code) => ["UMBRC", "UMBRL", "UMBRP", "EXLIA"].includes(code));
  if (hasUmbrella || (!hasNamedLobCode && (limits.eachOccurrenceUmbrella || limits.umbrellaAggregate))) {
    const umbLimits: Array<{ label: string; value: string }> = [];
    if (limits.eachOccurrenceUmbrella) umbLimits.push({ label: "EACH OCCURRENCE", value: limits.eachOccurrenceUmbrella });
    if (limits.umbrellaAggregate) umbLimits.push({ label: "AGGREGATE", value: limits.umbrellaAggregate });
    if (limits.umbrellaRetention) umbLimits.push({ label: "DED  RETENTION", value: limits.umbrellaRetention });

    coverageLines.push({
      type: lobCodes.includes("EXLIA") ? "EXCESS LIAB" : "UMBRELLA LIAB",
      insurerLetter: "A",
      coverageForm: defaults.coverageForm === "claims_made" ? "claims_made" : "occurrence",
      policyNumber: defaults.policyNumber,
      effectiveDate: defaults.effectiveDate,
      expirationDate: defaults.expirationDate,
      limits: umbLimits,
    });
  }

  // ── Workers Compensation ──────────────────────────────────────────────────
  const hasWC = lobCodes.some((code) => ["WORK", "WCMA", "WORKP", "WORKV"].includes(code));
  if (hasWC || (!hasNamedLobCode && (limits.statutory || limits.employersLiability))) {
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
  const otherCodes = lobCodes.filter((code) =>
    !["CGL", "GL", "BOP", "BOPGL", "AUTO", "AUTOB", "AUTOP", "GARAG", "TRUCK",
      "UMBRC", "UMBRL", "UMBRP", "EXLIA", "WORK", "WCMA", "WORKP", "WORKV", "UN"].includes(code)
  );
  if (otherCodes.length > 0) {
    const typeLabel = otherCodes
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
      type: lobCodes.filter((code) => code !== "UN").map(lobLabel).join(" / ").toUpperCase() || "SEE POLICY",
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
  return "CERTIFICATE OF LIABILITY INSURANCE";
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
const C_HEADER_BG = "#d0d0d0";
const C_LABEL_BG = "#e8e8e8";
const ACORD_25_INFORMATION_NOTICE =
  "THIS CERTIFICATE IS ISSUED AS A MATTER OF INFORMATION ONLY AND CONFERS NO RIGHTS UPON THE CERTIFICATE HOLDER. THIS CERTIFICATE DOES NOT AFFIRMATIVELY OR NEGATIVELY AMEND, EXTEND OR ALTER THE COVERAGE AFFORDED BY THE POLICIES BELOW. THIS CERTIFICATE OF INSURANCE DOES NOT CONSTITUTE A CONTRACT BETWEEN THE ISSUING INSURER(S), AUTHORIZED REPRESENTATIVE OR PRODUCER, AND THE CERTIFICATE HOLDER.";
const ACORD_25_COVERAGE_NOTICE =
  "THIS IS TO CERTIFY THAT THE POLICIES OF INSURANCE LISTED BELOW HAVE BEEN ISSUED TO THE INSURED NAMED ABOVE FOR THE POLICY PERIOD INDICATED. NOTWITHSTANDING ANY REQUIREMENT, TERM OR CONDITION OF ANY CONTRACT OR OTHER DOCUMENT WITH RESPECT TO WHICH THIS CERTIFICATE MAY BE ISSUED OR MAY PERTAIN, THE INSURANCE AFFORDED BY THE POLICIES DESCRIBED HEREIN IS SUBJECT TO ALL THE TERMS, EXCLUSIONS AND CONDITIONS OF SUCH POLICIES. LIMITS SHOWN MAY HAVE BEEN REDUCED BY PAID CLAIMS.";

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
    if (data.formCode && data.formCode !== "acord25") {
      drawAcordPropertyEvidenceForm(doc, data);
      doc.end();
      return;
    }

    const dateStr = dayjs().format("YYYY/MM/DD");

    doc.font("Helvetica-Bold").fontSize(12).fillColor(C_BLACK);
    doc.text("CERTIFICATE OF LIABILITY INSURANCE", M, y, { width: W * 0.58 });
    doc.font("Helvetica-Bold").fontSize(FS_LABEL);
    doc.text(data.issuedDateLabel, M + W * 0.72, y, { width: W * 0.28, align: "right" });
    doc.font("Helvetica").fontSize(FS_VALUE);
    doc.text(dateStr, M + W * 0.72, y + 10, { width: W * 0.28, align: "right" });
    y += 30;

    y += drawAcord25InformationNotice(doc, M, y, W);

    const insuredText = joinLines(data.insuredName, data.insuredDba && `DBA: ${data.insuredDba}`, formatAddress(data.insuredAddress), data.insuredFein && `FEIN: ${data.insuredFein}`);
    const producerText = joinLines(
      data.producerAgency,
      formatAddress(data.producerAddress),
      data.producerContact && `Contact: ${data.producerContact}`,
      data.producerPhone && `Phone: ${data.producerPhone}`,
      data.producerEmail && `Email: ${data.producerEmail}`,
    );
    const topW = W * 0.52;
    const rightW = W - topW;
    const topH = Math.max(76, textBlockHeight(doc, producerText, topW - 10, FS_LABEL, false) + 18);
    drawInfoBox(doc, M, y, topW, topH, "PRODUCER", producerText);
    drawInsurerLegend(doc, M + topW, y, rightW, topH, data);
    y += topH;

    const insuredH = Math.max(58, textBlockHeight(doc, insuredText, W - 10, FS_VALUE, true) + 18);
    drawInfoBox(doc, M, y, W, insuredH, "INSURED'S FULL NAME AND MAILING ADDRESS", insuredText);
    y += insuredH + 10;

    const coveragesTop = y;
    y = drawCoverageSectionHeader(doc, data, y);

    doc.font("Helvetica-Bold").fontSize(FS_LABEL).fillColor(C_BLACK);
    const noticeH = doc.heightOfString(ACORD_25_COVERAGE_NOTICE, { width: W - 8 }) + 8;
    doc.rect(M, y, W, noticeH).stroke();
    doc.text(ACORD_25_COVERAGE_NOTICE, M + 4, y + 4, {
      width: W - 8,
      height: noticeH - 8,
    });
    y += noticeH;

    y = drawCoverageTable(doc, data.coverages, y);
    doc.rect(M, coveragesTop, W, y - coveragesTop).strokeColor(C_BLACK).stroke();

    const descText = data.description ?? "";
    const descMaxH = 58;
    const descOverflows =
      textBlockHeight(doc, descText, W - 10, FS_LABEL, false) + 18 > descMaxH;
    const descH = descMaxH;
    drawInfoBox(
      doc,
      M,
      y,
      W,
      descH,
      "DESCRIPTION OF OPERATIONS / LOCATIONS / SPECIAL ITEMS / ADDITIONAL INSURED",
      descOverflows ? "See additional remarks schedule attached" : descText,
    );
    y += descH;

    const bottomW = W * 0.46;
    const cancelText = "Should any of the above described policies be cancelled before the expiration date thereof, notice will be delivered in accordance with the policy provisions.";
    const bottomH = Math.max(54, textBlockHeight(doc, data.certificateHolder ?? "", bottomW - 10, FS_VALUE, false) + 18, textBlockHeight(doc, cancelText, W - bottomW - 10, FS_DISCLAIMER, false) + 18);
    drawInfoBox(doc, M, y, bottomW, bottomH, "CERTIFICATE HOLDER", data.certificateHolder ?? "");
    drawInfoBox(doc, M + bottomW, y, W - bottomW, bottomH, "CANCELLATION", cancelText);
    y += bottomH + 6;

    if (descOverflows) {
      drawAcord101(doc, data);
    }

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

function drawCoverageSectionHeader(
  doc: PDFKit.PDFDocument,
  data: CoiData,
  y: number,
): number {
  const headerH = 16;
  const coverageW = 138;
  const revisionW = 160;
  const certificateW = W - coverageW - revisionW;
  const certificateNumber = data.certificateNumber?.trim();
  const revisionNumber = data.revisionNumber?.trim();

  doc.rect(M, y, W, headerH).fillAndStroke(C_HEADER_BG, C_BLACK);
  doc
    .moveTo(M + coverageW, y)
    .lineTo(M + coverageW, y + headerH)
    .stroke();
  doc
    .moveTo(M + coverageW + certificateW, y)
    .lineTo(M + coverageW + certificateW, y + headerH)
    .stroke();

  doc.font("Helvetica-Bold").fontSize(FS_LABEL).fillColor(C_BLACK);
  doc.text("COVERAGES", M + 4, y + 4, {
    width: coverageW - 8,
    height: headerH - 6,
    align: "left",
  });
  doc.text(`CERTIFICATE NUMBER:${certificateNumber ? ` ${certificateNumber}` : ""}`, M + coverageW + 4, y + 4, {
    width: certificateW - 8,
    height: headerH - 6,
    align: "center",
  });
  doc.text(`REVISION NUMBER:${revisionNumber ? ` ${revisionNumber}` : ""}`, M + coverageW + certificateW + 4, y + 4, {
    width: revisionW - 8,
    height: headerH - 6,
    align: "center",
  });

  return y + headerH;
}

function drawAcord25InformationNotice(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
): number {
  doc.font("Helvetica-Bold").fontSize(FS_SMALL).fillColor(C_BLACK);
  const h = Math.max(
    30,
    doc.heightOfString(ACORD_25_INFORMATION_NOTICE, {
      width: w - 10,
      align: "center",
    }) + 8,
  );
  doc.rect(x, y, w, h).stroke();
  doc.text(ACORD_25_INFORMATION_NOTICE, x + 5, y + 4, {
    width: w - 10,
    height: h - 8,
    align: "center",
  });
  return h;
}

function drawInsurerLegend(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  data: CoiData,
) {
  doc.rect(x, y, w, h).stroke();
  const naicW = 44;
  const headerH = 12;
  doc.moveTo(x, y + headerH).lineTo(x + w, y + headerH).stroke();
  doc.moveTo(x + w - naicW, y).lineTo(x + w - naicW, y + h).stroke();
  doc.font("Helvetica-Bold").fontSize(FS_SMALL).fillColor(C_BLACK);
  doc.text("INSURER(S) AFFORDING COVERAGE", x + 5, y + 3, {
    width: w - naicW - 10,
    align: "center",
  });
  doc.text("NAIC #", x + w - naicW + 4, y + 3, {
    width: naicW - 8,
    align: "center",
  });

  const rowY = y + headerH;
  const rowH = (h - headerH) / 6;
  for (let i = 0; i < 6; i++) {
    const letter = String.fromCharCode(65 + i);
    const rowTop = rowY + i * rowH;
    if (i > 0) {
      doc.moveTo(x, rowTop).lineTo(x + w, rowTop).stroke();
    }
    doc.font("Helvetica-Bold").fontSize(FS_SMALL).fillColor(C_BLACK);
    doc.text(`INSURER ${letter}:`, x + 5, rowTop + 2, { width: 50 });
    const insurer = data.insurers.find((ins) => ins.letter === letter);
    if (insurer) {
      doc.font("Helvetica").fontSize(FS_LABEL).fillColor(C_BLACK);
      doc.text(insurer.name, x + 56, rowTop + 2, { width: w - naicW - 62, height: rowH - 2 });
      if (insurer.naic) {
        doc.font("Helvetica-Bold").fontSize(FS_SMALL);
        doc.text(insurer.naic, x + w - naicW + 4, rowTop + 2, { width: naicW - 8, align: "center" });
      }
    }
  }
}

function drawCoverageTable(doc: PDFKit.PDFDocument, coverages: CoverageLine[], y: number): number {
  const columns = [
    { key: "type", label: "TYPE OF INSURANCE", w: 132 },
    { key: "letter", label: "CO\nLTR", w: 28 },
    { key: "addlInsr", label: "ADDL\nINSR", w: 24 },
    { key: "subrWvd", label: "SUBR\nWVD", w: 24 },
    { key: "policy", label: "POLICY NUMBER", w: 71 },
    { key: "effective", label: "POLICY EFFECTIVE\nDATE", w: 66 },
    { key: "expiration", label: "POLICY EXPIRATION\nDATE", w: 66 },
    { key: "limits", label: "LIMITS OF LIABILITY", w: W - 132 - 28 - 24 - 24 - 71 - 66 - 66 },
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
      textBlockHeight(doc, limitsText, columns[7].w - 6, FS_SMALL, false) + 8,
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
    doc.font("Helvetica-Bold").fontSize(FS_LABEL);
    doc.text(coverage.addlInsr ? "Y" : "", x + 3, y + 4, { width: columns[2].w - 6, align: "center" });
    x += columns[2].w;
    doc.text(coverage.subrWvd ? "Y" : "", x + 3, y + 4, { width: columns[3].w - 6, align: "center" });
    x += columns[3].w;
    doc.font("Helvetica").fontSize(FS_LABEL);
    doc.text(coverage.policyNumber ?? "", x + 3, y + 4, { width: columns[4].w - 6, height: rowH - 8 });
    x += columns[4].w;
    doc.text(coverage.effectiveDate ?? "", x + 3, y + 4, { width: columns[5].w - 6, align: "center" });
    x += columns[5].w;
    doc.text(coverage.expirationDate ?? "", x + 3, y + 4, { width: columns[6].w - 6, align: "center" });
    x += columns[6].w;
    doc.font("Helvetica").fontSize(FS_SMALL).fillColor(C_BLACK);
    doc.text(limitsText, x + 3, y + 4, { width: columns[7].w - 6, height: rowH - 8 });
    y += rowH;
  }

  return y;
}

function drawAcordPropertyEvidenceForm(doc: PDFKit.PDFDocument, data: CoiData) {
  const formCode = data.formCode ?? "acord24";
  const title = CERTIFICATE_FORM_LABELS[formCode] ?? data.title;
  let y = 24;
  const dateStr = dayjs().format("YYYY/MM/DD");

  doc.font("Helvetica-Bold").fontSize(12).fillColor(C_BLACK);
  doc.text(title.toUpperCase(), M, y, { width: W * 0.68 });
  doc.font("Helvetica-Bold").fontSize(FS_LABEL);
  doc.text(data.issuedDateLabel, M + W * 0.72, y, { width: W * 0.28, align: "right" });
  doc.font("Helvetica").fontSize(FS_VALUE);
  doc.text(dateStr, M + W * 0.72, y + 10, { width: W * 0.28, align: "right" });
  y += 30;

  const topW = W * 0.5;
  const insurerAddress = joinLines(
    data.insurers[0]?.name,
    data.insuranceCompanyAddress,
    data.insuranceCompanyPhone && `Phone: ${data.insuranceCompanyPhone}`,
  );
  const producerText = joinLines(
    data.producerAgency,
    formatAddress(data.producerAddress),
    data.producerContact && `Contact: ${data.producerContact}`,
    data.producerPhone && `Phone: ${data.producerPhone}`,
    data.producerEmail && `Email: ${data.producerEmail}`,
  );
  drawInfoBox(doc, M, y, topW, 78, "PRODUCER", producerText);
  drawInfoBox(doc, M + topW, y, W - topW, 78, "INSURER", insurerAddress);
  y += 78;

  const insuredText = joinLines(
    data.insuredName,
    data.insuredDba && `DBA: ${data.insuredDba}`,
    formatAddress(data.insuredAddress),
    data.insuredFein && `FEIN: ${data.insuredFein}`,
  );
  drawInfoBox(doc, M, y, W, 62, "NAMED INSURED", insuredText);
  y += 68;

  const policySummary = data.coverages
    .slice(0, 5)
    .map((coverage) =>
      [
        coverage.type,
        coverage.policyNumber && `Policy ${coverage.policyNumber}`,
        coverage.effectiveDate && coverage.expirationDate
          ? `${coverage.effectiveDate} to ${coverage.expirationDate}`
          : undefined,
        coverage.limits.map((limit) => `${limit.label}: ${limit.value}`).join("; "),
      ].filter(Boolean).join(" | "),
    )
    .join("\n");
  drawInfoBox(doc, M, y, W, 86, "POLICY INFORMATION", policySummary);
  y += 92;

  const propertyText = joinLines(
    data.propertyDescription,
    data.propertyLocation && `Location: ${data.propertyLocation}`,
    formCode === "acord29" && data.floodZone ? `Flood zone: ${data.floodZone}` : undefined,
    formCode === "acord29" && data.floodProgram ? `Flood program: ${data.floodProgram}` : undefined,
  ) ?? "See policy declarations.";
  drawInfoBox(doc, M, y, W, 86, formCode === "acord29" ? "FLOOD / PROPERTY INFORMATION" : "PROPERTY INFORMATION", propertyText);
  y += 92;

  const interestText = joinLines(
    data.interestHolder ?? data.certificateHolder,
    data.interestHolderRelationship && `Interest: ${data.interestHolderRelationship}`,
  );
  drawInfoBox(
    doc,
    M,
    y,
    W,
    62,
    formCode === "acord24" || formCode === "acord30" || formCode === "acord31"
      ? "CERTIFICATE HOLDER"
      : "ADDITIONAL INTEREST",
    interestText,
  );
  y += 68;

  const remarksText = data.description ?? "";
  const remarksMaxH = 74;
  const remarksOverflow =
    textBlockHeight(doc, remarksText, W - 10, FS_LABEL, false) + 18 > remarksMaxH;
  drawInfoBox(
    doc,
    M,
    y,
    W,
    remarksMaxH,
    "REMARKS",
    remarksOverflow ? "See additional remarks schedule attached" : remarksText,
  );
  y += remarksMaxH + 6;

  if (remarksOverflow) drawAcord101(doc, data);
}

function drawAcord101(doc: PDFKit.PDFDocument, data: CoiData) {
  doc.addPage({ size: "LETTER", margin: 0 });
  let y = 30;
  doc.font("Helvetica-Bold").fontSize(12).fillColor(C_BLACK);
  doc.text("ADDITIONAL REMARKS SCHEDULE", M, y, { width: W });
  y += 24;
  const holder = data.certificateHolder ?? "";
  const insuredText = joinLines(data.insuredName, holder && `Certificate holder: ${holder}`);
  drawInfoBox(doc, M, y, W, 62, "NAMED INSURED / CERTIFICATE HOLDER", insuredText);
  y += 70;
  drawInfoBox(doc, M, y, W, 560, "ADDITIONAL REMARKS", data.description ?? "");
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

function sectionLabel(doc: PDFKit.PDFDocument, text: string, x: number, y: number) {
  doc.font("Helvetica-Bold").fontSize(FS_SMALL).fillColor(C_BLACK);
  doc.text(text, x, y);
}
