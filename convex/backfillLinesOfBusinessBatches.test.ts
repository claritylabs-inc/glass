import { describe, expect, test } from "vitest";
import { policyLineBackfillDecision } from "./backfillLinesOfBusinessBatches";

describe("backfillLinesOfBusinessBatches", () => {
  test("plans legacy policy migrations without mutating rows", () => {
    expect(policyLineBackfillDecision({
      policyTypes: ["professional_liability", "cyber"],
    })).toEqual({
      before: ["professional_liability", "cyber"],
      after: ["PL", "CYBER"],
      unmappedValues: [],
      changed: true,
    });
    expect(policyLineBackfillDecision({
      linesOfBusiness: ["CGL"],
      policyTypes: ["general_liability"],
    })).toEqual({
      before: ["general_liability"],
      after: ["CGL"],
      unmappedValues: [],
      changed: false,
    });
    expect(policyLineBackfillDecision({
      linesOfBusiness: ["EO", "OLIB"],
    })).toEqual({
      before: [],
      after: ["EO", "OLIB"],
      unmappedValues: [],
      changed: false,
    });
    expect(policyLineBackfillDecision({
      policyTypes: ["bespoke_line"],
    })).toEqual({
      before: ["bespoke_line"],
      after: ["UN"],
      unmappedValues: ["bespoke_line"],
      changed: true,
    });
  });
});
