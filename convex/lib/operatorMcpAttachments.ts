import {
  MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES,
  MAX_AGENT_ATTACHMENT_BYTES,
  MAX_AGENT_ATTACHMENT_FILES,
} from "./agentAttachmentLimits";

const MAX_BASE64_INPUT_CHARS =
  Math.ceil(MAX_AGENT_ATTACHMENT_BYTES / 3) * 4 + 4_096;

export type DecodedOperatorMcpAttachment = {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
};

function decodeBase64(value: string, filename: string): Uint8Array {
  if (value.length > MAX_BASE64_INPUT_CHARS) {
    throw new Error(`${filename} exceeds the 25 MB file limit`);
  }
  const compact = value.replace(/\s/g, "");
  if (
    compact.length % 4 === 1 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      compact,
    )
  ) {
    throw new Error(`${filename} has invalid base64 data`);
  }

  let binary: string;
  try {
    binary = atob(compact);
  } catch {
    throw new Error(`${filename} has invalid base64 data`);
  }
  if (binary.length > MAX_AGENT_ATTACHMENT_BYTES) {
    throw new Error(`${filename} exceeds the 25 MB file limit`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function decodeOperatorMcpAttachments(
  input: unknown,
): DecodedOperatorMcpAttachment[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error("attachments must be an array");
  if (input.length > MAX_AGENT_ATTACHMENT_FILES) {
    throw new Error(
      `Operator tasks support at most ${MAX_AGENT_ATTACHMENT_FILES} files`,
    );
  }

  const decoded: DecodedOperatorMcpAttachment[] = [];
  let aggregateSize = 0;
  for (const value of input) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Each attachment must be an object");
    }
    const attachment = value as Record<string, unknown>;
    const rawFilename =
      typeof attachment.filename === "string" ? attachment.filename.trim() : "";
    const filename = rawFilename.replace(/\\/g, "/").split("/").at(-1)?.trim();
    if (!filename || filename.length > 255 || filename.includes("\0")) {
      throw new Error("Attachment filenames must be 1–255 characters");
    }
    const contentType =
      typeof attachment.content_type === "string"
        ? attachment.content_type.trim()
        : "";
    if (contentType.length > 200 || /[\u0000-\u001f\u007f]/.test(contentType)) {
      throw new Error(`${filename} has an invalid content_type`);
    }
    if (typeof attachment.data_base64 !== "string") {
      throw new Error(`${filename} is missing data_base64`);
    }
    const bytes = decodeBase64(attachment.data_base64, filename);
    aggregateSize += bytes.byteLength;
    if (aggregateSize > MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES) {
      throw new Error(
        "Operator task attachments exceed the 50 MB message limit",
      );
    }
    decoded.push({
      filename,
      contentType: contentType || "application/octet-stream",
      bytes,
    });
  }
  return decoded;
}
