import { ensureM4a } from "@spectrum-ts/core/authoring";
import {
  readInboundAttachmentWith,
  type InboundAttachmentContent,
  type NormalizedInboundAttachment,
} from "./attachmentPolicy.js";

export type { InboundAttachmentContent, NormalizedInboundAttachment };
export {
  isVoiceMemoContent,
  normalizeAttachmentMimeType,
  voiceMemoFilename,
} from "./attachmentPolicy.js";

export function readInboundAttachment(
  content: InboundAttachmentContent,
): Promise<NormalizedInboundAttachment> {
  return readInboundAttachmentWith(ensureM4a, content);
}
