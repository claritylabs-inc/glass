import type { Id } from "../_generated/dataModel";

export type ConditionalExpr = {
  all?: ConditionalExpr[];
  any?: ConditionalExpr[];
  not?: ConditionalExpr;
  questionId?: Id<"applicationQuestions">;
  intentKey?: string;
  operator?: "equals" | "not_equals" | "truthy" | "falsy" | "contains" | "gt" | "lt";
  value?: unknown;
};

/**
 * Pure evaluator. answers is a map of questionId (or intentKey) → value.
 * Pass both questionId-keyed and intentKey-keyed entries in the same map.
 */
export function evaluateConditional(
  expr: ConditionalExpr,
  answers: Record<string, unknown>,
): boolean {
  if (expr.all) return expr.all.every((e) => evaluateConditional(e, answers));
  if (expr.any) return expr.any.some((e) => evaluateConditional(e, answers));
  if (expr.not) return !evaluateConditional(expr.not, answers);

  const key = expr.questionId ?? expr.intentKey;
  if (!key || !expr.operator) return true; // vacuously visible

  const actual = key in answers ? answers[key] : undefined;

  switch (expr.operator) {
    case "truthy":  return !!actual;
    case "falsy":   return !actual;
    case "equals":  return actual === expr.value;
    case "not_equals": return actual !== expr.value;
    case "gt":      return typeof actual === "number" && typeof expr.value === "number" && actual > expr.value;
    case "lt":      return typeof actual === "number" && typeof expr.value === "number" && actual < expr.value;
    case "contains":
      return typeof actual === "string" && typeof expr.value === "string" && actual.includes(expr.value);
    default:        return true;
  }
}
