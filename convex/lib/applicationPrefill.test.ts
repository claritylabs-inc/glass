import { describe, it, expect } from "vitest";
import { resolvePrefill, type PrefillContext, type QuestionForPrefill } from "./applicationPrefill";

const baseQuestion: QuestionForPrefill = {
  intentKey: "annual_revenue",
  answerType: "currency",
  binding: undefined,
};

describe("resolvePrefill", () => {
  it("explicit binding wins over everything", () => {
    const q: QuestionForPrefill = {
      ...baseQuestion,
      binding: { source: "passport", target: "financials.annualRevenue" },
    };
    const ctx: PrefillContext = {
      passportValues: { "financials.annualRevenue": 5_000_000 },
      integrationValues: { "quickbooks:revenue": 6_000_000 },
    };
    const result = resolvePrefill(q, ctx);
    expect(result?.source).toBe("passport");
    expect(result?.value).toBe(5_000_000);
  });

  it("falls back to passportFieldPath from intent when no binding", () => {
    const q: QuestionForPrefill = { ...baseQuestion, passportFieldPath: "financials.annualRevenue" };
    const ctx: PrefillContext = {
      passportValues: { "financials.annualRevenue": 3_000_000 },
      integrationValues: {},
    };
    const result = resolvePrefill(q, ctx);
    expect(result?.source).toBe("passport");
    expect(result?.value).toBe(3_000_000);
  });

  it("falls back to integration candidate", () => {
    const q: QuestionForPrefill = {
      ...baseQuestion,
      passportFieldPath: undefined,
      integrationCandidates: ["quickbooks:revenue"],
    };
    const ctx: PrefillContext = {
      passportValues: {},
      integrationValues: { "quickbooks:revenue": 7_000_000 },
    };
    const result = resolvePrefill(q, ctx);
    expect(result?.source).toBe("integration");
    expect(result?.value).toBe(7_000_000);
    expect(result?.connectorKey).toBe("quickbooks:revenue");
  });

  it("returns null when nothing matches", () => {
    const q: QuestionForPrefill = { ...baseQuestion };
    const ctx: PrefillContext = { passportValues: {}, integrationValues: {} };
    expect(resolvePrefill(q, ctx)).toBeNull();
  });
});
