import type { Id } from "@/convex/_generated/dataModel";
import type { AgentStep } from "@/convex/lib/agentSteps";

export type { AgentStep };

export type ThreadMessage = {
  _id: Id<"threadMessages">;
  _creationTime: number;
  threadId: Id<"threads">;
  orgId: Id<"organizations">;
  clientMutationId?: string;
  channel: "chat" | "email" | "imessage" | "slack";
  role: "user" | "agent" | "system";
  messageKind?: "conversation" | "workflow_status" | "channel_sync";
  sourceThreadMessageId?: Id<"threadMessages">;
  dedupeKey?: string;
  userId?: Id<"users">;
  userName?: string;
  operatorInitiated?: {
    operatorUserId: Id<"users">;
    operatorEmail?: string;
    operatorName?: string;
    impersonationSessionId: Id<"operatorImpersonationSessions">;
    targetOrgId: Id<"organizations">;
    targetOrgName: string;
    targetRole: "admin" | "member";
    displayLabel: string;
    initiatedAt: number;
  };
  imessageSenderAddress?: string;
  imessageParticipantLabel?: string;
  slackActorId?: Id<"slackActors">;
  slackTeamId?: string;
  slackUserId?: string;
  slackMessageTs?: string;
  slackEditedAt?: number;
  slackDeletedAt?: number;
  slackDeliveryStatus?: "sending" | "sent" | "failed";
  slackDeliveryError?: string;
  fromEmail?: string;
  fromName?: string;
  toAddresses?: string[];
  ccAddresses?: string[];
  bccAddresses?: string[];
  subject?: string;
  content: string;
  contentHtml?: string;
  emailContent?: {
    rawText?: string;
    rawHtml?: string;
    quotedText?: string;
    parserVersion: string;
    parseInputTruncated?: boolean;
    forwarded?: {
      email: {
        from?: { address?: string; name?: string };
        to: { address?: string; name?: string }[];
        cc: { address?: string; name?: string }[];
        subject?: string;
        date?: string;
        body?: string;
      };
    };
  };
  reasoning?: string;
  agentSteps?: AgentStep[];
  messageId?: string;
  responseMessageId?: string;
  attachments?: {
    filename: string;
    contentType: string;
    size: number;
    fileId?: Id<"_storage">;
    kind?: "coi" | "original_policy" | "uploaded_file" | "generated_document";
  }[];
  replyToMessageId?: Id<"threadMessages">;
  referencedPolicyIds?: Id<"policies">[];
  citedSections?: string[];
  citedCoverageNames?: string[];
  citedSourceSpanIds?: string[];
  referencedRequirementIds?: Id<"insuranceRequirements">[];
  referencedMailboxIds?: Id<"connectedEmailAccounts">[];
  usedTools?: string[];
  toolCalls?: { name: string; input?: string; output?: string }[];
  toolArtifacts?: { type: string; data: unknown }[];
  agentRunStartedAt?: number;
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
