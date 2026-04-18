"use node";

import PDFDocument from "pdfkit";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * COI data interface mapping Prism's rich policy fields to ACORD 25 fields.
 * All monetary values should be pre-formatted strings (e.g. "$1,000,000").
 */
export interface CoiData {
  // Producer (Broker)
  producerAgency?: string;
  producerContact?: string;
  producerLicense?: string;
  producerAddress?: string;
  producerPhone?: string;
  producerEmail?: string;

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
 * Map a Prism policy document to CoiData.
 * Produces one CoverageLine per detected coverage type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function policyToCoiData(policy: any, org?: any): CoiData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const limits: any = policy.limits ?? {};
  const policyTypes: string[] = policy.policyTypes ?? [];
  const policyNumber = policy.policyNumber ?? "";
  const effDate = policy.effectiveDate ?? "";
  const expDate = policy.expirationDate ?? "";
  const coverageForm = policy.coverageForm ?? "occurrence";

  // Build insurer row for Insurer A
  const insurers = [{
    letter: "A",
    name: policy.carrierLegalName ?? policy.security ?? "N/A",
    naic: policy.carrierNaicNumber,
    amBest: policy.carrierAmBestRating,
    admitted: policy.carrierAdmittedStatus,
  }];

  const coverageLines: CoverageLine[] = [];

