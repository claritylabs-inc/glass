import { Marked, type MarkedToken, type Token, type Tokens } from "marked";

const markdownLexer = new Marked();
const BLOCK_SEPARATOR = "\n\n";
const LIST_INDENT = "  ";
const TABLE_CELL_SEPARATOR = " | ";
const INTERNAL_TOOL_ACTIVITY_PATTERN =
  /(?:\r?\n){2}\[tool activity:[^\r\n]*\][ \t]*(?:\r?\n)*$/i;

function stripInternalAgentActivity(value: string) {
  if (!INTERNAL_TOOL_ACTIVITY_PATTERN.test(value)) return value;
  return value.replace(INTERNAL_TOOL_ACTIVITY_PATTERN, "").trimEnd();
}

function confidenceOpenerAt(value: string, index: number) {
  if (value[index] !== "[" || value[index + 1] !== "[") return 0;
  const code = value[index + 2];
  return (code === "g" || code === "i" || code === "u") &&
    value[index + 3] === ":"
    ? 4
    : 0;
}

function findConfidenceClose(value: string, contentStart: number) {
  let markerDepth = 1;
  let markdownBracketDepth = 0;
  let codeDelimiterLength = 0;

  for (let index = contentStart; index < value.length; ) {
    if (value[index] === "`") {
      let runLength = 1;
      while (value[index + runLength] === "`") runLength += 1;
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
    if (value[index] === "\\" && index + 1 < value.length) {
      index += 2;
      continue;
    }
    const nestedOpenerLength = confidenceOpenerAt(value, index);
    if (nestedOpenerLength > 0) {
      markerDepth += 1;
      index += nestedOpenerLength;
      continue;
    }
    if (value[index] === "[") {
      markdownBracketDepth += 1;
      index += 1;
      continue;
    }
    if (value[index] !== "]") {
      index += 1;
      continue;
    }
    if (markdownBracketDepth > 0) {
      markdownBracketDepth -= 1;
      index += 1;
      continue;
    }
    if (value[index + 1] === "]") {
      markerDepth -= 1;
      if (markerDepth === 0) return index;
      index += 2;
      continue;
    }
    index += 1;
  }
  return -1;
}

function stripConfidenceMarkers(value: string): string {
  const normalized = value.replace(/\[\[(g|i|u)\]:/g, "[[$1:");
  let result = "";
  let cursor = 0;
  while (cursor < normalized.length) {
    let openerIndex = cursor;
    let openerLength = 0;
    while (openerIndex < normalized.length && openerLength === 0) {
      openerLength = confidenceOpenerAt(normalized, openerIndex);
      if (openerLength === 0) openerIndex += 1;
    }
    if (openerLength === 0) return result + normalized.slice(cursor);
    result += normalized.slice(cursor, openerIndex);
    const contentStart = openerIndex + openerLength;
    const closeIndex = findConfidenceClose(normalized, contentStart);
    if (closeIndex < 0) {
      result += normalized.slice(openerIndex, contentStart);
      cursor = contentStart;
      continue;
    }
    result += stripConfidenceMarkers(
      normalized.slice(contentStart, closeIndex),
    );
    cursor = closeIndex + 2;
  }
  return result;
}

function normalizeGlassMarkdown(value: string) {
  return stripConfidenceMarkers(stripInternalAgentActivity(value));
}

export function imessageMarkdownSource(value: string) {
  return normalizeGlassMarkdown(value);
}

function renderInlineTokens(tokens: Token[]): string {
  return tokens.map(renderInlineToken).join("");
}

function renderLink(token: Tokens.Link) {
  const label = renderInlineTokens(token.tokens);
  return label === token.href ? token.href : `${label} (${token.href})`;
}

function renderImage(token: Tokens.Image) {
  return token.text ? `${token.text} (${token.href})` : token.href;
}

function renderHtml(value: string) {
  return value.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
}

function renderInlineToken(token: Token): string {
  const markedToken = token as MarkedToken;
  switch (markedToken.type) {
    case "strong":
    case "em":
    case "del":
      return renderInlineTokens(markedToken.tokens);
    case "codespan":
      return markedToken.text;
    case "br":
      return "\n";
    case "link":
      return renderLink(markedToken);
    case "image":
      return renderImage(markedToken);
    case "escape":
      return markedToken.text;
    case "text":
      return markedToken.tokens
        ? renderInlineTokens(markedToken.tokens)
        : markedToken.text;
    case "html":
      return renderHtml(markedToken.text);
    case "checkbox":
      return "";
    default:
      if ("tokens" in markedToken && markedToken.tokens) {
        return renderInlineTokens(markedToken.tokens);
      }
      if ("text" in markedToken && typeof markedToken.text === "string") {
        return markedToken.text;
      }
      return "";
  }
}

function renderList(list: Tokens.List) {
  const lines: string[] = [];
  for (const [index, item] of list.items.entries()) {
    const marker = list.ordered
      ? `${(list.start === "" ? 1 : list.start) + index}. `
      : "• ";
    const checkbox = item.task ? (item.checked ? "[x] " : "[ ] ") : "";
    const rendered = renderBlockTokens(item.tokens);
    const [first = "", ...rest] = rendered.split("\n");
    lines.push(`${marker}${checkbox}${first}`);
    lines.push(...rest.map((line) => `${LIST_INDENT}${line}`));
  }
  return lines.join("\n");
}

function renderTable(table: Tokens.Table) {
  const renderRow = (cells: Tokens.TableCell[]) =>
    cells
      .map((cell) => renderInlineTokens(cell.tokens))
      .join(TABLE_CELL_SEPARATOR);
  return [renderRow(table.header), ...table.rows.map(renderRow)].join("\n");
}

function renderBlockquote(quote: Tokens.Blockquote) {
  return renderBlockTokens(quote.tokens);
}

function renderBlockToken(token: Token): string {
  const markedToken = token as MarkedToken;
  switch (markedToken.type) {
    case "heading":
    case "paragraph":
      return renderInlineTokens(markedToken.tokens);
    case "code":
      return markedToken.text;
    case "blockquote":
      return renderBlockquote(markedToken);
    case "list":
      return renderList(markedToken);
    case "table":
      return renderTable(markedToken);
    case "hr":
      return "———";
    case "space":
    case "def":
      return "";
    default:
      return renderInlineToken(token);
  }
}

function renderBlockTokens(tokens: Token[]) {
  return tokens.map(renderBlockToken).filter(Boolean).join(BLOCK_SEPARATOR);
}

export function imessagePlainText(value: string) {
  return renderBlockTokens(
    markdownLexer.lexer(normalizeGlassMarkdown(value)),
  ).trim();
}
