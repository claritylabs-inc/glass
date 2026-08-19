const MARKDOWN_LINK = /\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g;
const EMOJI_SEQUENCE = /(?:[#*0-9]\uFE0F?\u20E3|\p{Regional_Indicator}{2}|(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F|\p{Emoji_Modifier})?)*)/gu;
const SLACK_EMOJI_SHORTCODE = /(?<![\w]):[a-z0-9_+-]+:/gi;
const PROGRESS_PREAMBLE = /^(?:(?:I(?:['’]ll| will|['’]m)|Let me)\s+(?:check|review|look(?:\s+(?:at|into|up))?|analy[sz]e|compare|find|verify)\b[^\n]*(?:\n{2,}|$))/i;

function cleanSlackAgentText(value: string): string {
  return value
    .replace(/\[\[(g|i|u)\]:/g, "[[$1:")
    .replace(/\[\[(?:g|i|u):([\s\S]+?)\]\]/g, "$1")
    .replace(EMOJI_SEQUENCE, "")
    .replace(SLACK_EMOJI_SHORTCODE, "")
    .replace(/^[ \t]+/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(PROGRESS_PREAMBLE, "");
}

export function toSlackMrkdwn(value: string): string {
  return cleanSlackAgentText(value)
    .replace(MARKDOWN_LINK, "<$2|$1>")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "_$1_")
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/__([^_\n]+)__/g, "*$1*")
    .replace(/~~([^~\n]+)~~/g, "~$1~");
}

export function toSlackMarkdown(value: string): string {
  return cleanSlackAgentText(value);
}