  // ── Commercial General Liability ──────────────────────────────────────────
  const hasGL = policyTypes.some((t) =>
    ["general_liability", "bop", "product_liability"].includes(t)
  );
  if (hasGL || limits.perOccurrence || limits.generalAggregate) {
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
      coverageForm: coverageForm === "claims_made" ? "claims_made" : "occurrence",
      policyNumber,
      effectiveDate: effDate,
      expirationDate: expDate,
      limits: glLimits,
    });
  }

  // ── Automobile Liability ──────────────────────────────────────────────────
  const hasAuto = policyTypes.some((t) =>
    ["commercial_auto", "non_owned_auto", "personal_auto"].includes(t)
  );
  if (hasAuto || limits.combinedSingleLimit || limits.bodilyInjuryPerPerson) {
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
      policyNumber,
      effectiveDate: effDate,
      expirationDate: expDate,
      limits: autoLimits,
    });
  }

  // ── Umbrella / Excess Liability ───────────────────────────────────────────
  const hasUmbrella = policyTypes.some((t) => ["umbrella", "excess_liability"].includes(t));
  if (hasUmbrella || limits.eachOccurrenceUmbrella || limits.umbrellaAggregate) {
    const umbLimits: Array<{ label: string; value: string }> = [];
    if (limits.eachOccurrenceUmbrella) umbLimits.push({ label: "EACH OCCURRENCE", value: limits.eachOccurrenceUmbrella });
    if (limits.umbrellaAggregate) umbLimits.push({ label: "AGGREGATE", value: limits.umbrellaAggregate });
    if (limits.umbrellaRetention) umbLimits.push({ label: "DED  RETENTION", value: limits.umbrellaRetention });

    coverageLines.push({
      type: policyTypes.includes("excess_liability") ? "EXCESS LIAB" : "UMBRELLA LIAB",
      insurerLetter: "A",
      coverageForm: coverageForm === "claims_made" ? "claims_made" : "occurrence",
      policyNumber,
      effectiveDate: effDate,
      expirationDate: expDate,
      limits: umbLimits,
    });
  }

  // ── Workers Compensation ──────────────────────────────────────────────────
  const hasWC = policyTypes.includes("workers_comp");
  if (hasWC || limits.statutory || limits.employersLiability) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el: any = limits.employersLiability ?? {};
    const wcLimits: Array<{ label: string; value: string }> = [];
    wcLimits.push({ label: "WC STAT", value: limits.statutory ? "✓" : "" });
    if (el.eachAccident) wcLimits.push({ label: "E.L. EACH ACCIDENT", value: el.eachAccident });
    if (el.diseaseEachEmployee) wcLimits.push({ label: "E.L. DISEASE - EA EMPLOYEE", value: el.diseaseEachEmployee });
    if (el.diseasePolicyLimit) wcLimits.push({ label: "E.L. DISEASE - POLICY LIMIT", value: el.diseasePolicyLimit });

    coverageLines.push({
      type: "WORKERS COMPENSATION\nAND EMPLOYERS' LIABILITY",
      insurerLetter: "A",
      policyNumber,
      effectiveDate: effDate,
      expirationDate: expDate,
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
      coverageForm: coverageForm === "claims_made" ? "claims_made" : "occurrence",
      policyNumber,
      effectiveDate: effDate,
      expirationDate: expDate,
      limits: buildOtherLimits(limits),
    });
  }

  // If no specific coverage lines were identified, add a generic one
  if (coverageLines.length === 0) {
    coverageLines.push({
      type: policyTypes.map((t) => t.replace(/_/g, " ").toUpperCase()).join(" / ") || "SEE POLICY",
      insurerLetter: "A",
      policyNumber,
      effectiveDate: effDate,
      expirationDate: expDate,
      limits: flattenToLimitLines(limits),
    });
  }

  return {
    producerAgency: org?.insuranceBroker ?? policy.brokerAgency ?? policy.broker,
    producerContact: org?.brokerContactName ?? policy.brokerContactName,
    producerLicense: policy.brokerLicenseNumber,
    producerEmail: org?.brokerContactEmail ?? policy.brokerContactEmail,
    insuredName: policy.insuredName ?? "N/A",
    insuredDba: policy.insuredDba,
    insuredAddress: policy.insuredAddress,
    insuredFein: policy.insuredFein,
    insurers,
    coverages: coverageLines,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildOtherLimits(limits: any): Array<{ label: string; value: string }> {
  const result: Array<{ label: string; value: string }> = [];
  if (limits.perOccurrence) result.push({ label: "EACH CLAIM / OCCURRENCE", value: limits.perOccurrence });
  if (limits.generalAggregate) result.push({ label: "AGGREGATE", value: limits.generalAggregate });
  if (limits.combinedSingleLimit) result.push({ label: "LIMIT", value: limits.combinedSingleLimit });
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

function formatAddress(addr: string | { street1?: string; city?: string; state?: string; zip?: string } | undefined | null): string {
  if (!addr) return "";
  if (typeof addr === "string") return addr;
  const parts = [addr.street1, addr.city, addr.state && addr.zip ? `${addr.state} ${addr.zip}` : (addr.state ?? addr.zip)];
  return parts.filter(Boolean).join(", ");
}

// ─── PDF Generation ───────────────────────────────────────────────────────────

const PAGE_W = 612;
const M = 30;          // left/right margin
const W = PAGE_W - 2 * M;  // 552pt usable width

// Font sizes
const FS_TITLE = 9;
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

    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let y = M;

    // ── Header row ───────────────────────────────────────────────────────────
    const hdrH = 26;
    // Grey background
    doc.rect(M, y, W, hdrH).fill(C_HEADER_BG).stroke();
    doc.fillColor(C_BLACK).font("Helvetica-Bold").fontSize(FS_TITLE);
    doc.text("CERTIFICATE OF LIABILITY INSURANCE", M, y + 5, { width: W * 0.75, align: "center" });
    doc.font("Helvetica").fontSize(FS_LABEL);
    const dateStr = new Date().toLocaleDateString("en-US");
    doc.text("DATE (MM/DD/YYYY)", M + W * 0.76, y + 3, { width: W * 0.24, align: "left" });
    doc.font("Helvetica-Bold").fontSize(FS_VALUE);
    doc.text(dateStr, M + W * 0.76, y + 12, { width: W * 0.24, align: "left" });
    y += hdrH;

    // ── Disclaimer row ────────────────────────────────────────────────────────
    const disclaimerH = 28;
    doc.rect(M, y, W, disclaimerH).stroke();
    doc.font("Helvetica").fontSize(FS_DISCLAIMER).fillColor(C_BLACK);
    const disclaimer =
      "THIS CERTIFICATE IS ISSUED AS A MATTER OF INFORMATION ONLY AND CONFERS NO RIGHTS UPON THE CERTIFICATE HOLDER. THIS CERTIFICATE DOES NOT AFFIRMATIVELY OR NEGATIVELY AMEND, EXTEND OR ALTER THE COVERAGE AFFORDED BY THE POLICIES BELOW. THIS CERTIFICATE OF INSURANCE DOES NOT CONSTITUTE A CONTRACT BETWEEN THE ISSUING INSURER(S), AUTHORIZED REPRESENTATIVE OR PRODUCER, AND THE CERTIFICATE HOLDER.";
    doc.text(disclaimer, M + 4, y + 4, { width: W - 8, align: "left" });
    y += disclaimerH;

    // ── IMPORTANT notice row ─────────────────────────────────────────────────
    const importantH = 20;
    doc.rect(M, y, W, importantH).stroke();
    doc.font("Helvetica-Bold").fontSize(FS_DISCLAIMER).fillColor(C_BLACK);
    doc.text("IMPORTANT:", M + 4, y + 4, { continued: true });
    doc.font("Helvetica").fontSize(FS_DISCLAIMER);
    doc.text(
      " If the certificate holder is an ADDITIONAL INSURED, the policy(ies) must have ADDITIONAL INSURED provisions or be endorsed. If SUBROGATION IS WAIVED, subject to the terms and conditions of the policy, certain policies may require an endorsement. A statement on this certificate does not confer rights to the certificate holder in lieu of such endorsement(s).",
      { width: W - 8 },
    );
    y += importantH;

    // ── Producer / Contact row ────────────────────────────────────────────────
    const producerW = W * 0.48;
    const producerH = 80;
    // Producer box
    doc.rect(M, y, producerW, producerH).stroke();
    sectionLabel(doc, "PRODUCER", M + 2, y + 2);
    doc.font("Helvetica-Bold").fontSize(FS_VALUE).fillColor(C_BLACK);
    let py = y + 12;
    if (data.producerAgency) {
      doc.text(data.producerAgency, M + 3, py, { width: producerW - 6 });
      py += 10;
    }
    doc.font("Helvetica").fontSize(FS_LABEL).fillColor(C_GRAY);
    if (data.producerContact) { doc.text(`Contact: ${data.producerContact}`, M + 3, py, { width: producerW - 6 }); py += 8; }
    if (data.producerLicense) { doc.text(`License #: ${data.producerLicense}`, M + 3, py, { width: producerW - 6 }); py += 8; }
    if (data.producerEmail) { doc.text(`Email: ${data.producerEmail}`, M + 3, py, { width: producerW - 6 }); py += 8; }
    if (data.producerPhone) { doc.text(`Phone: ${data.producerPhone}`, M + 3, py, { width: producerW - 6 }); }

    // Contact info box (right side)
    const contactX = M + producerW;
    const contactW = W - producerW;
    doc.rect(contactX, y, contactW, producerH).stroke();
    sectionLabel(doc, "CONTACT NAME:", contactX + 2, y + 2);
    sectionLabel(doc, "PHONE", contactX + 2, y + 18);
    doc.fontSize(FS_SMALL).text("(A/C, No, Ext):", contactX + 2, y + 26, { width: contactW / 2 - 4 });
    sectionLabel(doc, "FAX", contactX + contactW / 2, y + 18);
    doc.fontSize(FS_SMALL).text("(A/C, No):", contactX + contactW / 2, y + 26, { width: contactW / 2 - 4 });
    sectionLabel(doc, "E-MAIL ADDRESS:", contactX + 2, y + 42);
    sectionLabel(doc, "INSURER(S) AFFORDING COVERAGE", contactX + 2, y + 56);
    sectionLabel(doc, "NAIC #", M + W - 36, y + 56);
    y += producerH;

    // ── Insured box ───────────────────────────────────────────────────────────
    const insuredH = 60;
    doc.rect(M, y, producerW, insuredH).stroke();
    sectionLabel(doc, "INSURED", M + 2, y + 2);
    doc.font("Helvetica-Bold").fontSize(FS_VALUE).fillColor(C_BLACK);
    let iy = y + 12;
    doc.text(data.insuredName, M + 3, iy, { width: producerW - 6 });
    iy += 10;
    doc.font("Helvetica").fontSize(FS_LABEL).fillColor(C_GRAY);
    if (data.insuredDba) { doc.text(`DBA: ${data.insuredDba}`, M + 3, iy, { width: producerW - 6 }); iy += 8; }
    const addrStr = formatAddress(data.insuredAddress);
    if (addrStr) { doc.text(addrStr, M + 3, iy, { width: producerW - 6 }); iy += 8; }
    if (data.insuredFein) { doc.text(`FEIN: ${data.insuredFein}`, M + 3, iy, { width: producerW - 6 }); }

    // Insurers A–F (right side, stacked in insured height)
    const naicW = 36;
    const insurerNameW = contactW - naicW - 14; // "INSURER A:" label + name + naic
    for (let i = 0; i < 6; i++) {
      const ins = data.insurers[i];
      const ry = y + i * (insuredH / 6);
      doc.rect(contactX, ry, contactW, insuredH / 6).stroke();
      const letter = String.fromCharCode(65 + i);
      sectionLabel(doc, `INSURER ${letter}:`, contactX + 2, ry + 3);
      if (ins) {
        doc.font("Helvetica").fontSize(FS_VALUE - 1).fillColor(C_BLACK);
        doc.text(ins.name, contactX + 42, ry + 3, { width: insurerNameW });
        if (ins.naic) {
          doc.font("Helvetica-Bold").fontSize(FS_VALUE - 1);
          doc.text(ins.naic, M + W - naicW + 2, ry + 3, { width: naicW - 4 });
        }
      }
    }
    y += insuredH;

    // ── Coverages header ──────────────────────────────────────────────────────
    const covHdrH = 14;
    doc.rect(M, y, W, covHdrH).fill(C_HEADER_BG).stroke();
    doc.font("Helvetica-Bold").fontSize(FS_LABEL).fillColor(C_BLACK);
    doc.text("COVERAGES", M + 4, y + 3, { width: W * 0.4 });
    if (data.certificateNumber) {
      doc.text(`CERTIFICATE NUMBER: ${data.certificateNumber}`, M + W * 0.45, y + 3, { width: W * 0.3 });
    }
    if (data.revisionNumber) {
      doc.text(`REVISION NUMBER: ${data.revisionNumber}`, M + W * 0.8, y + 3, { width: W * 0.2 });
    }
    y += covHdrH;

    // ── Coverage instruction text ─────────────────────────────────────────────
    const instrH = 18;
    doc.rect(M, y, W, instrH).stroke();
    doc.font("Helvetica").fontSize(FS_DISCLAIMER).fillColor(C_BLACK);
    doc.text(
      "THIS IS TO CERTIFY THAT THE POLICIES OF INSURANCE LISTED BELOW HAVE BEEN ISSUED TO THE INSURED NAMED ABOVE FOR THE POLICY PERIOD INDICATED. NOTWITHSTANDING ANY REQUIREMENT, TERM OR CONDITION OF ANY CONTRACT OR OTHER DOCUMENT WITH RESPECT TO WHICH THIS CERTIFICATE MAY BE ISSUED OR MAY PERTAIN, THE INSURANCE AFFORDED BY THE POLICIES DESCRIBED HEREIN IS SUBJECT TO ALL THE TERMS, EXCLUSIONS AND CONDITIONS OF SUCH POLICIES. LIMITS SHOWN MAY HAVE BEEN REDUCED BY PAID CLAIMS.",
      M + 4, y + 3, { width: W - 8 },
    );
    y += instrH;

    // ── Column headers for coverage grid ──────────────────────────────────────
    const colHdrH = 22;
    const COL = buildColumns(W);
    doc.rect(M, y, W, colHdrH).fill(C_LABEL_BG).stroke();
    doc.font("Helvetica-Bold").fontSize(FS_SMALL).fillColor(C_BLACK);
    let cx = M;
    for (const col of COL) {
      doc.rect(cx, y, col.w, colHdrH).stroke();
      doc.text(col.label, cx + 2, y + 4, { width: col.w - 4, align: "center" });
      cx += col.w;
    }
    y += colHdrH;

    // ── Coverage rows ─────────────────────────────────────────────────────────
    for (const cov of data.coverages) {
      y = drawCoverageRow(doc, cov, y, COL, M);
    }

    // ── Description of operations ─────────────────────────────────────────────
    const descH = 50;
    doc.rect(M, y, W, descH).stroke();
    sectionLabel(doc, "DESCRIPTION OF OPERATIONS / LOCATIONS / VEHICLES", M + 2, y + 2);
    if (data.description) {
      doc.font("Helvetica").fontSize(FS_LABEL).fillColor(C_BLACK);
      doc.text(data.description, M + 3, y + 14, { width: W - 6, height: descH - 16 });
    }
    y += descH;

    // ── Certificate Holder / Cancellation ────────────────────────────────────
    const bottomH = 70;
    const holderW = W * 0.45;
    // Certificate Holder
    doc.rect(M, y, holderW, bottomH).stroke();
    sectionLabel(doc, "CERTIFICATE HOLDER", M + 2, y + 2);
    if (data.certificateHolder) {
      doc.font("Helvetica").fontSize(FS_VALUE).fillColor(C_BLACK);
      doc.text(data.certificateHolder, M + 3, y + 14, { width: holderW - 6 });
    }
    // Cancellation
    const cancelX = M + holderW;
    const cancelW = W - holderW;
    doc.rect(cancelX, y, cancelW, bottomH).stroke();
    sectionLabel(doc, "CANCELLATION", cancelX + 2, y + 2);
    doc.font("Helvetica").fontSize(FS_DISCLAIMER).fillColor(C_BLACK);
    doc.text(
      "SHOULD ANY OF THE ABOVE DESCRIBED POLICIES BE CANCELLED BEFORE THE EXPIRATION DATE THEREOF, NOTICE WILL BE DELIVERED IN ACCORDANCE WITH THE POLICY PROVISIONS.",
      cancelX + 3, y + 14, { width: cancelW - 6 },
    );
    sectionLabel(doc, "AUTHORIZED REPRESENTATIVE", cancelX + 2, y + 50);
    y += bottomH;

    // ── Footer ────────────────────────────────────────────────────────────────
    doc.font("Helvetica").fontSize(FS_SMALL).fillColor(C_GRAY);
    doc.text(
      "ACORD 25 (2016/03)  |  Generated by Prism — claritylabs.inc  |  © 1988-2016 ACORD CORPORATION. All rights reserved.",
      M, y + 6, { width: W, align: "center" },
    );

    doc.end();
  });
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

