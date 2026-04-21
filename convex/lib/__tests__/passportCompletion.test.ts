import { describe, it, expect } from "vitest";
import { resolveCompletionStatus } from "../passportCompletion";

describe("resolveCompletionStatus", () => {
  it("returns core=false when coreCompletedAt is absent", () => {
    const result = resolveCompletionStatus(
      { coreCompletedAt: undefined } as any,
      ["applicant_info", "nature_of_business", "locations", "general_info"]
    );
    expect(result.core).toBe(false);
  });

  it("returns core=true and no missing sections when all required are done", () => {
    const result = resolveCompletionStatus(
      { coreCompletedAt: Date.now() } as any,
      ["applicant_info", "nature_of_business", "locations", "general_info"]
    );
    expect(result.core).toBe(true);
    expect(result.requiredExtras).toBe(true);
    expect(result.missingSections).toHaveLength(0);
  });

  it("lists missing extra sections when requiredExtras incomplete", () => {
    const result = resolveCompletionStatus(
      { coreCompletedAt: Date.now(), _completedExtras: ["prior_carrier"] } as any,
      ["applicant_info", "nature_of_business", "locations", "general_info", "loss_history"]
    );
    expect(result.requiredExtras).toBe(false);
    expect(result.missingSections).toContain("loss_history");
  });
});
