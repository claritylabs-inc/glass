import { describe, expect, it } from "vitest";
import {
  applyCarrierIdentityGuidance as applyConvexGuidance,
  CARRIER_IDENTITY_GUIDANCE as CONVEX_GUIDANCE,
} from "../convex/lib/extractionPromptGuidance";
import {
  applyCarrierIdentityGuidance as applyWorkerGuidance,
  CARRIER_IDENTITY_GUIDANCE as WORKER_GUIDANCE,
} from "../extraction-worker/src/extractionPromptGuidance";

describe("carrier identity extraction guidance", () => {
  it("keeps local and external extraction guidance identical", () => {
    expect(WORKER_GUIDANCE).toBe(CONVEX_GUIDANCE);
  });

  it.each([applyConvexGuidance, applyWorkerGuidance])(
    "adds guidance only to carrier identity extraction calls",
    (applyGuidance) => {
      expect(
        applyGuidance("Prompt", "extraction_operational_profile"),
      ).toContain("operating/trade name");
      expect(
        applyGuidance("Prompt", "extraction_operational_profile"),
      ).toContain("Never reduce that identity to generic");
      expect(
        applyGuidance("Prompt", "extraction_preview"),
      ).toContain("operating/trade name");
      expect(
        applyGuidance("Prompt", "extraction_focused", "carrier_info"),
      ).toContain("operating/trade name");
      expect(
        applyGuidance("Prompt", "extraction_focused", "coverage_limits"),
      ).toBe("Prompt");
    },
  );
});