interface Column {
  label: string;
  w: number;
  key: string;
}

function buildColumns(totalW: number): Column[] {
  return [
    { key: "type",       label: "TYPE OF INSURANCE",                           w: Math.round(totalW * 0.295) },
    { key: "addlInsr",   label: "ADDL\nINSR",                                  w: Math.round(totalW * 0.047) },
    { key: "subrWvd",    label: "SUBR\nWVD",                                    w: Math.round(totalW * 0.047) },
    { key: "policyNum",  label: "POLICY NUMBER",                               w: Math.round(totalW * 0.165) },
    { key: "effDate",    label: "POLICY EFF\n(MM/DD/YYYY)",                     w: Math.round(totalW * 0.108) },
    { key: "expDate",    label: "POLICY EXP\n(MM/DD/YYYY)",                     w: Math.round(totalW * 0.108) },
    { key: "limits",     label: "LIMITS",                                       w: 0 }, // remainder
  ].map((c, i, arr) => {
    if (c.key === "limits") {
      const used = arr.slice(0, -1).reduce((s, x) => s + x.w, 0);
      return { ...c, w: totalW - used };
    }
    return c;
  });
}

function drawCoverageRow(
  doc: PDFKit.PDFDocument,
  cov: CoverageLine,
  y: number,
  cols: Column[],
  M: number,
): number {
  const baseH = Math.max(38, 12 * Math.ceil((cov.limits.length + 1) / 1));
  const rowH = Math.min(baseH, 14 + cov.limits.length * 11);

  // Draw cell borders
  let cx = M;
  for (const col of cols) {
    doc.rect(cx, y, col.w, rowH).stroke();
    cx += col.w;
  }

  cx = M;
  // TYPE OF INSURANCE column
  const typeCol = cols[0];
  doc.font("Helvetica-Bold").fontSize(FS_LABEL).fillColor(C_BLACK);
  doc.text(cov.type, cx + 2, y + 3, { width: typeCol.w - 4 });
  if (cov.coverageForm) {
    doc.font("Helvetica").fontSize(FS_SMALL).fillColor(C_GRAY);
    const occLabel = cov.coverageForm === "claims_made" ? "☑ CLAIMS-MADE  □ OCCUR" : "□ CLAIMS-MADE  ☑ OCCUR";
    doc.text(occLabel, cx + 2, y + 14, { width: typeCol.w - 4 });
  }
  if (cov.typeNotes) {
    doc.font("Helvetica").fontSize(FS_SMALL).fillColor(C_GRAY);
    doc.text(cov.typeNotes, cx + 2, y + (cov.coverageForm ? 22 : 14), { width: typeCol.w - 4 });
  }
  if (cov.insurerLetter) {
    doc.font("Helvetica").fontSize(FS_SMALL).fillColor(C_GRAY);
    doc.text(`Insurer ${cov.insurerLetter}`, cx + 2, y + rowH - 10, { width: typeCol.w - 4 });
  }
  cx += typeCol.w;

  // ADDL INSR
  doc.font("Helvetica").fontSize(FS_VALUE).fillColor(C_BLACK);
  if (cov.addlInsr) doc.text("✓", cx + 2, y + rowH / 2 - 4, { width: cols[1].w - 4, align: "center" });
  cx += cols[1].w;

  // SUBR WVD
  if (cov.subrWvd) doc.text("✓", cx + 2, y + rowH / 2 - 4, { width: cols[2].w - 4, align: "center" });
  cx += cols[2].w;

  // POLICY NUMBER
  doc.font("Helvetica").fontSize(FS_LABEL).fillColor(C_BLACK);
  if (cov.policyNumber) doc.text(cov.policyNumber, cx + 2, y + rowH / 2 - 4, { width: cols[3].w - 4 });
  cx += cols[3].w;

  // EFF DATE
  if (cov.effectiveDate) doc.text(cov.effectiveDate, cx + 2, y + rowH / 2 - 4, { width: cols[4].w - 4 });
  cx += cols[4].w;

  // EXP DATE
  if (cov.expirationDate) doc.text(cov.expirationDate, cx + 2, y + rowH / 2 - 4, { width: cols[5].w - 4 });
  cx += cols[5].w;

  // LIMITS — label / value pairs, stacked vertically
  const limCol = cols[6];
  const limLabelW = Math.round(limCol.w * 0.62);
  const limValueW = limCol.w - limLabelW;
  let ly = y + 3;
  for (const lim of cov.limits) {
    // label cell
    doc.rect(cx, ly - 1, limLabelW, 11).stroke();
    doc.font("Helvetica").fontSize(FS_SMALL).fillColor(C_GRAY);
    doc.text(lim.label, cx + 2, ly, { width: limLabelW - 4 });
    // value cell
    doc.rect(cx + limLabelW, ly - 1, limValueW, 11).stroke();
    doc.font("Helvetica-Bold").fontSize(FS_LABEL).fillColor(C_BLACK);
    doc.text(lim.value, cx + limLabelW + 2, ly, { width: limValueW - 4 });
    ly += 11;
    if (ly > y + rowH - 2) break; // don't overflow
  }

  return y + rowH;
}

function sectionLabel(doc: PDFKit.PDFDocument, text: string, x: number, y: number) {
  doc.font("Helvetica-Bold").fontSize(FS_SMALL).fillColor(C_BLACK);
  doc.text(text, x, y);
}
