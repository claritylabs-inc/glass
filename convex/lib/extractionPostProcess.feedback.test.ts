import { describe, expect, it } from "vitest";
import { stripUngroundedSourceSensitiveValues } from "./extractionPostProcess";

describe("extraction post-process feedback", () => {

  it("counts source-sensitive checks as the denominator for stripped values", () => {
    const result = stripUngroundedSourceSensitiveValues({
      carrier: "Acme Insurance",
      policyNumber: "NOT-IN-SOURCE",
    }, [{ text: "Policy issued by Acme Insurance" }]);

    expect(result.value.carrier).toBe("Acme Insurance");
    expect(result.value.policyNumber).toBeUndefined();
    expect(result.removed).toHaveLength(1);
    expect(result.sensitiveFieldCount).toBe(2);
  });
});
