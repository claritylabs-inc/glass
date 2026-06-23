export type TaskControlIntent = "cancel_task" | "reset_task";
export type TaskControlResponseIntent = TaskControlIntent | "ask_confirmation";

export type TaskControlCandidate = {
  intent: TaskControlIntent;
  example: string;
  score: number;
  matchedTokens: string[];
  fuzzyMatches: Array<{ queryToken: string; exampleToken: string }>;
};

export type TaskControlRanking = {
  normalizedText: string;
  tokens: string[];
  candidates: TaskControlCandidate[];
  topCandidate?: TaskControlCandidate;
  margin: number;
  domainConflict: boolean;
  highConfidence: boolean;
  shouldUseModel: boolean;
};

const TASK_CONTROL_EXAMPLES: Array<{
  intent: TaskControlIntent;
  examples: string[];
}> = [
  {
    intent: "cancel_task",
    examples: [
      "nevermind",
      "never mind",
      "scratch this",
      "scratch that",
      "scratch it",
      "forget this",
      "forget that",
      "forget it",
      "drop this",
      "drop that",
      "drop it",
      "leave it",
      "leave this",
      "leave that",
      "leave it for now",
      "cancel this task",
      "cancel the task",
      "cancel the request",
      "stop this task",
      "stop working on this",
      "abort this task",
      "not now",
      "no thanks",
    ],
  },
  {
    intent: "reset_task",
    examples: [
      "start over",
      "start this over",
      "restart this task",
      "reset this task",
      "reset the task",
      "clear this task",
      "clear the task",
      "new task",
    ],
  },
];

const STOP_TOKENS = new Set([
  "a",
  "an",
  "and",
  "for",
  "me",
  "on",
  "please",
  "plz",
  "the",
  "to",
]);

const WEAK_REFERENCE_TOKENS = new Set(["it", "that", "this"]);

const DOMAIN_CONFLICT_TOKENS = new Set([
  "attachment",
  "attachments",
  "cancelation",
  "cancellation",
  "carrier",
  "coverage",
  "document",
  "draft",
  "email",
  "endorsement",
  "mail",
  "notice",
  "pdf",
  "policy",
  "policies",
]);

const TASK_CONTEXT_TOKENS = new Set([
  "coi",
  "certificate",
  "request",
  "task",
]);

const HIGH_CONFIDENCE_SCORE = 0.82;
const MODEL_FALLBACK_SCORE = 0.42;
const MIN_HIGH_CONFIDENCE_MARGIN = 0.08;

function normalizeTaskControlText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeTaskControlText(text: string): string[] {
  const normalized = normalizeTaskControlText(text);
  if (!normalized) return [];
  return normalized
    .split(" ")
    .filter((token) => token && !STOP_TOKENS.has(token));
}

function uniqueTokens(tokens: string[]): string[] {
  return [...new Set(tokens)];
}

function compactTaskControlText(tokens: string[]): string {
  return tokens.join(" ");
}

function boundedEditDistance(a: string, b: string, maxDistance: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  if (a.length === 0 || b.length === 0) return Math.max(a.length, b.length);

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[b.length];
}

function tokenSimilarity(queryToken: string, exampleToken: string): number {
  if (queryToken === exampleToken) return 1;
  if (queryToken.length < 4 || exampleToken.length < 4) return 0;
  const distance = boundedEditDistance(queryToken, exampleToken, 2);
  if (distance === 1) return 0.84;
  if (distance === 2 && Math.min(queryToken.length, exampleToken.length) >= 6) {
    return 0.68;
  }
  return 0;
}

function domainConflict(tokens: string[]): boolean {
  const tokenSet = new Set(tokens);
  const hasDomainConflict = tokens.some((token) =>
    DOMAIN_CONFLICT_TOKENS.has(token),
  );
  if (!hasDomainConflict) return false;
  return !tokens.some((token) => TASK_CONTEXT_TOKENS.has(token)) ||
    tokenSet.has("policy") ||
    tokenSet.has("policies") ||
    tokenSet.has("email") ||
    tokenSet.has("draft") ||
    tokenSet.has("document") ||
    tokenSet.has("notice") ||
    tokenSet.has("attachment") ||
    tokenSet.has("attachments");
}

