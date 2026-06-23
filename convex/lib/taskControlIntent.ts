function normalizeTaskControlText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type TaskControlIntent = "cancel_task" | "reset_task";

export function detectTaskControlIntent(text: string): TaskControlIntent | null {
  const normalized = normalizeTaskControlText(text);
  if (!normalized || normalized.length > 80) return null;

  if (
    /^(start over|start this over|reset|reset this|reset this task|reset the task|clear this|clear this task|clear the task|new task)$/.test(
      normalized,
    )
  ) {
    return "reset_task";
  }

  if (
    /^(nevermind|never mind|scratch that|scratch this|scratch it|forget that|forget this|forget it|drop that|drop this|drop it|leave it|leave this|leave that|leave it alone|leave it for now|leave that for now|cancel that|cancel this|cancel it|cancel this task|cancel the task|cancel the request|stop that|stop this|stop it|abort that|abort this|abort it|not now|no thanks)$/.test(
      normalized,
    )
  ) {
    return "cancel_task";
  }

  return null;
}

export function isTaskControlIntent(text: string): boolean {
  return detectTaskControlIntent(text) !== null;
}

export function taskControlResponse(intent: TaskControlIntent): string {
  return intent === "reset_task"
    ? "Done - I cleared that task. What would you like to do next?"
    : "Done - I cleared that task.";
}
