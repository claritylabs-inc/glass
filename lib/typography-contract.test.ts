// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { redactionLevels, typographyRoles } from "./typography";

const FONT_HASHES = {
  "Redaction-Bold.woff2": "882f894183ab93f6781af59fc5f0f4619870c189e69411235507095c0f05886a",
  "Redaction-Italic.woff2": "7a4422a14b1defb5a4027e8bfd9b8d70098bfda9eea4437721d2878215954ece",
  "Redaction-Regular.woff2": "01a800a24bda48886fd1893f2aa20cab80db05ef2cdbb4025048438429ad5779",
  "Redaction100-Regular.woff2": "6811129cb3cee1125bbc81fa357b17193dea5e27c14ed25cca22d5cf745ed6b1",
  "Redaction35-Regular.woff2": "eea39b70eabf1539754e025abfc8382f14f034a9fca1557c8516acaa04d43f3e",
  "Redaction50-Regular.woff2": "f7cac2422e6decc16b6233243dd315d826ee983b3651689df6097b31cbcbcec5",
  "Redaction70-Regular.woff2": "1e922afe6452f402fc532fc3b9a9b75ac4a07571135919083fefc951689810c0",
} as const;

describe("typography contract artifacts", () => {
  it("matches every copied Redaction asset hash", () => {
    const fontDirectory = path.join(process.cwd(), "app/fonts/redaction");
    expect(readdirSync(fontDirectory).sort()).toEqual(Object.keys(FONT_HASHES).sort());
    for (const [file, expectedHash] of Object.entries(FONT_HASHES)) {
      const hash = createHash("sha256")
        .update(readFileSync(path.join(fontDirectory, file)))
        .digest("hex");
      expect(hash, file).toBe(expectedHash);
    }
  });

  it("registers degraded cuts without eager preload and removes Instrument Serif", () => {
    const layout = readFileSync(path.join(process.cwd(), "app/layout.tsx"), "utf8");
    const globals = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    for (const level of ["35", "50", "70", "100"]) {
      expect(layout).toMatch(
        new RegExp(`const redaction${level} = localFont\\(\\{[\\s\\S]*?variable: "--font-redaction-${level}"[\\s\\S]*?preload: false,[\\s\\S]*?\\}\\);`),
      );
    }
    expect(`${layout}\n${globals}`).not.toMatch(/Instrument_Serif|font-instrument-serif|\.serif\b/);
  });

  it("documents every role and Redaction level", () => {
    const guide = readFileSync(path.join(process.cwd(), "docs/design/typography.md"), "utf8");
    for (const role of Object.keys(typographyRoles)) expect(guide).toContain(`\`${role}\``);
    for (const level of redactionLevels) expect(guide).toMatch(new RegExp(`\\b${level}\\b`));
  });
});
