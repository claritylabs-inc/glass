import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dayjs from "dayjs";
import JSZip from "jszip";
import PDFDocument from "pdfkit";

const outputDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureDate = dayjs("2026-08-01T12:00:00Z").toDate();

const colors = {
  ink: "#172033",
  muted: "#667085",
  border: "#D8DEE9",
  accent: "#3155A6",
  accentWash: "#EEF3FF",
  warningWash: "#FFF8E7",
};

function collectPdf(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function addPdfHeader(doc, { documentId, title, subtitle, page, pages }) {
  doc
    .fillColor(colors.accent)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("TRANSFORMER CAPITAL", 54, 45, { characterSpacing: 1.2 });
  doc
    .fillColor(colors.muted)
    .font("Helvetica")
    .fontSize(8)
    .text(`${documentId}  |  FICTIONAL TEST FIXTURE`, 320, 46, {
      align: "right",
      width: 238,
    });
  doc
    .moveTo(54, 66)
    .lineTo(558, 66)
    .lineWidth(1)
    .strokeColor(colors.border)
    .stroke();
  doc
    .fillColor(colors.ink)
    .font("Helvetica-Bold")
    .fontSize(20)
    .text(title, 54, 86, { width: 504 });
  doc
    .fillColor(colors.muted)
    .font("Helvetica")
    .fontSize(10)
    .text(subtitle, 54, 116, { width: 504 });
  doc
    .fillColor(colors.muted)
    .fontSize(8)
    .text(`Page ${page} of ${pages}`, 54, 728, { align: "right", width: 504 });
  doc
    .fillColor(colors.muted)
    .fontSize(7.5)
    .text(
      "Fictional test fixture only. Not a binder, policy, certificate, investment agreement, or legal document.",
      54,
      728,
      { width: 390 },
    );
}

function addSectionTitle(doc, title, y) {
  doc
    .fillColor(colors.accent)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(title.toUpperCase(), 54, y, { characterSpacing: 0.7 });
  return y + 22;
}

function addBody(doc, text, y, options = {}) {
  doc
    .fillColor(options.color ?? colors.ink)
    .font(options.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(options.size ?? 10)
    .text(text, options.x ?? 54, y, {
      width: options.width ?? 504,
      lineGap: options.lineGap ?? 3,
      ...options.textOptions,
    });
  return doc.y;
}

function addFactGrid(doc, facts, y) {
  const rowHeight = 30;
  for (const [index, [label, value]] of facts.entries()) {
    const rowY = y + index * rowHeight;
    doc
      .roundedRect(54, rowY, 504, rowHeight - 3, 3)
      .fillAndStroke(index % 2 === 0 ? colors.accentWash : "#FFFFFF", colors.border);
    doc
      .fillColor(colors.muted)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(label.toUpperCase(), 66, rowY + 9, { width: 126 });
    doc
      .fillColor(colors.ink)
      .font("Helvetica")
      .fontSize(9)
      .text(value, 194, rowY + 8, { width: 352 });
  }
  return y + facts.length * rowHeight + 8;
}

function addNumberedTerms(doc, terms, y) {
  let cursor = y;
  for (const [index, term] of terms.entries()) {
    doc
      .fillColor(colors.accent)
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(`${index + 1}.`, 60, cursor, { width: 20 });
    doc
      .fillColor(colors.ink)
      .font("Helvetica")
      .fontSize(10)
      .text(term, 84, cursor, { width: 462, lineGap: 3 });
    cursor = doc.y + 9;
  }
  return cursor;
}

async function writeBalancedPdf() {
  const documentId = "TC-COVE-REQ-001";
  const title = "Portfolio Company Insurance Schedule";
  const subtitle = "Series B preferred equity investment in Cove Technologies Inc.";
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 45, right: 54, bottom: 50, left: 54 },
    autoFirstPage: false,
    info: {
      Title: `${title} — ${documentId}`,
      Author: "Transformer Capital (fictional test fixture)",
      Subject: "Insurance requirements for Cove Technologies Inc.",
      CreationDate: fixtureDate,
      ModDate: fixtureDate,
    },
  });
  const completed = collectPdf(doc);

  doc.addPage();
  addPdfHeader(doc, { documentId, title, subtitle, page: 1, pages: 2 });
  let y = addSectionTitle(doc, "Transaction details", 158);
  y = addFactGrid(
    doc,
    [
      ["Investor / certificate holder", "Transformer Capital"],
      ["Portfolio company", "Cove Technologies Inc."],
      ["Company business location", "1070 Bridgeview Way, San Francisco, CA 94124"],
      ["Schedule effective date", "August 1, 2026"],
    ],
    y,
  );
  y = addSectionTitle(doc, "1. Technology Errors & Omissions Liability", y + 6);
  y = addBody(
    doc,
    "Cove Technologies Inc. shall maintain Technology Errors & Omissions Liability insurance on a claims-made basis for acts, errors, omissions, and technology services arising from its underwriting, credit, and workflow software operations.",
    y,
  );
  y = addNumberedTerms(
    doc,
    [
      "Each claim limit: not less than $2,000,000.",
      "Annual aggregate limit: not less than $5,000,000.",
      "Self-insured retention or deductible: not more than $100,000 for each claim.",
      "Retroactive date: March 15, 2026 or earlier.",
    ],
    y + 12,
  );
  doc
    .roundedRect(54, y + 4, 504, 58, 4)
    .fillAndStroke(colors.accentWash, colors.border);
  addBody(
    doc,
    "Limit interpretation: the each-claim limit and annual aggregate are separate requirements. A single undifferentiated policy limit does not, by itself, establish both values.",
    y + 18,
    { x: 68, width: 476, bold: true, size: 9 },
  );

  doc.addPage();
  addPdfHeader(doc, { documentId, title, subtitle, page: 2, pages: 2 });
  y = addSectionTitle(doc, "2. Network Security & Privacy Liability", 158);
  y = addBody(
    doc,
    "Cove Technologies Inc. shall maintain Network Security & Privacy Liability (Cyber) insurance on a claims-made basis covering privacy liability, security failure, and incident response costs.",
    y,
  );
  y = addNumberedTerms(
    doc,
    [
      "Each claim limit: not less than $1,000,000.",
      "Annual aggregate limit: not less than $3,000,000.",
      "Self-insured retention or deductible: not more than $100,000 for each claim.",
    ],
    y + 12,
  );
  y = addSectionTitle(doc, "3. Express exclusions from the insurance requirement", y + 10);
  y = addBody(
    doc,
    "Transformer Capital does not require additional insured status, a waiver of subrogation, or primary and non-contributory wording under this schedule. No Commercial General Liability, Directors & Officers Liability, Workers Compensation, or Automobile Liability requirement is imposed by this schedule.",
    y,
  );
  y = addSectionTitle(doc, "4. Administrative items — not coverage requirements", y + 18);
  doc
    .roundedRect(54, y, 504, 118, 4)
    .fillAndStroke(colors.warningWash, colors.border);
  addBody(
    doc,
    "For transaction administration only: provide a certificate of insurance within ten business days; request 30 days' advance notice of cancellation where commercially available; and use an insurer rated A- VII or better by AM Best. These items are not minimum policy coverage requirements and should not be converted into coverage rules.",
    y + 16,
    { x: 68, width: 476, size: 9.5 },
  );
  y = addSectionTitle(doc, "Certificate delivery", y + 138);
  addBody(
    doc,
    "Certificate holder: Transformer Capital\nAttention: Portfolio Operations\nEmail: certificates@transformer-capital.example",
    y,
  );

  doc.end();
  await writeFile(
    `${outputDirectory}/01-transformer-capital-balanced-requirements.pdf`,
    await completed,
  );
}

