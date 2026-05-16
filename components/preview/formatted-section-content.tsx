"use client";

import { ProseMarkdown } from "@/components/prose-markdown";

/**
 * Strip empty header rows from GFM tables.
 * cl-sdk extraction sometimes produces tables with an empty first row
 * (e.g. "|  |  |\n|---|---|\n| Header | ...") which renders as a blank
 * row above the real headers.
 */
function stripEmptyTableRows(md: string): string {
  return md.replace(
    /^(\|[\s|]*\|)\s*\n(\|[-:\s|]+\|)/gm,
    (match, headerRow, separator) => {
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
    <ProseMarkdown gfm className="text-foreground/80 text-body-sm leading-normal [&_h1]:text-body-sm! [&_h2]:text-body-sm! [&_h3]:text-body-sm!">
      {stripEmptyTableRows(content)}
    </ProseMarkdown>
  );
}
