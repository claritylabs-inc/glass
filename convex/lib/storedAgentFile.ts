"use node";

import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  buildAgentAttachmentParts,
  MAX_AGENT_ATTACHMENT_TEXT_CHARS,
} from "./agentAttachmentContext";

export async function readStoredAgentFile(
  ctx: Pick<ActionCtx, "storage">,
  file: {
    fileId: Id<"_storage">;
    filename: string;
    contentType: string;
    size: number;
  },
) {
  const parsed = await buildAgentAttachmentParts(ctx, [file], {
    includeRichParts: true,
    remainingTextChars: { value: MAX_AGENT_ATTACHMENT_TEXT_CHARS },
  });
  const text = parsed.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n")
    .trim();
  const hasRichContent = parsed.parts.some(
    (part) => part.type === "image" || part.type === "file",
  );
  if (!text && !hasRichContent) {
    return {
      status: "unavailable" as const,
      filename: file.filename,
      message: "No readable content could be recovered from that file.",
    };
  }
  return {
    status: hasRichContent && !text ? ("binary" as const) : ("ok" as const),
    filename: file.filename,
    contentType: file.contentType,
    text: text || undefined,
    message: hasRichContent
      ? "This file includes visual or binary content. Attach it to a response when the user needs the original."
      : undefined,
  };
}
