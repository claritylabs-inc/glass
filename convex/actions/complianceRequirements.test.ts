import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractDocxText,
  inferRequirementSourceType,
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
