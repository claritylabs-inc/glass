import type { Doc, Id } from "@/convex/_generated/dataModel";

export type ThreadMessage = Doc<"threadMessages">;

export type ThreadAttachment = NonNullable<
  ThreadMessage["attachments"]
>[number];

export type ToolArtifactData = { type: string; data: unknown };

export type VendorComplianceArtifactData = ToolArtifactData;

export type VendorComplianceArtifactRef = {
  messageId: Id<"threadMessages">;
  index: number;
};

export type MailboxArtifactRef = {
  messageId: Id<"threadMessages">;
  index: number;
  emailIndex?: number;
};
