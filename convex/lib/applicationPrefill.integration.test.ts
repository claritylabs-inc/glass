// convex/lib/applicationPrefill.integration.test.ts
//
// Tests for the extended resolvePrefill that reads from integrationValues
// using the merge:category:metricKey convention.

import { describe, it, expect } from "vitest";
import { resolvePrefill } from "./applicationPrefill";
import type { QuestionForPrefill, PrefillContext } from "./applicationPrefill";

describe("resolvePrefill — integration candidates", () => {
  const ctx: PrefillContext = {
    passportValues: {},
    integrationValues: {
      "merge:accounting:accounting.annual_revenue": 2_400_000,
      "merge:hris:hris.headcount": 42,
    },
  };

  it("returns integration value when candidate key matches", () => {
    const q: QuestionForPrefill = {
      answerType: "currency",
      integrationCandidates: ["merge:accounting:accounting.annual_revenue"],
    };
    const result = resolvePrefill(q, ctx);
    expect(result).not.toBeNull();
    expect(result!.source).toBe("integration");
    expect(result!.value).toBe(2_400_000);
    expect(result!.connectorKey).toBe("merge:accounting:accounting.annual_revenue");
  });

  it("falls through to next candidate when first is missing", () => {
    const q: QuestionForPrefill = {
      answerType: "number",
      integrationCandidates: [
        "merge:accounting:accounting.missing_key",
        "merge:hris:hris.headcount",
      ],
    };
    const result = resolvePrefill(q, ctx);
    expect(result!.value).toBe(42);
    expect(result!.connectorKey).toBe("merge:hris:hris.headcount");
  });

  it("returns null when no integration candidate matches and no passport value", () => {
    const q: QuestionForPrefill = {
      answerType: "text",
      integrationCandidates: ["merge:payroll:payroll.total_payroll_ytd"],
    };
    const result = resolvePrefill(q, ctx);
    expect(result).toBeNull();
  });

  it("passport path wins over integration candidate when both present", () => {
    const ctxWithPassport: PrefillContext = {
      passportValues: { annualRevenue: 999 },
      integrationValues: {
        "merge:accounting:accounting.annual_revenue": 2_400_000,
      },
    };
    const q: QuestionForPrefill = {
      answerType: "currency",
      passportFieldPath: "annualRevenue",
      integrationCandidates: ["merge:accounting:accounting.annual_revenue"],
    };
    const result = resolvePrefill(q, ctxWithPassport);
    expect(result!.source).toBe("passport");
    expect(result!.value).toBe(999);
  });
});
