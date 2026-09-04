import { describe, expect, it } from "vitest";

import {
  generateCoiPdf,
  policyToCoiData,
} from "../convex/lib/coiGenerator";

async function pdfText(pdf: Buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await getDocument({ data: new Uint8Array(pdf) }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(
      content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
    );
  }
  await document.destroy();
  return { pages, text: pages.join("\n") };
}

describe("COI PDF generation", () => {
  it("paginates coverage rows without dropping the final source-backed value", async () => {
    const base = policyToCoiData({
      linesOfBusiness: ["PROPC"],
      policyNumber: "ROW-PAGINATION",
      carrier: "Pagination Carrier",
      insuredName: "Pagination Insured",
    });
    const coverages = Array.from({ length: 28 }, (_, index) => ({
      type: `Scheduled Coverage ${index + 1}`,
      lineOfBusiness: index % 2 === 0 ? "INMRC" : "PROPC",
      insurerLetter: "A",
      policyNumber: `ROW-${index + 1}`,
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      limits: [
        {
          label: `Exact Source Limit ${index + 1}`,
          value: `$${(index + 1) * 10000}`,
        },
      ],
      deductible: `$${(index + 1) * 100}`,
    }));

    const extracted = await pdfText(
      await generateCoiPdf({ ...base, formCode: "acord28", coverages }),
    );

    expect(extracted.pages.length).toBeGreaterThan(1);
    expect(extracted.pages[0]).toContain("Scheduled Coverage 1");
    expect(extracted.text).toContain("Scheduled Coverage 28");
    expect(extracted.text).toContain("Exact Source Limit 28");
    expect(extracted.text).toContain("$280000");
  });
});
