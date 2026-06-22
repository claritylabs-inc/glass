import { workflowCommsPlan, workflowToolMessage } from "./comms";
import type { WorkflowOutcome, WorkflowSlot, WorkflowToolResult } from "./types";

type MissingQuestion = {
  fieldId: string;
  label: string;
  section?: string;
  prompt: string;
  required?: boolean;
};

function slotsFromQuestions(questions: MissingQuestion[] = []): WorkflowSlot[] {
  return questions.map((question) => ({
    key: question.fieldId,
    label: question.label,
    prompt: question.prompt,
    required: question.required !== false,
    reason: question.section,
  }));
}

export function applicationIntakeOutcome(args: {
  action: "started" | "answers_saved" | "status_checked" | "packet_prepared";
  applicationIntakeId?: string;
  status?: string;
  title?: string;
  missingQuestions?: MissingQuestion[];
  answerCount?: number;
  packetId?: string;
  missingFieldIds?: string[];
}): WorkflowToolResult {
  const requiredSlots = slotsFromQuestions(args.missingQuestions);
  const packetReady = args.action === "packet_prepared" && args.status === "broker_ready";
  const status = requiredSlots.length > 0
    ? "needs_input"
    : packetReady || args.action === "packet_prepared"
      ? "completed"
      : "running";
  const outcome: WorkflowOutcome<"application_intake"> = {
    workflowKind: "application_intake",
    status,
    nextAction:
      requiredSlots.length > 0
        ? "ask_application_questions"
        : packetReady
          ? "packet_ready_for_broker_review"
          : args.action,
    requiredSlots,
    forbiddenQuestions: [],
    forbiddenClaims: [
      "carrier_submitted",
      "packet_ready_without_prepare_packet_side_effect",
    ],
    sideEffects: [
      ...(args.applicationIntakeId
        ? [{
            kind: args.action === "started" ? "record_created" as const : "record_updated" as const,
            targetType: "applicationIntake",
            targetId: args.applicationIntakeId,
          }]
        : []),
      ...(args.packetId
        ? [{
            kind: "record_created" as const,
            targetType: "applicationPacket",
            targetId: args.packetId,
            description: "Prepared an application packet for broker review.",
          }]
        : []),
    ],
    artifacts: [{
      type: args.packetId ? "application_packet" : "application_intake",
      id: args.packetId ?? args.applicationIntakeId,
      data: args,
    }],
    comms: workflowCommsPlan({
      headline: packetReady
        ? "Application packet is ready for broker review and submission."
        : args.action === "packet_prepared"
          ? "Application packet prepared, but required information is still missing."
        : requiredSlots.length > 0
          ? "Application intake is in progress."
          : args.action === "started"
            ? "Application intake started."
            : "Application intake updated.",
      questions: requiredSlots.map((slot) => slot.prompt),
    }),
    audit: [{
      step: args.action,
      decision: status,
      detail: args.status,
    }],
  };
  return {
    ...args,
    message: workflowToolMessage(outcome),
    workflowOutcome: outcome,
  };
}
