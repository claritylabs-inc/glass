"use node";

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getImessageWorkerUrl } from "./imessageConfig";

export type ImessageOutboundAttachment = {
  url: string;
  filename: string;
  mimeType: string;
};

export type StoredThreadAttachment = {
  filename: string;
  contentType: string;
  size: number;
  fileId?: Id<"_storage">;
};

export type ImessageOutboundRoute = {
  toPhone?: string;
  chatGuid?: string;
};

export type ImessageThreadRouteSource = {
  originChannel?: "chat" | "email" | "imessage";
  threadPhone?: string;
  imessageChatGuid?: string;
  imessageIsGroup?: boolean;
};

const MAX_MIRRORED_TEXT_LENGTH = 1800;

export function getImessageOutboundRoute(
  thread: ImessageThreadRouteSource | null | undefined,
): ImessageOutboundRoute | null {
  if (!thread || thread.originChannel !== "imessage") return null;
  if (thread.imessageChatGuid) {
    return {
      chatGuid: thread.imessageChatGuid,
      toPhone: thread.imessageIsGroup ? undefined : thread.threadPhone,
    };
  }
  if (thread.threadPhone) return { toPhone: thread.threadPhone };
  return null;
}

export function truncateImessageText(text: string): string {
  const normalized = text.trim();
  if (normalized.length <= MAX_MIRRORED_TEXT_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_MIRRORED_TEXT_LENGTH - 1).trimEnd()}...`;
}

export function formatWebChatUserMirrorText(args: {
  userName?: string;
  content: string;
  hasAttachments: boolean;
}): string {
  const sender = args.userName?.trim() || "A user";
  const body = truncateImessageText(args.content);
  if (body) return `${sender} from Glass web chat: ${body}`;
  return args.hasAttachments
    ? `${sender} shared attachment(s) from Glass web chat.`
    : `${sender} sent a message from Glass web chat.`;
}

export function formatWebChatAgentMirrorText(args: {
  content: string;
  hasAttachments: boolean;
}): string {
  const body = truncateImessageText(args.content);
  if (body) return `Glass replied in web chat: ${body}`;
  return args.hasAttachments
    ? "Glass added attachment(s) in web chat."
    : "Glass replied in web chat.";
}

export async function storedAttachmentsToImessageOutbound(
  ctx: ActionCtx,
  attachments: StoredThreadAttachment[] | undefined,
): Promise<ImessageOutboundAttachment[]> {
  const outbound: ImessageOutboundAttachment[] = [];
  for (const attachment of attachments ?? []) {
    if (!attachment.fileId) continue;
    try {
      const url = await ctx.storage.getUrl(attachment.fileId);
      if (!url) continue;
      outbound.push({
        url,
        filename: attachment.filename,
        mimeType: attachment.contentType || "application/octet-stream",
      });
    } catch (error) {
      console.warn(
        `[imessageOutbound] Failed to resolve attachment ${attachment.filename}:`,
        error,
      );
    }
  }
  return outbound;
}

export async function sendOutboundImessage(params: {
  toPhone?: string;
  chatGuid?: string;
  message: string;
  attachments?: ImessageOutboundAttachment[];
  clientMessageId?: string;
  logPrefix?: string;
}): Promise<boolean> {
  const workerUrl = getImessageWorkerUrl();
  if (!workerUrl) return false;
  if (!params.toPhone && !params.chatGuid) return false;

  const attachments =
    params.attachments?.filter((attachment) => attachment.url) ?? [];
  const message =
    params.message.trim() ||
    (attachments.length > 0 ? "Glass shared attachment(s)." : "");
  if (!message) return false;

  try {
    const res = await fetch(`${workerUrl}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.IMESSAGE_WORKER_SECRET ?? ""}`,
      },
      body: JSON.stringify({
        toPhone: params.toPhone,
        chatGuid: params.chatGuid,
        message,
        clientMessageId: params.clientMessageId,
        attachments: attachments.length > 0 ? attachments : undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const prefix = params.logPrefix ?? "imessageOutbound";
      console.warn(
        `[${prefix}] iMessage send failed ${res.status}: ${body}`,
      );
      return false;
    }
    return true;
  } catch (error) {
    const prefix = params.logPrefix ?? "imessageOutbound";
    console.warn(
      `[${prefix}] iMessage send failed:`,
      error,
    );
    return false;
  }
}
