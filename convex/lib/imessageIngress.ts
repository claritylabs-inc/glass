"use node";

import { createHash } from "node:crypto";
import dayjs from "dayjs";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { normalizeImessageAddress } from "./imessageGroupResolution";

export type RawImessageParticipant = {
  address: string;
  displayName?: string;
};

export type RawImessageAttachment = {
  data: string;
  mimeType: string;
  name: string;
};

export type StoredImessageAttachmentRecord = {
  filename: string;
  contentType: string;
  size: number;
  fileId?: Id<"_storage">;
  buffer?: Buffer;
};

const SUPPORTED_IMESSAGE_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

export function normalizeInboundImessageSender(raw: string): string {
  if (raw.includes("@")) return raw.trim().toLowerCase();
  const cleaned = raw.replace(/[^+\d]/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

export function buildFallbackImessageChatGuid(args: {
  fromPhone: string;
  isGroup: boolean;
  participants?: RawImessageParticipant[];
}): string {
  if (!args.isGroup) return args.fromPhone;
  const participantAddresses = new Set<string>();
  participantAddresses.add(normalizeImessageAddress(args.fromPhone));
  for (const participant of args.participants ?? []) {
    const address = normalizeImessageAddress(participant.address);
    if (address) participantAddresses.add(address);
  }
  const rosterKey =
    [...participantAddresses].sort().join("|") || args.fromPhone;
  const rosterHash = createHash("sha256")
    .update(rosterKey)
    .digest("hex")
    .slice(0, 24);
  return `group:${rosterHash}`;
}

export function buildInboundImessageEventKey(args: {
  fromPhone: string;
  chatGuid?: string;
  messageText: string;
  sourceMessageId?: string;
  receivedAt?: number;
  attachments?: RawImessageAttachment[];
}): string {
  const hash = createHash("sha256");
  const scope = args.chatGuid ?? args.fromPhone;
  if (args.sourceMessageId) {
    hash.update(`source:${scope}:${args.sourceMessageId}`);
  } else {
    const minuteBucket = Math.floor(
      (args.receivedAt ?? dayjs().valueOf()) / 60000,
    );
    hash.update(
      `fallback:${scope}:${args.fromPhone}:${minuteBucket}:${args.messageText}`,
    );
    for (const attachment of args.attachments ?? []) {
      hash.update(
        `:${attachment.name}:${attachment.mimeType}:${attachment.data.length}`,
      );
    }
  }
  return hash.digest("hex");
}

export function buildImessageParticipantInputs(args: {
  senderAddress: string;
  participants?: RawImessageParticipant[];
}): Map<string, RawImessageParticipant> {
  const participantInputs = new Map<string, RawImessageParticipant>();
  for (const participant of args.participants ?? []) {
    const address = normalizeImessageAddress(participant.address);
    if (address) {
      participantInputs.set(address, {
        address,
        displayName: participant.displayName,
      });
    }
  }
  if (!participantInputs.has(args.senderAddress)) {
    participantInputs.set(args.senderAddress, { address: args.senderAddress });
  }
  return participantInputs;
}

export async function storeImessageAttachments(
  ctx: { storage: Pick<ActionCtx["storage"], "store"> },
  attachments: RawImessageAttachment[] | undefined,
): Promise<StoredImessageAttachmentRecord[]> {
  const attachmentRecords: StoredImessageAttachmentRecord[] = [];
  for (const attachment of attachments ?? []) {
    if (!SUPPORTED_IMESSAGE_ATTACHMENT_MIME_TYPES.has(attachment.mimeType)) {
      continue;
    }
    try {
      const buffer = Buffer.from(attachment.data, "base64");
      const blob = new Blob([new Uint8Array(buffer)], {
        type: attachment.mimeType,
      });
      const fileId = await ctx.storage.store(blob);
      attachmentRecords.push({
        filename: attachment.name,
        contentType: attachment.mimeType,
        size: buffer.byteLength,
        fileId,
        buffer,
      });
    } catch (err) {
      console.warn(
        `[imessage] Failed to store attachment ${attachment.name}:`,
        err,
      );
    }
  }
  return attachmentRecords;
}
