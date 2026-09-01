export const MAX_AGENT_ATTACHMENT_FILES = 10;
export const MAX_AGENT_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES = 50 * 1024 * 1024;
export const MAX_AGENT_ATTACHMENT_TEXT_CHARS = 80_000;

export const MAX_OPERATOR_MCP_INLINE_ATTACHMENT_BYTES = 12 * 1024 * 1024;
export const MAX_OPERATOR_MCP_INLINE_AGGREGATE_BYTES = 14 * 1024 * 1024;
export const MAX_OPERATOR_IMESSAGE_ACTION_BASE64_CHARS = 3_500_000;

export function normalizeAgentAttachmentFilename(value: string): string {
  const filename = value.trim();
  if (
    !filename ||
    filename.length > 255 ||
    /[\u0000-\u001f\u007f]/.test(filename)
  ) {
    throw new Error("Attachment filenames must be 1–255 printable characters");
  }
  return filename;
}

export function normalizeAgentAttachmentContentType(
  value: string | undefined,
  fallback = "application/octet-stream",
): string {
  const contentType = value?.trim() || fallback;
  if (
    !contentType ||
    contentType.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(contentType)
  ) {
    throw new Error(
      "Attachment content types must be printable and at most 200 characters",
    );
  }
  return contentType;
}
