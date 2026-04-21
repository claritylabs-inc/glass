import { describe, it, expect } from "vitest";
import { evaluateConditional, type ConditionalExpr } from "./applicationConditionals";
import type { Id } from "../_generated/dataModel";

const answers: Record<string, unknown> = {
  q1: true,
  q2: "yes",
  q3: 5,
  q4: null,
};

describe("evaluateConditional", () => {
  it("truthy operator returns true when value is truthy", () => {
    const expr: ConditionalExpr = { questionId: "q1" as Id<"applicationQuestions">, operator: "truthy" };
    expect(evaluateConditional(expr, answers)).toBe(true);
  });

  it("falsy operator returns true when value is null", () => {
    const expr: ConditionalExpr = { questionId: "q4" as Id<"applicationQuestions">, operator: "falsy" };
    expect(evaluateConditional(expr, answers)).toBe(true);
  });

  it("equals operator matches string", () => {
    const expr: ConditionalExpr = { questionId: "q2" as Id<"applicationQuestions">, operator: "equals", value: "yes" };
    expect(evaluateConditional(expr, answers)).toBe(true);
  });

  it("not_equals operator", () => {
    const expr: ConditionalExpr = { questionId: "q2" as Id<"applicationQuestions">, operator: "not_equals", value: "no" };
    expect(evaluateConditional(expr, answers)).toBe(true);
  });

  it("gt operator", () => {
    const expr: ConditionalExpr = { questionId: "q3" as Id<"applicationQuestions">, operator: "gt", value: 3 };
    expect(evaluateConditional(expr, answers)).toBe(true);
  });

  it("lt operator", () => {
    const expr: ConditionalExpr = { questionId: "q3" as Id<"applicationQuestions">, operator: "lt", value: 10 };
    expect(evaluateConditional(expr, answers)).toBe(true);
  });

  it("contains operator", () => {
    const expr: ConditionalExpr = { questionId: "q2" as Id<"applicationQuestions">, operator: "contains", value: "ye" };
    expect(evaluateConditional(expr, answers)).toBe(true);
  });

  it("all — all true", () => {
    const expr: ConditionalExpr = {
      all: [
        { questionId: "q1" as Id<"applicationQuestions">, operator: "truthy" },
        { questionId: "q2" as Id<"applicationQuestions">, operator: "equals", value: "yes" },
      ],
    };
    expect(evaluateConditional(expr, answers)).toBe(true);
  });

  it("all — one false", () => {
    const expr: ConditionalExpr = {
      all: [
        { questionId: "q1" as Id<"applicationQuestions">, operator: "truthy" },
        { questionId: "q4" as Id<"applicationQuestions">, operator: "truthy" },
      ],
    };
    expect(evaluateConditional(expr, answers)).toBe(false);
  });

  it("any — one true", () => {
    const expr: ConditionalExpr = {
      any: [
        { questionId: "q4" as Id<"applicationQuestions">, operator: "truthy" },
        { questionId: "q1" as Id<"applicationQuestions">, operator: "truthy" },
      ],
    };
    expect(evaluateConditional(expr, answers)).toBe(true);
  });

  it("not", () => {
    const expr: ConditionalExpr = {
      not: { questionId: "q4" as Id<"applicationQuestions">, operator: "truthy" },
    };
    expect(evaluateConditional(expr, answers)).toBe(true);
  });

  it("intentKey lookup falls back to undefined answer when key not in map", () => {
    const expr: ConditionalExpr = { intentKey: "missing_key", operator: "falsy" };
    expect(evaluateConditional(expr, answers)).toBe(true);
  });
});
