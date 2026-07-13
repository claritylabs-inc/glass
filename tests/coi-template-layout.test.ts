import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

function read(path: string) {
  return readFileSync(join(ROOT, path), "utf-8");
}

describe("COI PDF template layout", () => {
  it("uses the liability-certificate notice text and avoids a duplicate insurer-address box", () => {
    const source = read("convex/lib/coiGenerator.ts");

    expect(source).toContain(
      "THIS CERTIFICATE IS ISSUED AS A MATTER OF INFORMATION ONLY AND CONFERS NO RIGHTS UPON THE CERTIFICATE HOLDER. THIS CERTIFICATE DOES NOT AFFIRMATIVELY OR NEGATIVELY AMEND, EXTEND OR ALTER THE COVERAGE AFFORDED BY THE POLICIES BELOW. THIS CERTIFICATE OF INSURANCE DOES NOT CONSTITUTE A CONTRACT BETWEEN THE ISSUING INSURER(S), AUTHORIZED REPRESENTATIVE OR PRODUCER, AND THE CERTIFICATE HOLDER.",
    );
    expect(source).toContain("CERTIFICATE NUMBER:");
    expect(source).toContain("REVISION NUMBER:");
    expect(source).toContain("y = drawCertificateNumberBand(doc, data, y) + 4;");
    expect(source).toContain(
      "THIS IS TO CERTIFY THAT THE POLICIES OF INSURANCE LISTED BELOW HAVE BEEN ISSUED TO THE INSURED NAMED ABOVE FOR THE POLICY PERIOD INDICATED.",
    );
    expect(source).not.toContain("This is to certify that the policies of insurance listed below");
    expect(source).not.toContain("INSURANCE COMPANY AND MAILING ADDRESS");
    expect(source).not.toContain('sectionLabel(doc, "AUTHORIZED REPRESENTATIVE"');
    expect(source).not.toContain("Generated using");
    expect(source).not.toContain("See ACORD 101 attached");
    expect(source).toContain("INSURER(S) AFFORDING COVERAGE");
    expect(source).toContain("INSURER ${letter}:");
    expect(source).toContain("INFO_BOX_VALUE_TOP + INFO_BOX_BOTTOM_PADDING");
    expect(source).toContain("holderRequiredH > HOLDER_BOX_MAX_HEIGHT");
    expect(source).toContain("includeHolder: holderOverflows");
    expect(source).not.toContain('data.certificateHolder ?? "", bottomW - 10, FS_VALUE, false) + 18');
  });
});
