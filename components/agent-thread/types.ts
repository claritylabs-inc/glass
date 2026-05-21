import type { Id } from "@/convex/_generated/dataModel";

export type ThreadMessage = {
  _id: Id<"threadMessages">;
  _creationTime: number;
  threadId: Id<"threads">;
  orgId: Id<"organizations">;
  clientMutationId?: string;
  channel: "chat" | "email" | "imessage";
  role: "user" | "agent" | "system";
  userId?: Id<"users">;
  userName?: string;
  imessageSenderAddress?: string;
  imessageParticipantLabel?: string;
  fromEmail?: string;
  fromName?: string;
  toAddresses?: string[];
  ccAddresses?: string[];
  bccAddresses?: string[];
  subject?: string;
  content: string;
  contentHtml?: string;
  reasoning?: string;
  messageId?: string;
  responseMessageId?: string;
  attachments?: {
    filename: string;
    contentType: string;
    size: number;
    fileId?: Id<"_storage">;
  }[];
  replyToMessageId?: Id<"threadMessages">;
  referencedPolicyIds?: Id<"policies">[];
  citedSections?: string[];
  citedCoverageNames?: string[];
  citedSourceSpanIds?: string[];
  referencedQuoteIds?: Id<"policies">[];
  referencedRequirementIds?: Id<"insuranceRequirements">[];
  referencedMailboxIds?: Id<"connectedEmailAccounts">[];
  usedTools?: string[];
  toolCalls?: { name: string; input?: string; output?: string }[];
  toolArtifacts?: { type: string; data: unknown }[];
  status?:
    | "processing"
    | "error"
    | "pending_send"
    | "draft_email"
    | "cancelled";
  error?: string;
  pendingEmailId?: Id<"pendingEmails">;
  policyChangeCaseId?: Id<"policyChangeCases">;
};

export type PolicyChangeAccess = {
  canManage: boolean;
  actorLabel: "broker" | "client";
};

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
};