async function writeStrictPdf() {
  const documentId = "TC-COVE-REQ-002";
  const title = "Enhanced Insurance Conditions";
  const subtitle = "Proposed closing condition — deliberately above Cove's seeded policy limits";
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 45, right: 54, bottom: 50, left: 54 },
    autoFirstPage: false,
    info: {
      Title: `${title} — ${documentId}`,
      Author: "Transformer Capital (fictional test fixture)",
      Subject: "Strict insurance requirements for Cove Technologies Inc.",
      CreationDate: fixtureDate,
      ModDate: fixtureDate,
    },
  });
  const completed = collectPdf(doc);

  doc.addPage();
  addPdfHeader(doc, { documentId, title, subtitle, page: 1, pages: 1 });
  let y = addSectionTitle(doc, "Transaction details", 158);
  y = addFactGrid(
    doc,
    [
      ["Investor / certificate holder", "Transformer Capital"],
      ["Portfolio company", "Cove Technologies Inc."],
      ["Company business location", "1070 Bridgeview Way, San Francisco, CA 94124"],
      ["Proposed closing date", "September 1, 2026"],
    ],
    y,
  );
  y = addSectionTitle(doc, "Required coverage before closing", y + 6);
  y = addBody(
    doc,
    "The following are independent minimums. Satisfaction of an annual aggregate does not satisfy an each-claim or each-occurrence minimum, and vice versa.",
    y,
    { bold: true },
  );
  y = addNumberedTerms(
    doc,
    [
      "Technology Errors & Omissions Liability (claims-made): $7,500,000 each claim and $10,000,000 annual aggregate; maximum retention $25,000 each claim; endorsement form TC EO 01 (08/26) required.",
      "Network Security & Privacy Liability (Cyber): $5,000,000 each event or occurrence and $5,000,000 annual aggregate; maximum retention $25,000 each occurrence.",
      "The required Technology Errors & Omissions coverage must apply to Cove Technologies Inc. at 1070 Bridgeview Way, San Francisco, CA 94124.",
    ],
    y + 12,
  );
  y = addSectionTitle(doc, "Administrative condition — not a coverage rule", y + 14);
  doc
    .roundedRect(54, y, 504, 68, 4)
    .fillAndStroke(colors.warningWash, colors.border);
  addBody(
    doc,
    "A certificate must be emailed to closing@transformer-capital.example before funding. This delivery instruction does not create an additional line of insurance.",
    y + 17,
    { x: 68, width: 476, size: 9.5 },
  );

  doc.end();
  await writeFile(
    `${outputDirectory}/02-transformer-capital-strict-closing-conditions.pdf`,
    await completed,
  );
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function docxParagraph(text, style = "Body") {
  if (!text) return "<w:p/>";
  const lines = text.split("\n");
  const runs = lines
    .map(
      (line, index) =>
        `${index ? "<w:r><w:br/></w:r>" : ""}<w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`,
    )
    .join("");
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${runs}</w:p>`;
}

async function writeAmendmentDocx() {
  const zip = new JSZip();
  const paragraphs = [
    ["TRANSFORMER CAPITAL", "Eyebrow"],
    ["Insurance Schedule Amendment", "Title"],
    ["TC-COVE-REQ-003 | FICTIONAL TEST FIXTURE", "Subtitle"],
    ["Portfolio company: Cove Technologies Inc.", "Body"],
    ["Company business location: 1070 Bridgeview Way, San Francisco, CA 94124", "Body"],
    ["Investor and certificate holder: Transformer Capital", "Body"],
    ["Effective date: August 15, 2026", "Body"],
    ["1. Replacement requirement", "Heading1"],
    [
      "This amendment replaces the professional liability insurance paragraph in the draft investment agreement. Cove Technologies Inc. shall maintain Technology Errors & Omissions Liability on a claims-made basis with an each claim limit of not less than $1,000,000 and an annual aggregate limit of not less than $1,000,000.",
      "Body",
    ],
    ["2. Requirements intentionally not imposed", "Heading1"],
    [
      "No Directors & Officers Liability, Commercial General Liability, Workers Compensation, Automobile Liability, additional insured status, waiver of subrogation, or primary and non-contributory wording is required by this amendment.",
      "Body",
    ],
    ["3. Contract administration only", "Heading1"],
    [
      "The insurer should be rated A- VII or better by AM Best. Cove should deliver a certificate within ten business days, request 30 days' cancellation notice where available, promptly report claims, and flow appropriate insurance obligations to subcontractors. Cove also agrees to customary indemnification. These are administrative or contract terms, not policy coverage requirements, and must not be extracted as additional coverage rules.",
      "Body",
    ],
    ["Certificate contact: certificates@transformer-capital.example", "Body"],
    [
      "Fictional test fixture only. Not a binder, policy, certificate, investment agreement, or legal document.",
      "FooterNote",
    ],
  ];
  const body = paragraphs
    .map(([text, style]) => docxParagraph(text, style))
    .join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/>
    </w:sectPr>
  </w:body>
</w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Body">
    <w:name w:val="Body"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="21"/><w:color w:val="172033"/></w:rPr>
    <w:pPr><w:spacing w:after="140" w:line="300" w:lineRule="auto"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Eyebrow">
    <w:name w:val="Eyebrow"/><w:basedOn w:val="Body"/><w:rPr><w:b/><w:color w:val="3155A6"/><w:sz w:val="18"/><w:caps/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/><w:basedOn w:val="Body"/><w:rPr><w:b/><w:color w:val="172033"/><w:sz w:val="38"/></w:rPr>
    <w:pPr><w:spacing w:before="160" w:after="120"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/><w:basedOn w:val="Body"/><w:rPr><w:color w:val="667085"/><w:sz w:val="18"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="Heading 1"/><w:basedOn w:val="Body"/><w:rPr><w:b/><w:color w:val="3155A6"/><w:sz w:val="23"/></w:rPr>
    <w:pPr><w:spacing w:before="280" w:after="100"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="FooterNote">
    <w:name w:val="Footer Note"/><w:basedOn w:val="Body"/><w:rPr><w:i/><w:color w:val="667085"/><w:sz w:val="16"/></w:rPr>
    <w:pPr><w:spacing w:before="320"/></w:pPr>
  </w:style>
</w:styles>`;
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
  const packageRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
  const documentRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Insurance Schedule Amendment — TC-COVE-REQ-003</dc:title>
  <dc:creator>Transformer Capital (fictional test fixture)</dc:creator>
  <dc:subject>Insurance requirements for Cove Technologies Inc.</dc:subject>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-08-01T12:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-08-01T12:00:00Z</dcterms:modified>
</cp:coreProperties>`;
  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Spot test fixture generator</Application>
</Properties>`;

  const fileOptions = { date: fixtureDate };
  zip.file("[Content_Types].xml", contentTypesXml, fileOptions);
  zip.folder("_rels").file(".rels", packageRelationshipsXml, fileOptions);
  zip.folder("word").file("document.xml", documentXml, fileOptions);
  zip.folder("word").file("styles.xml", stylesXml, fileOptions);
  zip.folder("word").folder("_rels").file("document.xml.rels", documentRelationshipsXml, fileOptions);
  zip.folder("docProps").file("core.xml", coreXml, fileOptions);
  zip.folder("docProps").file("app.xml", appXml, fileOptions);
  zip.forEach((_relativePath, file) => {
    file.date = fixtureDate;
  });

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "UNIX",
  });
  await writeFile(
    `${outputDirectory}/03-transformer-capital-requirements-amendment.docx`,
    buffer,
  );
}

await mkdir(outputDirectory, { recursive: true });
await Promise.all([writeBalancedPdf(), writeStrictPdf(), writeAmendmentDocx()]);

console.log("Generated Transformer Capital requirement fixtures in", outputDirectory);
