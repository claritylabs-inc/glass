const SLACK_CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*(?:`|$)/g;

function decodeSlackEntities(value: string): string {
  return value.replace(/&(amp|lt|gt);/g, (_, entity: string) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    return ">";
  });
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\\[\]])/g, "\\$1");
}

function escapeMarkdownDestination(value: string): string {
  return value
    .replaceAll("\\", "%5C")
    .replaceAll("<", "%3C")
    .replaceAll(">", "%3E");
}

function formatSlackEmphasis(value: string): string {
  return value
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1**$2**")
    .replace(/(^|[^~])~([^~\n]+)~(?!~)/g, "$1~~$2~~");
}

function formatSlackLabel(value: string): string {
  return formatSlackEmphasis(escapeMarkdownLabel(value));
}

function formatSlackAngleToken(body: string): string | null {
  const separatorIndex = body.indexOf("|");
  const target = separatorIndex === -1 ? body : body.slice(0, separatorIndex);
  const label = separatorIndex === -1 ? undefined : body.slice(separatorIndex + 1);

  if (/^(?:https?:\/\/|mailto:|tel:)/i.test(target)) {
    const href = escapeMarkdownDestination(decodeSlackEntities(target));
    return label === undefined
      ? `<${href}>`
      : `[${formatSlackLabel(label)}](<${href}>)`;
  }

  if (target.startsWith("@")) {
    const name = label?.trim() || target.slice(1);
    return name.startsWith("@") ? name : `@${name}`;
  }

  if (target.startsWith("#")) {
    const name = label?.trim() || target.slice(1);
    return name.startsWith("#") ? name : `#${name}`;
  }

  if (target.startsWith("!date^")) {
    return label ? formatSlackLabel(label) : "date";
  }

  if (target.startsWith("!subteam^")) {
    return label ? formatSlackLabel(label) : "@group";
  }

  if (target.startsWith("!")) {
    const name = (label?.trim() || target.slice(1)).replace(/^@/, "");
    return `@${name}`;
  }

  return null;
}

function formatSlackInline(value: string): string {
  const angleTokens: string[] = [];
  const protectedValue = value.replace(/<([^>\n]+)>/g, (token, body: string) => {
    const formatted = formatSlackAngleToken(body);
    if (formatted === null) return token;
    const index = angleTokens.push(formatted) - 1;
    return `\uE000${index}\uE001`;
  });

  return formatSlackEmphasis(protectedValue).replace(
    /\uE000(\d+)\uE001/g,
    (_, index: string) => angleTokens[Number(index)] ?? "",
  );
}

function normalizeSlackLines(value: string): string {
  let inCodeFence = false;
  const lines = value
    .split("\n")
    .map((line) => {
      const fenceCount = line.match(/```/g)?.length ?? 0;
      if (inCodeFence || line.trimStart().startsWith("```")) {
        if (fenceCount % 2 === 1) inCodeFence = !inCodeFence;
        return line;
      }

      return line
        .replace(/^(\s*)&gt;[\t ]?/, "$1> ")
        .replace(/^(\s*>[\t ]*)•[\t ]+/, "$1- ")
        .replace(/^(\s*)•[\t ]+/, "$1- ");
    });

  return lines
    .flatMap((line, index) => {
      const previousWasQuotedBullet = /^\s*>\s*-\s+/.test(lines[index - 1] ?? "");
      const isQuotedProse = /^\s*>\s+\S/.test(line);
      const isQuotedBullet = /^\s*>\s*-\s+/.test(line);
      const indentation = line.match(/^\s*/)?.[0] ?? "";
      return previousWasQuotedBullet && isQuotedProse && !isQuotedBullet
        ? [`${indentation}>`, line]
        : [line];
    })
    .join("\n");
}

/** Convert Slack mrkdwn source into CommonMark for browser transcript rendering. */
export function slackMrkdwnToMarkdown(value: string): string {
  const normalized = normalizeSlackLines(value);
  let result = "";
  let cursor = 0;

  for (const match of normalized.matchAll(SLACK_CODE)) {
    const index = match.index ?? 0;
    result += formatSlackInline(normalized.slice(cursor, index));
    result += decodeSlackEntities(match[0]);
    cursor = index + match[0].length;
  }

  return result + formatSlackInline(normalized.slice(cursor));
}
