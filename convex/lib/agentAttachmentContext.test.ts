import type { ModelMessage } from "ai";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import {
  buildAgentAttachmentParts,
  modelMessagesHaveImageInput,
  withLatestUserAttachmentParts,
} from "./agentAttachmentContext";

function blobFromBytes(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer]);
}

describe("shared agent attachment context", () => {
  test("adds bounded text and image parts to the latest user turn", async () => {
    const textId = "text-file" as Id<"_storage">;
    const imageId = "image-file" as Id<"_storage">;
    const blobs = new Map<string, Blob>([
      [String(textId), new Blob(["policy,premium\nGL-1,1200"])],
      [String(imageId), new Blob([new Uint8Array([1, 2, 3])])],
    ]);
    const context = await buildAgentAttachmentParts(
      {
        storage: {
          get: async (fileId: Id<"_storage">) =>
            blobs.get(String(fileId)) ?? null,
        },
      } as never,
      [
        {
          fileId: textId,
          filename: "renewals.csv",
          contentType: "text/csv",
          size: 24,
        },
        {
          fileId: imageId,
          filename: "declarations.png",
          contentType: "image/png",
          size: 3,
        },
      ],
      { includeRichParts: true, remainingTextChars: { value: 80_000 } },
    );
    const history: ModelMessage[] = [
      { role: "user", content: "Review these files." },
    ];
    const augmented = withLatestUserAttachmentParts(history, context.parts);

    expect(context.names).toEqual(["renewals.csv", "declarations.png"]);
    expect(context.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("GL-1,1200"),
        }),
        expect.objectContaining({ type: "image", mediaType: "image/png" }),
      ]),
    );
    expect(context.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("Image attachment: declarations.png"),
        }),
      ]),
    );
    expect(modelMessagesHaveImageInput(augmented)).toBe(true);
    expect(augmented.at(-1)).toMatchObject({ role: "user" });
  });

  test("marks empty and budget-omitted files instead of claiming they were read", async () => {
    const emptyId = "empty-file" as Id<"_storage">;
    const omittedId = "omitted-file" as Id<"_storage">;
    const blobs = new Map<string, Blob>([
      [String(emptyId), new Blob([""])],
      [String(omittedId), new Blob(["important evidence"])],
    ]);
    const context = await buildAgentAttachmentParts(
      {
        storage: {
          get: async (fileId: Id<"_storage">) =>
            blobs.get(String(fileId)) ?? null,
        },
      } as never,
      [
        {
          fileId: emptyId,
          filename: "empty.txt",
          contentType: "text/plain",
          size: 0,
        },
        {
          fileId: omittedId,
          filename: "later.txt",
          contentType: "text/plain",
          size: 18,
        },
      ],
      { includeRichParts: true, remainingTextChars: { value: 0 } },
    );

    const text = context.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    expect(text).toContain("No readable text was extracted");
    expect(text).toContain("text budget was exhausted");
  });

  test("fails closed on corrupt and expansion-heavy Office archives", async () => {
    const corruptId = "corrupt-office" as Id<"_storage">;
    const expandedId = "expanded-office" as Id<"_storage">;
    const archive = new JSZip();
    archive.file("xl/worksheets/sheet1.xml", new Uint8Array(33 * 1024 * 1024));
    const compressed = await archive.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
    });
    const blobs = new Map<string, Blob>([
      [String(corruptId), new Blob(["not a zip archive"])],
      [String(expandedId), new Blob([new Uint8Array(compressed).buffer])],
    ]);
    const context = await buildAgentAttachmentParts(
      {
        storage: {
          get: async (fileId: Id<"_storage">) =>
            blobs.get(String(fileId)) ?? null,
        },
      } as never,
      [
        {
          fileId: corruptId,
          filename: "corrupt.xlsx",
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: 17,
        },
        {
          fileId: expandedId,
          filename: "expanded.xlsx",
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: compressed.byteLength,
        },
      ],
      { includeRichParts: true, remainingTextChars: { value: 80_000 } },
    );

    const text = context.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    expect(text).toContain("corrupt.xlsx");
    expect(text).toContain("expanded.xlsx");
    expect(text.match(/could not be read/g)).toHaveLength(2);
  });

  test("extracts readable text from XLSX, DOCX, and PPTX attachments", async () => {
    const xlsx = new JSZip();
    xlsx.file(
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    );
    xlsx.file(
      "_rels/.rels",
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    );
    xlsx.file(
      "xl/workbook.xml",
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Renewals" sheetId="1" r:id="rId1"/></sheets></workbook>',
    );
    xlsx.file(
      "xl/_rels/workbook.xml.rels",
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    );
    xlsx.file(
      "xl/worksheets/sheet1.xml",
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Policy</t></is></c><c r="B1" t="inlineStr"><is><t>Premium</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>GL-42</t></is></c><c r="B2"><v>2400</v></c></row></sheetData></worksheet>',
    );

    const docx = new JSZip();
    docx.file(
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    docx.file(
      "_rels/.rels",
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    docx.file(
      "word/document.xml",
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Named insured: Cove LLC</w:t></w:r></w:p></w:body></w:document>',
    );

    const pptx = new JSZip();
    pptx.file(
      "ppt/slides/slide1.xml",
      '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><a:t>Renewal strategy</a:t><a:t>Bind by Friday</a:t></p:cSld></p:sld>',
    );

    const [xlsxBytes, docxBytes, pptxBytes] = await Promise.all(
      [xlsx, docx, pptx].map((archive) =>
        archive.generateAsync({ type: "uint8array" }),
      ),
    );
    const ids = {
      xlsx: "real-xlsx" as Id<"_storage">,
      docx: "real-docx" as Id<"_storage">,
      pptx: "real-pptx" as Id<"_storage">,
    };
    const blobs = new Map<string, Blob>([
      [String(ids.xlsx), blobFromBytes(xlsxBytes)],
      [String(ids.docx), blobFromBytes(docxBytes)],
      [String(ids.pptx), blobFromBytes(pptxBytes)],
    ]);
    const attachments = [
      {
        fileId: ids.xlsx,
        filename: "renewals.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: xlsxBytes.byteLength,
      },
      {
        fileId: ids.docx,
        filename: "insured.docx",
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: docxBytes.byteLength,
      },
      {
        fileId: ids.pptx,
        filename: "strategy.pptx",
        contentType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        size: pptxBytes.byteLength,
      },
    ];

    const context = await buildAgentAttachmentParts(
      {
        storage: {
          get: async (fileId: Id<"_storage">) =>
            blobs.get(String(fileId)) ?? null,
        },
      } as never,
      attachments,
      { includeRichParts: true, remainingTextChars: { value: 80_000 } },
    );
    const text = context.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");

    expect(text).toContain("Policy,Premium");
    expect(text).toContain("GL-42,2400");
    expect(text).toContain("Named insured: Cove LLC");
    expect(text).toContain("Renewal strategy");
    expect(text).toContain("Bind by Friday");
  });

  test("extracts text from a real PDF before using rich-file fallback", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([612, 792]);
    page.drawText("Policy GL-42 renews Friday", {
      x: 72,
      y: 720,
      size: 14,
      font,
    });
    const bytes = await pdf.save();
    const fileId = "real-pdf" as Id<"_storage">;

    const context = await buildAgentAttachmentParts(
      {
        storage: {
          get: async () => blobFromBytes(bytes),
        },
      } as never,
      [
        {
          fileId,
          filename: "policy.pdf",
          contentType: "application/pdf",
          size: bytes.byteLength,
        },
      ],
      { includeRichParts: true, remainingTextChars: { value: 80_000 } },
    );

    expect(context.parts).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("Policy GL-42 renews Friday"),
      }),
    ]);
  });
});