function scoreCandidate(
  queryTokens: string[],
  example: string,
  intent: TaskControlIntent,
): TaskControlCandidate {
  const exampleTokens = uniqueTokens(tokenizeTaskControlText(example));
  const uniqueQueryTokens = uniqueTokens(queryTokens);
  const matchedTokens: string[] = [];
  const fuzzyMatches: Array<{ queryToken: string; exampleToken: string }> = [];
  let weightedMatchScore = 0;
  let possibleScore = 0;

  for (const exampleToken of exampleTokens) {
    const weight = WEAK_REFERENCE_TOKENS.has(exampleToken) ? 0.35 : 1;
    possibleScore += weight;
    let bestMatch = 0;
    let bestQueryToken = "";
    for (const queryToken of uniqueQueryTokens) {
      const similarity = tokenSimilarity(queryToken, exampleToken);
      if (similarity > bestMatch) {
        bestMatch = similarity;
        bestQueryToken = queryToken;
      }
    }
    if (bestMatch > 0) {
      weightedMatchScore += weight * bestMatch;
      matchedTokens.push(exampleToken);
      if (bestMatch < 1) {
        fuzzyMatches.push({ queryToken: bestQueryToken, exampleToken });
      }
    }
  }

  const queryCompact = compactTaskControlText(uniqueQueryTokens);
  const exampleCompact = compactTaskControlText(exampleTokens);
  const exactPhraseBoost = queryCompact === exampleCompact ? 0.32 : 0;
  const containmentBoost =
    queryCompact.includes(exampleCompact) || exampleCompact.includes(queryCompact)
      ? 0.18
      : 0;
  const coverage = possibleScore > 0 ? weightedMatchScore / possibleScore : 0;
  const brevityPenalty = uniqueQueryTokens.length > exampleTokens.length + 4 ? 0.2 : 0;
  const fuzzyPenalty = fuzzyMatches.length > 0 ? 0.06 : 0;
  const score = Math.max(
    0,
    Math.min(1, coverage + exactPhraseBoost + containmentBoost - brevityPenalty - fuzzyPenalty),
  );

  return {
    intent,
    example,
    score,
    matchedTokens,
    fuzzyMatches,
  };
}

export function rankTaskControlCandidates(text: string): TaskControlRanking {
  const normalizedText = normalizeTaskControlText(text);
  const tokens = tokenizeTaskControlText(text);
  if (!normalizedText || tokens.length === 0 || normalizedText.length > 180) {
    return {
      normalizedText,
      tokens,
      candidates: [],
      margin: 0,
      domainConflict: false,
      highConfidence: false,
      shouldUseModel: false,
    };
  }

  const candidates = TASK_CONTROL_EXAMPLES.flatMap((entry) =>
    entry.examples.map((example) =>
      scoreCandidate(tokens, example, entry.intent),
    ),
  )
    .filter((candidate) => candidate.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const topCandidate = candidates[0];
  const runnerUpDifferentIntent = topCandidate
    ? candidates.find((candidate) => candidate.intent !== topCandidate.intent)
    : undefined;
  const margin = topCandidate
    ? topCandidate.score - (runnerUpDifferentIntent?.score ?? 0)
    : 0;
  const conflict = domainConflict(tokens);
  const highConfidence = Boolean(
    topCandidate &&
      !conflict &&
      topCandidate.score >= HIGH_CONFIDENCE_SCORE &&
      margin >= MIN_HIGH_CONFIDENCE_MARGIN,
  );

  return {
    normalizedText,
    tokens,
    candidates,
    topCandidate,
    margin,
    domainConflict: conflict,
    highConfidence,
    shouldUseModel: Boolean(
      topCandidate &&
        !conflict &&
        !highConfidence &&
        topCandidate.score >= MODEL_FALLBACK_SCORE,
    ),
  };
}

export function taskControlResponse(intent: TaskControlResponseIntent): string {
  if (intent === "ask_confirmation") {
    return "Do you want me to clear the current task, or keep working on it?";
  }
  return intent === "reset_task"
    ? "Done - I cleared that task. What would you like to do next?"
    : "Done - I cleared that task.";
}
