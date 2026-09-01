import { describe, expect, test } from "vitest";

import { inferProcurementUploadPurpose } from "./procurement-files";

describe("procurement upload purpose", () => {
  test.each([
    ["QUOTE (003).pdf", "quote"],
    ["Property proposal.pdf", "quote"],
    ["ACORD 125 application.pdf", "application"],
    ["broker-message.eml", "correspondence"],
    ["Building appraisal.pdf", "requirements"],
    ["1305 Carroll roof condition report.docx", "requirements"],
    ["2025.pdf", "requirements"],
  ])("classifies %s as %s", (fileName, expected) => {
    expect(inferProcurementUploadPurpose(fileName)).toBe(expected);
  });
});
