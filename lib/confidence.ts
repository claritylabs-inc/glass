/**
 * Hallucination-confidence highlighting.
 *
 * The chat agent tints each substantive phrase in its answer by how well that
 * phrase is backed by a source, using inline markers:
 *
 *   [[g:phrase]]  grounded   — directly supported by retrieved sources/context
 *   [[i:phrase]]  inferred   — a reasonable deduction from available information
 *   [[u:phrase]]  unverified — general knowledge / assumption, not source-backed
 *
 * In the web chat those spans render as tinted, hoverable text with a legend
 * and an overall confidence score. Everywhere else (plain text, copied text,
 * email, iMessage) the markers are stripped back to the bare phrase.
 *
 * Keep this module dependency-light and runtime-agnostic so it can be imported
 * from the Next.js client; Convex keeps a mirrored copy of the regex.
 */

export type ConfidenceLevel = "grounded" | "inferred" | "unverified";

/** Single-letter marker codes the agent emits, mapped to their level. */
export const CONFIDENCE_LEVEL_BY_CODE: Record<string, ConfidenceLevel> = {
  g: "grounded",
  i: "inferred",
  u: "unverified",
};

/** Weight each level contributes to the aggregate confidence score (0–1). */
const LEVEL_WEIGHT: Record<ConfidenceLevel, number> = {
  grounded: 1,
  inferred: 0.5,
  unverified: 0,
};

/** Human-readable copy for the legend and per-phrase tooltips. */
export const CONFIDENCE_LEVEL_META: Record<
  ConfidenceLevel,
  { label: string; description: string }
> = {
  grounded: {
    label: "Grounded",
    description: "Directly supported by a retrieved source or provided context.",
  },
  inferred: {
    label: "Inferred",
    description: "A reasonable inference from the available information.",
  },
  unverified: {
    label: "Unverified",
    description: "Not backed by any provided source — verify before relying on it.",
  },
};

/** Matches `[[g:...]]` / `[[i:...]]` / `[[u:...]]`; group 1 = code, group 2 = phrase. */
export const CONFIDENCE_MARKER_RE = /\[\[(g|i|u):([\s\S]+?)\]\]/g;
const CONFIDENCE_MARKER_PRESENT_RE = /\[\[(?:g|i|u):[\s\S]+?\]\]/;

export function hasConfidenceMarkers(text: string): boolean {
  return CONFIDENCE_MARKER_PRESENT_RE.test(text);
}

/** Replace every confidence marker with just its inner phrase. */
export function stripConfidenceMarkers(text: string): string {
  return text.replace(CONFIDENCE_MARKER_RE, "$2");
}

/**
 * Summarize the confidence annotations in a message: an overall score (0–1,
 * length-weighted) and per-level phrase counts. Returns null when the message
 * has no confidence markers.
 */
export function summarizeConfidence(text: string): {
  score: number;
  counts: Record<ConfidenceLevel, number>;
} | null {
  const counts: Record<ConfidenceLevel, number> = {
    grounded: 0,
    inferred: 0,
    unverified: 0,
  };
  let weightedChars = 0;
  let totalChars = 0;
  const re = new RegExp(CONFIDENCE_MARKER_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const level = CONFIDENCE_LEVEL_BY_CODE[match[1]];
    if (!level) continue;
    const length = match[2].length;
    counts[level] += 1;
    totalChars += length;
    weightedChars += length * LEVEL_WEIGHT[level];
  }
  if (totalChars === 0) return null;
  return { score: weightedChars / totalChars, counts };
}

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
};

function splitTextNode(value: string): MdastNode[] {
  const parts: MdastNode[] = [];
  let lastIndex = 0;
  // Fresh regex per call so the shared global instance's lastIndex is never reused.
  const re = new RegExp(CONFIDENCE_MARKER_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const level = CONFIDENCE_LEVEL_BY_CODE[match[1]];
    if (!level) continue;
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: value.slice(lastIndex, match.index) });
    }
    parts.push({
      type: "confidence",
      data: {
        hName: "mark",
        hProperties: { className: "glass-confidence", "data-level": level },
      },
      children: [{ type: "text", value: match[2] }],
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) {
    parts.push({ type: "text", value: value.slice(lastIndex) });
  }
  return parts;
}

function transformChildren(children: MdastNode[]): MdastNode[] {
  const out: MdastNode[] = [];
  for (const node of children) {
    if (
      node.type === "text" &&
      typeof node.value === "string" &&
      node.value.includes("[[")
    ) {
      out.push(...splitTextNode(node.value));
      continue;
    }
    if (Array.isArray(node.children)) {
      node.children = transformChildren(node.children);
    }
    out.push(node);
  }
  return out;
}

/**
 * remark plugin: rewrites `[[g|i|u:...]]` markers found in text nodes into
 * `<mark data-level>` elements (via mdast `data.hName`) so react-markdown can
 * render them as tinted, hoverable spans. Markers that span multiple inline
 * nodes (e.g. with nested emphasis) are left untouched — the agent is
 * instructed to wrap only plain phrases.
 */
export function remarkConfidence() {
  return (tree: MdastNode) => {
    if (Array.isArray(tree.children)) {
      tree.children = transformChildren(tree.children);
    }
  };
}
