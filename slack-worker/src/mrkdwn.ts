const MARKDOWN_LINK = /\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g;

export function toSlackMrkdwn(value: string): string {
  return value
    .replace(/\[\[(g|i|u)\]:/g, "[[$1:")
    .replace(/\[\[(?:g|i|u):([\s\S]+?)\]\]/g, "$1")
    .replace(MARKDOWN_LINK, "<$2|$1>")
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/__([^_\n]+)__/g, "*$1*")
    .replace(/~~([^~\n]+)~~/g, "~$1~");
}
