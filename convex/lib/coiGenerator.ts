"use node";

import PDFDocument from "pdfkit/js/pdfkit.standalone.js";

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
}

// ─── Mapping helpers ──────────────────────────────────────────────────────────

/**
 * Map a Glass policy document to CoiData.
 * Produces one CoverageLine per detected coverage type.
 */

export function policyToCoiData(policy: any): CoiData {
  const limits: any = policy.limits ?? {};
  const policyTypes: string[] = policy.policyTypes ?? [];
  const declarations = declarationFieldMap(policy);
  const policyNumber = pickField(declarations, "policyNumber") ?? policy.policyNumber ?? "";
  const effDate = pickField(declarations, "policyPeriodStart") ?? policy.effectiveDate ?? "";
  const expDate = pickField(declarations, "policyPeriodEnd") ?? policy.expirationDate ?? "";
  const coverageForm = policy.coverageForm ?? "occurrence";
  const producer = policy.producer ?? {};
  const producerName = joinLines(
    pickField(declarations, "producerName") ?? producer.agencyName ?? policy.brokerAgency ?? policy.broker,
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
    name: pickField(declarations, "insurerName") ?? policy.carrierLegalName ?? policy.insurer?.legalName ?? policy.security ?? policy.carrier ?? "N/A",
    naic: policy.carrierNaicNumber ?? policy.insurer?.naicNumber,
    amBest: policy.carrierAmBestRating,
    admitted: policy.carrierAdmittedStatus,
  }];

  const coverageLines: CoverageLine[] = buildCoverageLines(policy, {
    policyNumber,
    effectiveDate: effDate,
    expirationDate: expDate,
    coverageForm,
  });

  return {
    title: deriveCertificateTitle(policyTypes),
    issuedDateLabel: "ISSUE DATE (YYYY/MM/DD)",
    producerAgency: producerName,
    producerContact: producer.contactName ?? policy.underwriter ?? policy.mga,
    producerLicense: producer.licenseNumber ?? policy.brokerLicenseNumber,
    producerAddress,
    producerPhone: producer.phone,
    producerEmail: producer.email,
    insuranceCompanyAddress,
    insuranceCompanyPhone: pickField(declarations, "insurerPhone"),
    insuredName: pickField(declarations, "masterPolicyHolderAndMailingAddressName")?.replace(/;$/, "") ?? policy.insuredName ?? "N/A",
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
    description: buildDescription(policy),
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
  const hasNamedPolicyType = policyTypes.some((t) => !["other", "unknown"].includes(t));
  const coverageLines: CoverageLine[] = [];

  // ── Commercial General Liability ──────────────────────────────────────────
  const hasGL = policyTypes.some((t) =>
    ["general_liability", "bop", "product_liability"].includes(t)
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
    ["commercial_auto", "non_owned_auto", "personal_auto"].includes(t)
  );
  if (hasAuto || (!hasNamedPolicyType && (limits.combinedSingleLimit || limits.bodilyInjuryPerPerson))) {
    const autoLimits: Array<{ label: string; value: string }> = [];
    if (limits.combinedSingleLimit) autoLimits.push({ label: "COMBINED SINGLE LIMIT\n(Ea accident)", value: limits.combinedSingleLimit });
    if (limits.bodilyInjuryPerPerson) autoLimits.push({ label: "BODILY INJURY (Per person)", value: limits.bodilyInjuryPerPerson });
    if (limits.bodilyInjuryPerAccident) autoLimits.push({ label: "BODILY INJURY (Per accident)", value: limits.bodilyInjuryPerAccident });
    if (limits.propertyDamage) autoLimits.push({ label: "PROPERTY DAMAGE\n(Per accident)", value: limits.propertyDamage });

    const autoTypeNote = policyTypes.includes("non_owned_auto")
      ? "NON-OWNED AUTOS ONLY"
      : "ANY AUTO";

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
  const hasUmbrella = policyTypes.some((t) => ["umbrella", "excess_liability"].includes(t));
  if (hasUmbrella || (!hasNamedPolicyType && (limits.eachOccurrenceUmbrella || limits.umbrellaAggregate))) {
    const umbLimits: Array<{ label: string; value: string }> = [];
    if (limits.eachOccurrenceUmbrella) umbLimits.push({ label: "EACH OCCURRENCE", value: limits.eachOccurrenceUmbrella });
    if (limits.umbrellaAggregate) umbLimits.push({ label: "AGGREGATE", value: limits.umbrellaAggregate });
    if (limits.umbrellaRetention) umbLimits.push({ label: "DED  RETENTION", value: limits.umbrellaRetention });

    coverageLines.push({
      type: policyTypes.includes("excess_liability") ? "EXCESS LIAB" : "UMBRELLA LIAB",
      insurerLetter: "A",
      coverageForm: defaults.coverageForm === "claims_made" ? "claims_made" : "occurrence",
      policyNumber: defaults.policyNumber,
      effectiveDate: defaults.effectiveDate,
      expirationDate: defaults.expirationDate,
      limits: umbLimits,
    });
  }

  // ── Workers Compensation ──────────────────────────────────────────────────
  const hasWC = policyTypes.includes("workers_comp");
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

  // ── Other coverage types (professional liability, cyber, etc.) ────────────
  const otherTypes = policyTypes.filter((t) =>
    !["general_liability", "bop", "product_liability", "commercial_auto",
      "non_owned_auto", "personal_auto", "umbrella", "excess_liability",
      "workers_comp"].includes(t)
  );
  if (otherTypes.length > 0) {
    const typeLabel = otherTypes
      .map((t) => t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))
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
      type: policyTypes.map((t) => t.replace(/_/g, " ").toUpperCase()).join(" / ") || "SEE POLICY",
      insurerLetter: "A",
      policyNumber: defaults.policyNumber,
      effectiveDate: defaults.effectiveDate,
      expirationDate: defaults.expirationDate,
      limits: flattenToLimitLines(limits),
    });
  }

  return coverageLines;
}

