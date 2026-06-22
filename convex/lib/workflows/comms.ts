import type { WorkflowChannel, WorkflowCommsPlan, WorkflowOutcome } from "./types";

const CHANNEL_MAX_BODY: Partial<Record<WorkflowChannel, number>> = {
  imessage: 900,
};

function compactText(value: string, maxLength?: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!maxLength || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

export function renderWorkflowComms(
  outcome: Pick<WorkflowOutcome, "comms" | "requiredSlots">,
  channel: WorkflowChannel = "web",
) {
  const maxLength = CHANNEL_MAX_BODY[channel];
  const plan = outcome.comms;
  const parts = [
    plan.headline,
    plan.body,
    ...(plan.questions?.length
      ? plan.questions
      : outcome.requiredSlots.map((slot) => slot.prompt)),
  ].filter((part): part is string => Boolean(part?.trim()));
  return compactText(parts.join("\n\n"), maxLength);
}

export function workflowCommsPlan(args: {
  headline: string;
  body?: string;
  questions?: string[];
  nextActionLabel?: string;
}): WorkflowCommsPlan {
  return {
    headline: args.headline,
    body: args.body,
    questions: args.questions,
    nextActionLabel: args.nextActionLabel,
  };
}

export function workflowToolMessage(outcome: WorkflowOutcome, channel: WorkflowChannel = "web") {
  return renderWorkflowComms(outcome, channel);
}
