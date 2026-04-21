export type QuestionForPrefill = {
  intentKey?: string;
  answerType: string;
  binding?: { source: string; target?: string } | undefined;
  passportFieldPath?: string;
  integrationCandidates?: string[];
};

export type PrefillContext = {
  passportValues: Record<string, unknown>;
  integrationValues: Record<string, unknown>;
};

export type PrefillResult = {
  value: unknown;
  source: "passport" | "integration";
  connectorKey?: string;
};

export function resolvePrefill(
  question: QuestionForPrefill,
  ctx: PrefillContext,
): PrefillResult | null {
  // 1. Explicit binding wins
  if (question.binding) {
    const { source, target } = question.binding;
    if (source === "passport" && target) {
      const value = ctx.passportValues[target];
      if (value !== undefined) return { value, source: "passport" };
    }
    if (source === "integration" && target) {
      const value = ctx.integrationValues[target];
      if (value !== undefined) return { value, source: "integration", connectorKey: target };
    }
    return null;
  }

  // 2. Intent passportFieldPath
  if (question.passportFieldPath) {
    const value = ctx.passportValues[question.passportFieldPath];
    if (value !== undefined) return { value, source: "passport" };
  }

  // 3. Integration candidates (first match wins)
  if (question.integrationCandidates) {
    for (const key of question.integrationCandidates) {
      const value = ctx.integrationValues[key];
      if (value !== undefined) return { value, source: "integration", connectorKey: key };
    }
  }

  return null;
}
