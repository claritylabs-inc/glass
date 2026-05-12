"use client";

import { ProseMarkdown, PROSE_MARKDOWN_COMPACT_STYLES } from "@/components/prose-markdown";

/**
 * Split email body into the new content and the quoted reply.
 * Looks for "On ... wrote:" pattern or consecutive ">" lines.
 */
export function splitQuotedReply(body: string): { content: string; quoted: string | null } {
  const onWroteMatch = body.match(/\r?\n\s*On [\s\S]+?wrote:\s*\r?\n/);
  if (onWroteMatch && onWroteMatch.index !== undefined) {
    const content = body.slice(0, onWroteMatch.index).trimEnd();
    const quoted = body.slice(onWroteMatch.index).trim();
    return { content, quoted };
  }

  const lines = body.split("\n");
  let quoteStart = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*>/.test(lines[i])) {
      quoteStart = i;
    } else if (quoteStart < lines.length) {
      break;
    }
  }

  if (quoteStart < lines.length) {
    const content = lines.slice(0, quoteStart).join("\n").trimEnd();
    const quoted = lines.slice(quoteStart).join("\n").trim();
    return { content, quoted };
  }

  return { content: body, quoted: null };
}

/** Strip the agent signature block from quoted text */
export function stripSignature(text: string): string {
  return text.replace(/\n\s*(?:—|-- )\s*\n[\s\S]*$/, "").trimEnd();
}

export function stripAttribution(text: string): string {
  return text.replace(/^\s*On [\s\S]+?wrote:\s*\n?/, "").trimStart();
}

const QUOTED_MARKDOWN_STYLES = PROSE_MARKDOWN_COMPACT_STYLES + " [&_a]:text-blue-500/60 [&_a]:underline";

export function QuotedContent({ text }: { text: string }) {
  const cleaned = stripAttribution(stripSignature(text));
  const lines = cleaned.split("\n");

  type Block = { depth: number; lines: string[] };
  const blocks: Block[] = [];

  for (const line of lines) {
    const match = line.match(/^(>\s*)+/);
    const depth = match ? (match[0].match(/>/g) || []).length : 0;
    const content = depth > 0 ? line.replace(/^(>\s*)+/, "") : line;

    const last = blocks[blocks.length - 1];
    if (last && last.depth === depth) {
      last.lines.push(content);
    } else {
      blocks.push({ depth, lines: [content] });
    }
  }

  return (
    <div className="text-body-sm text-muted-foreground/50 mt-3 space-y-1">
      {blocks.map((block, i) => {
        const blockText = block.lines.join("\n").trim();
        if (!blockText) return null;

        if (block.depth === 0) {
          return (
            <div key={i} className={`text-muted-foreground/40 ${QUOTED_MARKDOWN_STYLES}`}>
              <ProseMarkdown compact>{blockText}</ProseMarkdown>
            </div>
          );
        }

        let el = (
          <div key={i} className={QUOTED_MARKDOWN_STYLES}>
            <ProseMarkdown compact>{blockText}</ProseMarkdown>
          </div>
        );
        for (let d = 0; d < block.depth; d++) {
          el = (
            <div key={`${i}-${d}`} className="pl-3 ml-0.5 border-l-2 border-foreground/8">
              {el}
            </div>
          );
        }
        return el;
      })}
    </div>
  );
}
