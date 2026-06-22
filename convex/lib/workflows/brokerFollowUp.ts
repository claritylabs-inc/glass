import { workflowCommsPlan, workflowToolMessage } from "./comms";
import type { WorkflowOutcome, WorkflowSlot, WorkflowToolResult } from "./types";

export function brokerFollowUpOutcome(args: {
  action: "created" | "updated" | "status_checked" | "email_drafted" | "completed_from_endorsement";
  caseId?: string;
  policyId?: string;
  status?: string;
  requestKind?: string;
  needsRecipient?: boolean;
  pendingEmailId?: string;
  recipientEmail?: string;
  data?: Record<string, unknown>;
}): WorkflowToolResult {
  const requiredSlots: WorkflowSlot[] = args.needsRecipient
    ? [{
        key: "brokerRecipientEmail",
        label: "Broker email",
        prompt: "What broker email should I use for this follow-up?",
        required: true,
        reason: "Glass can capture and draft the follow-up, but sending requires a known recipient.",
      }]
    : [];
  const outcome: WorkflowOutcome<"broker_follow_up"> = {
    workflowKind: "broker_follow_up",
    status: requiredSlots.length > 0
      ? "needs_input"
      : args.action === "completed_from_endorsement"
        ? "completed"
        : "running",
    nextAction: requiredSlots.length > 0
      ? "ask_for_broker_recipient"
      : args.action === "email_drafted"
        ? "request_send_approval"
        : args.action,
    requiredSlots,
    forbiddenQuestions: [],
    forbiddenClaims: [
      "email_sent_without_send_side_effect",
      "policy_changed_without_endorsement_completion",
    ],
    sideEffects: [
      ...(args.caseId
        ? [{
            kind: args.action === "created" ? "record_created" as const : "record_updated" as const,
            targetType: "policyChangeCase",
            targetId: args.caseId,
          }]
        : []),
      ...(args.pendingEmailId
        ? [{
            kind: "draft_created" as const,
            targetType: "pendingEmail",
            targetId: args.pendingEmailId,
          }]
        : []),
    ],
    artifacts: [{
      type: "broker_follow_up",
      id: args.caseId,
      data: args.data ?? args,
    }],
    comms: workflowCommsPlan({
      headline: args.needsRecipient
        ? "Broker follow-up captured. I need the broker email before sending."
        : args.action === "email_drafted"
          ? "Broker email draft is ready for review."
          : args.action === "completed_from_endorsement"
            ? "Broker follow-up completed from the endorsement."
            : "Broker follow-up updated.",
      questions: requiredSlots.map((slot) => slot.prompt),
    }),
    audit: [{
      step: args.action,
      decision: requiredSlots.length > 0 ? "needs_input" : "accepted",
      detail: args.status,
    }],
  };
  return {
    ...args,
    ...(args.data ?? {}),
    message: workflowToolMessage(outcome),
    workflowOutcome: outcome,
  };
}
