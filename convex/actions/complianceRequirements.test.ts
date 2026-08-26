import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  RequirementImportSchema,
  extractDocxText,
  inferRequirementSourceType,
  normalizeImportedCertificateHolder,
} from "./complianceRequirements";

describe("requirement document parsing", () => {
  it("classifies agreements as client contract sources", () => {
    expect(
      inferRequirementSourceType("Program Manager Agreement v2.pdf"),
    ).toBe("client_contract");
  });

  it("extracts text from the DOCX fixture with Mammoth's Node buffer API", async () => {
    const fixturePath = fileURLToPath(
      new URL(
        "../../docs/testing/requirements-fixtures/03-transformer-capital-requirements-amendment.docx",
        import.meta.url,
      ),
    );
    const bytes = await readFile(fixturePath);
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );

    const text = await extractDocxText(arrayBuffer);

    expect(text).toContain("Transformer Capital");
    expect(text).toContain("each claim limit of not less than $1,000,000");
    expect(text).toContain("Commercial General Liability");
    expect(text).toContain("is required by this amendment");
  });
});

describe("requirement source extraction contract", () => {
  it("retains structured certificate-holder company and contact details", () => {
    const extracted = RequirementImportSchema.parse({
      certificateHolders: [
        {
          displayName: " Captive Risk Solutions Corporation ",
          contactName: " Andrew Matczak ",
          email: " Andrew@ladderre.com ",
          phone: null,
          address: {
            line1: " 6731 N. 12th Way ",
            line2: null,
            city: " Phoenix ",
            state: " AZ ",
            postalCode: " 85014 ",
            country: null,
            formatted: null,
          },
          sourceExcerpt:
            "Attn: Andrew Matczak, Captive Risk Solutions Corporation, 6731 N. 12th Way, Phoenix, AZ 85014, Andrew@ladderre.com",
        },
      ],
      requirements: [],
    });

    expect(
      extracted.certificateHolders.map(normalizeImportedCertificateHolder),
    ).toEqual([
      {
        displayName: "Captive Risk Solutions Corporation",
        contactName: "Andrew Matczak",
        email: "Andrew@ladderre.com",
        phone: undefined,
        address: {
          line1: "6731 N. 12th Way",
          line2: undefined,
          city: "Phoenix",
          state: "AZ",
          postalCode: "85014",
          country: undefined,
          formatted: undefined,
        },
      },
    ]);
  });
});