function deriveCertificateTitle(policyTypes: string[]): string {
  const normalized = policyTypes.map((t) => t.toLowerCase());
  if (normalized.some((t) => t.includes("travel"))) return "CERTIFICATE OF TRAVEL INSURANCE";
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

  const grouped = new Map<string, Array<{ label: string; value: string }>>();
  for (const coverage of rawCoverages) {
    const value = formatMoneyLike(coverage.limit);
    if (!value) continue;

    const group = coverageGroupName(coverage.name ?? coverage.type ?? "");
    const label = coverageLimitLabel(coverage);
    const rows = grouped.get(group) ?? [];
    const key = `${label}:${value}`;
    if (!rows.some((row) => `${row.label}:${row.value}` === key)) {
      rows.push({ label, value });
    }
    grouped.set(group, rows);
  }

  return Array.from(grouped.entries())
    .map(([type, limits]) => ({
      type,
      insurerLetter: "A",
      coverageForm: defaults.coverageForm === "claims_made" ? "claims_made" as const : "occurrence" as const,
      policyNumber: defaults.policyNumber,
      effectiveDate: defaults.effectiveDate,
      expirationDate: defaults.expirationDate,
      limits: limits.slice(0, 8),
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
const C_GRAY = "#666666";
const C_HEADER_BG = "#d0d0d0";
const C_LABEL_BG = "#e8e8e8";

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

    doc.rect(M, y, W, 16).fill(C_HEADER_BG).stroke();
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

    doc.font("Helvetica").fontSize(FS_SMALL).fillColor(C_GRAY);
    doc.text("Generated using Glass from Clarity Labs", M, y, { width: W, align: "center" });

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
    "This certificate is issued as a matter of information only and confers no rights upon the certificate holder. This certificate does not amend, extend or alter the coverage afforded by the policies below.";
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
  doc.rect(M, y, W, headerH).fill(C_LABEL_BG).stroke();
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

function sectionLabel(doc: PDFKit.PDFDocument, text: string, x: number, y: number) {
  doc.font("Helvetica-Bold").fontSize(FS_SMALL).fillColor(C_BLACK);
  doc.text(text, x, y);
}
