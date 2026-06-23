import { workflowCommsPlan } from "./comms";
import type { WorkflowOutcome } from "./types";

export function mailboxTaskOutcome(result: Record<string, unknown>): WorkflowOutcome<"mailbox_task"> {
  const mailboxErrors = Array.isArray(result.mailboxErrors)
    ? result.mailboxErrors
    : [];
  const searches = Array.isArray(result.searches) ? result.searches : [];
  const hasConnectedMailboxError = mailboxErrors.some((error) =>
    error &&
    typeof error === "object" &&
    String((error as Record<string, unknown>).message ?? "").includes("No connected email account"),
  );
  return {
    workflowKind: "mailbox_task",
    status: hasConnectedMailboxError
      ? "needs_input"
      : mailboxErrors.length > 0
        ? "failed_recoverably"
        : "completed",
    nextAction: hasConnectedMailboxError
      ? "connect_mailbox"
      : mailboxErrors.length > 0
        ? "review_recoverable_mailbox_errors"
        : "mailbox_task_completed",
    requiredSlots: hasConnectedMailboxError
      ? [{
          key: "connectedMailbox",
          label: "Connected mailbox",
          prompt: "Connect a mailbox in Settings, or select an accessible mailbox before asking Glass to search.",
          required: true,
        }]
      : [],
    forbiddenQuestions: [],
    forbiddenClaims: [
      "import_completed_without_import_side_effect",
      "invite_sent_without_send_side_effect",
    ],
    sideEffects: [],
    artifacts: [{ type: "mailbox_task", data: result }],
    comms: workflowCommsPlan({
      headline: hasConnectedMailboxError
        ? "I need a connected mailbox before I can search email."
        : String(result.text ?? "Mailbox task completed."),
    }),
    audit: [{
      step: "mailbox_coordinator",
      decision: hasConnectedMailboxError ? "needs_connection" : "completed",
      detail: `${searches.length} search windows`,
    }],
  };
}
