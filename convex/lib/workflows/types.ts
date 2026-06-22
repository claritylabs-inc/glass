import type { Id } from "../../_generated/dataModel";

export type WorkflowChannel = "web" | "email" | "imessage" | "mcp" | "cli" | "api";

export type WorkflowKind =
  | "certificate_request"
  | "broker_follow_up"
  | "document_delivery"
  | "application_intake"
  | "mailbox_task";

export type WorkflowStatus =
  | "completed"
  | "needs_input"
  | "held"
  | "pending_approval"
  | "running"
  | "failed_recoverably"
  | "failed_terminal";

export type WorkflowSlot = {
  key: string;
  label: string;
  prompt: string;
  required: boolean;
  reason?: string;
};

export type WorkflowSideEffect = {
  kind:
    | "existing_file_returned"
    | "file_generated"
    | "draft_created"
    | "email_sent"
    | "record_created"
    | "record_updated"
    | "import_completed"
    | "thread_attachment_saved";
  targetType?: string;
  targetId?: string;
  description?: string;
};

export type WorkflowArtifact = {
  type: string;
  id?: string;
  data?: unknown;
};

export type WorkflowCommsPlan = {
  headline: string;
  body?: string;
  questions?: string[];
  nextActionLabel?: string;
};

export type WorkflowAuditEntry = {
  step: string;
  decision: string;
  detail?: string;
};

export type WorkflowOutcome<
  Kind extends WorkflowKind = WorkflowKind,
  NextAction extends string = string,
> = {
  workflowKind: Kind;
  status: WorkflowStatus;
  nextAction: NextAction;
  requiredSlots: WorkflowSlot[];
  forbiddenQuestions: string[];
  forbiddenClaims: string[];
  sideEffects: WorkflowSideEffect[];
  artifacts: WorkflowArtifact[];
  comms: WorkflowCommsPlan;
  audit: WorkflowAuditEntry[];
};

export type WorkflowContext = {
  orgId: Id<"organizations">;
  userId?: Id<"users">;
  threadId?: Id<"threads">;
  channel: WorkflowChannel;
};

export type WorkflowToolResult<T extends Record<string, unknown> = Record<string, unknown>> =
  T & {
    workflowOutcome: WorkflowOutcome;
    message: string;
  };
