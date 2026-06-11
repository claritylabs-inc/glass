/**
 * Hallucination-confidence markers.
 *
 * The chat agent wraps claims it is not confident are supported by its sources
 * in `[?...?]` markers. In the web chat those spans are rendered as subtly
 * highlighted text the user is nudged to verify; everywhere else (plain text,
 * copied text, email, iMessage) the markers are stripped back to the bare text.
 *
 * Keep this module dependency-light and runtime-agnostic so it can be imported
 * from both the Next.js client and (a mirrored copy of the regex in) Convex.
 */

/** Matches a single `[?uncertain claim?]` span; capture group 1 is the inner text. */
export const UNCERTAINTY_MARKER_RE = /\[\?([\s\S]+?)\?\]/g;

/** Replace every `[?...?]` marker with just its inner text. */
export function stripUncertaintyMarkers(text: string): string {
  return text.replace(UNCERTAINTY_MARKER_RE, "$1");
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
  const re = new RegExp(UNCERTAINTY_MARKER_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: value.slice(lastIndex, match.index) });
    }
    parts.push({
      type: "uncertain",
      data: {
        hName: "mark",
        hProperties: { className: "glass-uncertain", "data-uncertain": "true" },
      },
      children: [{ type: "text", value: match[1] }],
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
      node.value.includes("[?")
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
 * remark plugin: rewrites `[?...?]` markers found in text nodes into `<mark>`
 * elements (via mdast `data.hName`) so react-markdown can render them as
 * highlighted, hoverable spans. Markers that span multiple inline nodes (e.g.
 * with nested emphasis) are left untouched — the agent is instructed to wrap
 * only plain words or phrases.
 */
export function remarkUncertainty() {
  return (tree: MdastNode) => {
    if (Array.isArray(tree.children)) {
      tree.children = transformChildren(tree.children);
    }
  };
}
