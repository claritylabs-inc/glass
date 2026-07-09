export function normalizeReasoningBoundarySpacing(text: string): string {
  return text
    .replace(/([a-z0-9)"')\]][.!?])(?=[A-Z])/g, "$1 ")
    .replace(/([a-z0-9)"')\]][.!?])(?=["'([]?[A-Z])/g, "$1 ");
}

function splitReasoningLine(line: string): string[] {
  const trimmed = normalizeReasoningBoundarySpacing(line).trim();
  if (!trimmed) return [];
  if (/^(?:[-*]|\d+[.)])\s+/.test(trimmed)) return [trimmed];

  return trimmed
    .split(/(?<=[.!?])\s+(?=(?:["'([])?[A-Z])/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function getReasoningDisclosureLines(reasoning: string): string[] {
  return reasoning.split(/\n+/).flatMap(splitReasoningLine);
}
