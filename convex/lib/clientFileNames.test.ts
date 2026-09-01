import { describe, expect, test } from "vitest";

import {
  boundedClientFileHint,
  buildClientFileName,
  clientFileExtension,
} from "./clientFileNames";

describe("client file names", () => {
  test("keeps the stored file extension while replacing unsafe basenames", () => {
    expect(clientFileExtension("folder/roof.report.PDF")).toBe(".PDF");
    expect(
      buildClientFileName("  123 Main Street\nRoof Appraisal.docx ", "scan.PDF"),
    ).toBe("123 Main Street Roof Appraisal.PDF");
    expect(buildClientFileName("../", "scan-004.csv")).toBe("scan-004.csv");
  });

  test("bounds upload hints", () => {
    expect(boundedClientFileHint("  latest   roof report  ")).toBe(
      "latest roof report",
    );
    expect(boundedClientFileHint("x".repeat(600))).toHaveLength(500);
  });
});
