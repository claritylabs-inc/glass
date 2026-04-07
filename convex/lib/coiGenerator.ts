import PDFDocument from "pdfkit";

/**
 * COI data interface — maps from Prism's rich policy fields
 * to ACORD 25-style COI layout.
 */
export interface CoiData {
  // Producer (Broker)
  producerName: string;
  producerAgency?: string;
  producerContact?: string;
  producerLicense?: string;
  producerAddress?: string;
  producerPhone?: string;
  producerEmail?: string;

  // Insured
  insuredName: string;
  insuredDba?: string;
  insuredAddress?: string;
  insuredFein?: string;

  // Insurer
  insurerName: string;
  insurerNaic?: string;
  insurerAmBest?: string;
  insurerAdmitted?: string;

  // Policy
  policyNumber: string;
  policyType: string;
  effectiveDate: string;
  expirationDate: string;

  // Limits (key-value pairs)
  limits: Record<string, string>;

  // Optional
  certificateHolder?: string;
  description?: string;
}

/**
 * Map a Prism policy document to CoiData.
 */
export function policyToCoiData(policy: any, org?: any): CoiData {
  return {
    producerName: org?.brokerContactName ?? policy.brokerContactName ?? "N/A",
    producerAgency: org?.insuranceBroker ?? policy.brokerAgency ?? policy.broker,
    producerContact: org?.brokerContactName ?? policy.brokerContactName,
    producerLicense: policy.brokerLicenseNumber,
    producerEmail: org?.brokerContactEmail ?? policy.brokerContactEmail,
    insuredName: policy.insuredName ?? "N/A",
    insuredDba: policy.insuredDba,
    insuredAddress: policy.insuredAddress,
    insuredFein: policy.insuredFein,
    insurerName: policy.carrierLegalName ?? policy.security ?? "N/A",
    insurerNaic: policy.carrierNaicNumber,
    insurerAmBest: policy.carrierAmBestRating,
    insurerAdmitted: policy.carrierAdmittedStatus,
    policyNumber: policy.policyNumber ?? "N/A",
    policyType: policy.policyTypes?.join(", ") ?? "N/A",
    effectiveDate: policy.effectiveDate ?? "N/A",
    expirationDate: policy.expirationDate ?? "N/A",
    limits: flattenLimits(policy.limits),
  };
}

function flattenLimits(limits: any): Record<string, string> {
  if (!limits) return {};
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(limits)) {
    if (value != null && value !== "") {
      flat[key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim()] =
        String(value);
    }
  }
  return flat;
}

/**
 * Generate a COI PDF using pdfkit.
 * Returns a Buffer of the PDF.
 */
export async function generateCoiPdf(data: CoiData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const blue = "#1a365d";
    const gray = "#666666";

    // Header
    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .fillColor(blue)
      .text("CERTIFICATE OF LIABILITY INSURANCE", { align: "center" });
    doc.moveDown(0.5);
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(gray)
      .text(`DATE (MM/DD/YYYY): ${new Date().toLocaleDateString("en-US")}`, { align: "right" });
    doc.moveDown(1);

    // Producer section
    sectionHeader(doc, "PRODUCER");
    doc.font("Helvetica-Bold").fontSize(10).fillColor("black");
    if (data.producerAgency) doc.text(data.producerAgency);
    doc.font("Helvetica").fontSize(9).fillColor(gray);
    if (data.producerContact) doc.text(`Contact: ${data.producerContact}`);
    if (data.producerLicense) doc.text(`License: ${data.producerLicense}`);
    if (data.producerEmail) doc.text(`Email: ${data.producerEmail}`);
    doc.moveDown(0.5);

    // Insured section
    sectionHeader(doc, "INSURED");
    doc.font("Helvetica-Bold").fontSize(10).fillColor("black");
    doc.text(data.insuredName);
    doc.font("Helvetica").fontSize(9).fillColor(gray);
    if (data.insuredDba) doc.text(`DBA: ${data.insuredDba}`);
    if (data.insuredAddress) doc.text(data.insuredAddress);
    if (data.insuredFein) doc.text(`FEIN: ${data.insuredFein}`);
    doc.moveDown(0.5);

    // Insurer section
    sectionHeader(doc, "INSURER");
    doc.font("Helvetica-Bold").fontSize(10).fillColor("black");
    doc.text(data.insurerName);
    doc.font("Helvetica").fontSize(9).fillColor(gray);
    if (data.insurerNaic) doc.text(`NAIC #: ${data.insurerNaic}`);
    if (data.insurerAmBest) doc.text(`A.M. Best: ${data.insurerAmBest}`);
    if (data.insurerAdmitted) doc.text(`Status: ${data.insurerAdmitted}`);
    doc.moveDown(0.5);

    // Coverage section
    sectionHeader(doc, "COVERAGES");
    doc.font("Helvetica").fontSize(9).fillColor("black");
    doc.text(`Type: ${data.policyType}`);
    doc.text(`Policy Number: ${data.policyNumber}`);
    doc.text(`Effective: ${data.effectiveDate} — Expiration: ${data.expirationDate}`);
    doc.moveDown(0.5);

    // Limits table
    if (Object.keys(data.limits).length > 0) {
      sectionHeader(doc, "LIMITS");
      for (const [key, value] of Object.entries(data.limits)) {
        doc.font("Helvetica").fontSize(9);
        doc.fillColor(gray).text(key, 50, doc.y, { continued: true, width: 250 });
        doc.fillColor("black").text(`  ${value}`, { align: "right" });
      }
      doc.moveDown(0.5);
    }

    // Certificate holder
    if (data.certificateHolder) {
      sectionHeader(doc, "CERTIFICATE HOLDER");
      doc.font("Helvetica").fontSize(9).fillColor("black").text(data.certificateHolder);
      doc.moveDown(0.5);
    }

    // Description
    if (data.description) {
      sectionHeader(doc, "DESCRIPTION OF OPERATIONS");
      doc.font("Helvetica").fontSize(8).fillColor(gray).text(data.description);
    }

    // Footer
    doc.moveDown(2);
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor(gray)
      .text(
        "THIS CERTIFICATE IS ISSUED AS A MATTER OF INFORMATION ONLY AND CONFERS NO RIGHTS UPON THE CERTIFICATE HOLDER.",
        { align: "center" },
      );
    doc.text("Generated by Prism — claritylabs.inc", { align: "center" });

    doc.end();
  });
}

function sectionHeader(doc: PDFKit.PDFDocument, title: string) {
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor("#1a365d")
    .text(title)
    .moveTo(50, doc.y)
    .lineTo(562, doc.y)
    .strokeColor("#cccccc")
    .stroke();
  doc.moveDown(0.3);
}
