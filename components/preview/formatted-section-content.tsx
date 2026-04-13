"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders extracted section content as markdown.
 *
 * cl-sdk v0.11+ outputs native markdown with GFM tables,
 * so we render directly with react-markdown instead of custom parsing.
 */
/**
 * Strip empty header rows from GFM tables.
 * cl-sdk extraction sometimes produces tables with an empty first row
 * (e.g. "|  |  |\n|---|---|\n| Header | ...") which renders as a blank
 * row above the real headers.
 */
function stripEmptyTableRows(md: string): string {
  // Match a GFM table line where all cells are empty/whitespace
  // followed by the separator row, and remove the empty line
  return md.replace(
    /^(\|[\s|]*\|)\s*\n(\|[-:\s|]+\|)/gm,
    (match, headerRow, separator) => {
      // Check if all cells in the header row are empty
      const cells = headerRow.split("|").filter(Boolean);
      if (cells.every((c: string) => c.trim() === "")) {
        return separator;
      }
      return match;
    },
  );
}

export function FormattedSectionContent({ content }: { content: string }) {
  return (
    <div className="text-body-sm text-foreground/80 leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="overflow-x-auto rounded border border-foreground/6">
              <table className="w-full text-body-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="px-2.5 py-1.5 text-left text-label-sm font-medium text-muted-foreground/60 bg-foreground/[0.03] border-b border-foreground/8 whitespace-nowrap">{children}</th>
          ),
          td: ({ children }) => (
            <td className="px-2.5 py-1.5 border-b border-foreground/4 whitespace-nowrap">{children}</td>
          ),
        }}
      >{stripEmptyTableRows(content)}</Markdown>
    </div>
  );
}
