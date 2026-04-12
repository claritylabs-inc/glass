"use client";

/**
 * Renders extracted section content with intelligent table detection.
 *
 * Extracted policy text often contains pipe-delimited schedule data that needs
 * to be rendered as tables. This component handles:
 * - Lines with 2+ pipes → table rows
 * - Lines with 1 pipe between table blocks → included as table rows
 * - Indented lines following a pipe-row → sub-items within the same table group
 * - All-caps rows → table headers
 * - Everything else → prose paragraphs
 */
export function FormattedSectionContent({ content }: { content: string }) {
  const blocks = parseContentBlocks(content);

  return (
    <div className="space-y-3">
      {blocks.map((block, bi) => {
        if (block.type === "text") {
          return (
            <p key={bi} className="text-body-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
              {block.content}
            </p>
          );
        }
        return <ContentTable key={bi} rows={block.rows} />;
      })}
    </div>
  );
}

type TextBlock = { type: "text"; content: string };
type TableBlock = { type: "table"; rows: string[][] };
type ContentBlock = TextBlock | TableBlock;

/** Parse content into alternating text and table blocks */
function parseContentBlocks(content: string): ContentBlock[] {
  const lines = content.split("\n");
  const blocks: ContentBlock[] = [];
  let textBuffer: string[] = [];

  function flushText() {
    if (textBuffer.some((l) => l.trim().length > 0)) {
      blocks.push({ type: "text", content: textBuffer.join("\n") });
    }
    textBuffer = [];
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const pipeCount = (line.match(/\|/g) || []).length;

    if (pipeCount >= 2) {
      flushText();
      // Collect table rows — include lines with 1+ pipes and indented continuation lines
      const rows: string[][] = [];
      while (i < lines.length) {
        const l = lines[i];
        const pc = (l.match(/\|/g) || []).length;
        if (pc >= 1) {
          // Split on pipes, keep non-empty cells
          const cells = l.split("|").map((c) => c.trim());
          // Filter truly empty cells but preserve structure
          const cleaned = cells.filter((c) => c.length > 0);
          if (cleaned.length > 0) rows.push(cleaned);
          i++;
        } else if (l.match(/^\s{2,}/) && rows.length > 0) {
          // Indented continuation — append to last row's first cell
          const lastRow = rows[rows.length - 1];
          lastRow[0] = `${lastRow[0]}\n${l.trim()}`;
          i++;
        } else {
          break;
        }
      }
      if (rows.length > 0) blocks.push({ type: "table", rows });
    } else {
      textBuffer.push(line);
      i++;
    }
  }
  flushText();
  return blocks;
}

/** Render a table block with optional header detection */
function ContentTable({ rows }: { rows: string[][] }) {
  if (rows.length === 0) return null;

  // Detect header: first row is all-caps and has multiple cells
  const isFirstRowHeader =
    rows.length > 1 &&
    rows[0].length >= 2 &&
    rows[0].every((c) => c === c.toUpperCase() && c.length > 1);

  const headerRow = isFirstRowHeader ? rows[0] : null;
  const dataRows = isFirstRowHeader ? rows.slice(1) : rows;
  const colCount = Math.max(...rows.map((r) => r.length));

  return (
    <div className="overflow-x-auto rounded border border-foreground/6">
      <table className="w-full text-body-sm">
        {headerRow && (
          <thead>
            <tr className="border-b border-foreground/8 bg-foreground/[0.03]">
              {headerRow.map((cell, ci) => (
                <th
                  key={ci}
                  className="px-2.5 py-1.5 text-left text-label-sm font-medium text-muted-foreground/60 whitespace-nowrap"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {dataRows.map((row, ri) => (
            <tr
              key={ri}
              className={ri < dataRows.length - 1 ? "border-b border-foreground/4" : ""}
            >
              {Array.from({ length: colCount }, (_, ci) => (
                <td
                  key={ci}
                  className="px-2.5 py-1.5 text-foreground/80 whitespace-pre-wrap"
                >
                  {row[ci] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
