export type TaskControlIntent = "cancel_task" | "reset_task";

export function taskControlResponse(intent: TaskControlIntent): string {
  return intent === "reset_task"
    ? "Done - I cleared that task. What would you like to do next?"
    : "Done - I cleared that task.";
}
