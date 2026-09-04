import { describe, expect, it } from "vitest";
import { classifyExtractionIntegrity } from "./extractionIntegrityAudit";

describe("classifyExtractionIntegrity", () => {
  it("keeps legacy-unverified rows separate from post-cutover violations", () => {
    expect(classifyExtractionIntegrity({
      postCutover: false,
      operationalProfile: {},
      hasValidCarrierIdentity: false,
    }).classification).toBe("legacy_unverified");
    expect(classifyExtractionIntegrity({
      postCutover: true,
      operationalProfile: {},
      hasValidCarrierIdentity: false,
    }).classification).toBe("post_cutover_violation");
  });
});
