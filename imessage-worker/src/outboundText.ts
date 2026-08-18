import { Marked, type MarkedToken, type Token, type Tokens } from "marked";

const markdownLexer = new Marked();
const BLOCK_SEPARATOR = "\n\n";
const LIST_INDENT = "  ";
const TABLE_CELL_SEPARATOR = " | ";
const INTERNAL_TOOL_ACTIVITY_PATTERN = /\[tool activity:[^\r\n]*\]/gi;

function stripInternalAgentActivity(value: string) {
  return value
    .replace(INTERNAL_TOOL_ACTIVITY_PATTERN, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeGlassMarkdown(value: string) {
  value = stripInternalAgentActivity(value);
  let result = "";
  let openMarkers = 0;
  let markdownBracketDepth = 0;
  let codeDelimiterLength = 0;

  for (let index = 0; index < value.length; ) {
    const opener =
      codeDelimiterLength === 0
        ? value.slice(index).match(/^\[\[(?:g|i|u)(?:\]:|:)/)?.[0]
        : undefined;
    if (opener) {
      openMarkers += 1;
      index += opener.length;
      continue;
    }
    if (openMarkers > 0 && value[index] === "`") {
      let runLength = 1;
      while (value[index + runLength] === "`") runLength += 1;
      if (codeDelimiterLength === 0) {
        codeDelimiterLength = runLength;
      } else if (runLength === codeDelimiterLength) {
        codeDelimiterLength = 0;
      }
      result += value.slice(index, index + runLength);
      index += runLength;
      continue;
    }
    if (openMarkers > 0 && codeDelimiterLength === 0) {
      if (value[index] === "\\" && index + 1 < value.length) {
        result += value.slice(index, index + 2);
        index += 2;
        continue;
      }
      if (value[index] === "[") {
        markdownBracketDepth += 1;
      } else if (value[index] === "]") {
        if (markdownBracketDepth > 0) {
          markdownBracketDepth -= 1;
        } else if (value.startsWith("]]", index)) {
          openMarkers -= 1;
          index += 2;
          continue;
        } else if (index === value.length - 1) {
          openMarkers -= 1;
          index += 1;
          continue;
        }
      }
    }
    result += value[index];
    index += 1;
  }

  return result;
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
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
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
    cells.map((cell) => renderInlineTokens(cell.tokens)).join(TABLE_CELL_SEPARATOR);
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
  return renderBlockTokens(markdownLexer.lexer(normalizeGlassMarkdown(value))).trim();
}
