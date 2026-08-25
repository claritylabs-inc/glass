import type { Id } from "../../_generated/dataModel";
import { z } from "zod";

export type WorkflowChannel = "web" | "email" | "imessage" | "mcp" | "cli" | "api";

export type WorkflowKind =
  | "certificate_request"
  | "broker_follow_up"
  | "document_delivery"
  | "mailbox_task"
  | "email_delivery"
  | "requirement_import";

export type WorkflowStatus =
  | "completed"
  | "needs_input"
  | "held"
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

const workflowSlotSchema = z.object({
  key: z.string(),
  label: z.string(),
  prompt: z.string(),
  required: z.boolean(),
  reason: z.string().optional(),
});

const workflowSideEffectSchema = z.object({
  kind: z.enum([
    "existing_file_returned",
    "file_generated",
    "draft_created",
    "email_sent",
    "record_created",
    "record_updated",
    "import_completed",
    "thread_attachment_saved",
  ]),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  description: z.string().optional(),
});

const workflowArtifactSchema = z.object({
  type: z.string(),
  id: z.string().optional(),
  data: z.unknown().optional(),
});

export const workflowOutcomeSchema = z.object({
  workflowKind: z.enum([
    "certificate_request",
    "broker_follow_up",
    "document_delivery",
    "mailbox_task",
    "email_delivery",
    "requirement_import",
  ]),
  status: z.enum([
    "completed",
    "needs_input",
    "held",
    "running",
    "failed_recoverably",
    "failed_terminal",
  ]),
  nextAction: z.string(),
  requiredSlots: z.array(workflowSlotSchema),
  forbiddenQuestions: z.array(z.string()),
  forbiddenClaims: z.array(z.string()),
  sideEffects: z.array(workflowSideEffectSchema),
  artifacts: z.array(workflowArtifactSchema),
  comms: z.object({
    headline: z.string(),
    body: z.string().optional(),
    questions: z.array(z.string()).optional(),
    nextActionLabel: z.string().optional(),
  }),
  audit: z.array(
    z.object({
      step: z.string(),
      decision: z.string(),
      detail: z.string().optional(),
    }),
  ),
});

export function parseWorkflowOutcome(value: unknown): WorkflowOutcome | undefined {
  const result = workflowOutcomeSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
