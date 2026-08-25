type TaskControlIntent = "cancel_task" | "reset_task";

export function parseTaskControlCommand(text: string): TaskControlIntent | null {
  const command = text.trim().toLowerCase();
  if (command === "/cancel") return "cancel_task";
  if (command === "/reset" || command === "/new") return "reset_task";
  return null;
}

export function taskControlResponse(intent: TaskControlIntent): string {
  return intent === "reset_task"
    ? "Done - I cleared that task. What would you like to do next?"
    : "Done - I cleared that task.";
}
