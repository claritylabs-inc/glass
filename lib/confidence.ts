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
const CONFIDENCE_MARKER_OPEN_RE = /\[\[(g|i|u):/;
const CONFIDENCE_OPEN_PLACEHOLDER = "\uE000";
const CONFIDENCE_CLOSE_PLACEHOLDER = "\uE001";

/** Repair the common malformed opener `[[g]:` before parsing or stripping. */
export function normalizeConfidenceMarkers(text: string): string {
  return text.replace(/\[\[(g|i|u)\]:/g, "[[$1:");
}

export function hasConfidenceMarkers(text: string): boolean {
  return CONFIDENCE_MARKER_PRESENT_RE.test(normalizeConfidenceMarkers(text));
}

/** Replace every confidence marker with just its inner phrase. */
export function stripConfidenceMarkers(text: string): string {
  return normalizeConfidenceMarkers(text).replace(CONFIDENCE_MARKER_RE, "$2");
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
  const normalized = normalizeConfidenceMarkers(text);
  const counts: Record<ConfidenceLevel, number> = {
    grounded: 0,
    inferred: 0,
    unverified: 0,
  };
  let weightedChars = 0;
  let totalChars = 0;
  const re = new RegExp(CONFIDENCE_MARKER_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(normalized)) !== null) {
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

export function protectConfidenceMarkersForStreaming(text: string): string {
  return normalizeConfidenceMarkers(text).replace(
    CONFIDENCE_MARKER_RE,
    (_, code: string, content: string) =>
      `${CONFIDENCE_OPEN_PLACEHOLDER}${code}:${content}${CONFIDENCE_CLOSE_PLACEHOLDER}`,
  );
}

export function remarkRestoreStreamingConfidenceMarkers() {
  return (tree: MdastNode) => {
    const visit = (node: MdastNode) => {
      if (node.value) {
        node.value = node.value
          .replaceAll(CONFIDENCE_OPEN_PLACEHOLDER, "[[")
          .replaceAll(CONFIDENCE_CLOSE_PLACEHOLDER, "]]");
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

function textNode(value: string): MdastNode {
  return { type: "text", value };
}

function confidenceNode(
  code: string,
  children: MdastNode[],
): MdastNode | null {
  const level = CONFIDENCE_LEVEL_BY_CODE[code];
  if (!level || children.length === 0) return null;
  return {
    type: "confidence",
    data: {
      hName: "mark",
      hProperties: { className: "glass-confidence", "data-level": level },
    },
    children,
  };
}

function transformChildren(children: MdastNode[]): MdastNode[] {
  const prepared = children.map((node) => {
    if (Array.isArray(node.children)) {
      node.children = transformChildren(node.children);
    }
    if (node.type === "text" && typeof node.value === "string") {
      node.value = normalizeConfidenceMarkers(node.value);
    }
    return node;
  });
  const out: MdastNode[] = [];
  let index = 0;

  while (index < prepared.length) {
    const node = prepared[index];
    if (node.type !== "text" || typeof node.value !== "string") {
      out.push(node);
      index += 1;
      continue;
    }

    const opener = CONFIDENCE_MARKER_OPEN_RE.exec(node.value);
    if (!opener) {
      out.push(node);
      index += 1;
      continue;
    }

    const openerEnd = opener.index + opener[0].length;
    let closingIndex = index;
    let closingOffset = node.value.indexOf("]]", openerEnd);
    while (closingOffset < 0 && closingIndex + 1 < prepared.length) {
      closingIndex += 1;
      const candidate = prepared[closingIndex];
      if (candidate.type === "text" && typeof candidate.value === "string") {
        closingOffset = candidate.value.indexOf("]]");
      }
    }

    if (closingOffset < 0) {
      out.push(node);
      index += 1;
      continue;
    }

    if (opener.index > 0) {
      out.push(textNode(node.value.slice(0, opener.index)));
    }

    const markedChildren: MdastNode[] = [];
    if (closingIndex === index) {
      const value = node.value.slice(openerEnd, closingOffset);
      if (value) markedChildren.push(textNode(value));
    } else {
      const openingRemainder = node.value.slice(openerEnd);
      if (openingRemainder) markedChildren.push(textNode(openingRemainder));
      markedChildren.push(...prepared.slice(index + 1, closingIndex));
      const closingNode = prepared[closingIndex];
      const closingPrefix = closingNode.value!.slice(0, closingOffset);
      if (closingPrefix) markedChildren.push(textNode(closingPrefix));
    }

    const marked = confidenceNode(opener[1], markedChildren);
    if (!marked) {
      out.push(node);
      index += 1;
      continue;
    }
    out.push(marked);

    const closingNode = prepared[closingIndex];
    const suffix = closingNode.value!.slice(closingOffset + 2);
    if (suffix) {
      prepared[closingIndex] = textNode(suffix);
      index = closingIndex;
    } else {
      index = closingIndex + 1;
    }
  }
  return out;
}

/**
 * remark plugin: rewrites `[[g|i|u:...]]` markers found in text nodes into
 * `<mark data-level>` elements (via mdast `data.hName`) so react-markdown can
 * render them as tinted, hoverable spans. A marker can contain adjacent inline
 * Markdown nodes, so `[[g:generated **Company**]]` preserves the nested strong
 * node inside the confidence mark.
 */
export function remarkConfidence() {
  return (tree: MdastNode) => {
    if (Array.isArray(tree.children)) {
      tree.children = transformChildren(tree.children);
    }
  };
}
