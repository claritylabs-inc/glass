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
 * In the web chat those spans render as tinted, hoverable text. Everywhere
 * else (plain text, copied text, email, iMessage) the markers are stripped
 * back to the bare phrase.
 *
 * Keep this module dependency-free and runtime-agnostic. Stored messages may
 * contain legacy markers, so non-web consumers must use the parser below
 * rather than a non-greedy regular expression that can stop inside Markdown.
 */

export type ConfidenceLevel = "grounded" | "inferred" | "unverified";
type ConfidenceMarkerCode = "g" | "i" | "u";

type ConfidenceTextSegment =
  | { type: "text"; value: string }
  | {
      type: "confidence";
      code: ConfidenceMarkerCode;
      level: ConfidenceLevel;
      value: string;
    };

const CONFIDENCE_LEVEL_BY_CODE: Record<string, ConfidenceLevel> = {
  g: "grounded",
  i: "inferred",
  u: "unverified",
};

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

const CONFIDENCE_MARKER_OPEN_RE = /\[\[(g|i|u):/;
const CONFIDENCE_OPEN_PLACEHOLDER = "\uE000";
const CONFIDENCE_CLOSE_PLACEHOLDER = "\uE001";

function normalizeConfidenceMarkers(text: string): string {
  return text.replace(/\[\[(g|i|u)\]:/g, "[[$1:");
}
function confidenceOpenerAt(
  text: string,
  index: number,
): { code: ConfidenceMarkerCode; length: number } | null {
  if (text[index] !== "[" || text[index + 1] !== "[") return null;
  const code = text[index + 2];
  if (
    (code !== "g" && code !== "i" && code !== "u") ||
    text[index + 3] !== ":"
  ) {
    return null;
  }
  return { code, length: 4 };
}

function findConfidenceClose(text: string, contentStart: number): number {
  let markerDepth = 1;
  let markdownBracketDepth = 0;
  let codeDelimiterLength = 0;

  for (let index = contentStart; index < text.length; ) {
    if (text[index] === "`") {
      let runLength = 1;
      while (text[index + runLength] === "`") runLength += 1;
      if (codeDelimiterLength === 0) {
        codeDelimiterLength = runLength;
      } else if (runLength === codeDelimiterLength) {
        codeDelimiterLength = 0;
      }
      index += runLength;
      continue;
    }

    if (codeDelimiterLength > 0) {
      index += 1;
      continue;
    }
    if (text[index] === "\\" && index + 1 < text.length) {
      index += 2;
      continue;
    }

    const nestedOpener = confidenceOpenerAt(text, index);
    if (nestedOpener) {
      markerDepth += 1;
      index += nestedOpener.length;
      continue;
    }
    if (text[index] === "[") {
      markdownBracketDepth += 1;
      index += 1;
      continue;
    }
    if (text[index] !== "]") {
      index += 1;
      continue;
    }
    if (markdownBracketDepth > 0) {
      markdownBracketDepth -= 1;
      index += 1;
      continue;
    }
    if (text[index + 1] === "]") {
      markerDepth -= 1;
      if (markerDepth === 0) return index;
      index += 2;
      continue;
    }
    index += 1;
  }

  return -1;
}

function pushTextSegment(segments: ConfidenceTextSegment[], value: string) {
  if (!value) return;
  const previous = segments.at(-1);
  if (previous?.type === "text") {
    previous.value += value;
  } else {
    segments.push({ type: "text", value });
  }
}

/**
 * Parse stored confidence markup without treating `]]` inside code spans or
 * balanced Markdown brackets as the end of a phrase. Unclosed markers remain
 * literal text so compatibility cleanup never destroys user-visible content.
 */
export function parseConfidenceMarkers(text: string): ConfidenceTextSegment[] {
  const normalized = normalizeConfidenceMarkers(text);
  const segments: ConfidenceTextSegment[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    let openerIndex = cursor;
    let opener: ReturnType<typeof confidenceOpenerAt> = null;
    while (openerIndex < normalized.length && !opener) {
      opener = confidenceOpenerAt(normalized, openerIndex);
      if (!opener) openerIndex += 1;
    }
    if (!opener) {
      pushTextSegment(segments, normalized.slice(cursor));
      break;
    }

    pushTextSegment(segments, normalized.slice(cursor, openerIndex));
    const contentStart = openerIndex + opener.length;
    const closeIndex = findConfidenceClose(normalized, contentStart);
    if (closeIndex < 0) {
      pushTextSegment(segments, normalized.slice(openerIndex, contentStart));
      cursor = contentStart;
      continue;
    }

    const value = stripConfidenceMarkers(
      normalized.slice(contentStart, closeIndex),
    );
    segments.push({
      type: "confidence",
      code: opener.code,
      level: CONFIDENCE_LEVEL_BY_CODE[opener.code],
      value,
    });
    cursor = closeIndex + 2;
  }

  return segments;
}

export function hasConfidenceMarkers(text: string): boolean {
  return parseConfidenceMarkers(text).some(
    (segment) => segment.type === "confidence",
  );
}

export function stripConfidenceMarkers(text: string): string {
  return parseConfidenceMarkers(text)
    .map((segment) => segment.value)
    .join("");
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
  return parseConfidenceMarkers(text)
    .map((segment) =>
      segment.type === "text"
        ? segment.value
        : `${CONFIDENCE_OPEN_PLACEHOLDER}${segment.code}:${segment.value}${CONFIDENCE_CLOSE_PLACEHOLDER}`,
    )
    .join("");
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
