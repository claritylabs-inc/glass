type ApplicationStatus = "draft" | "sent" | "in_progress" | "awaiting_review" | "complete" | "cancelled";
type GroupStatus = "not_started" | "in_progress" | "submitted" | "returned" | "accepted";

export function deriveApplicationStatus(groupStatuses: GroupStatus[]): ApplicationStatus {
  if (groupStatuses.length === 0) return "sent";

  if (groupStatuses.some((s) => s === "returned" || s === "in_progress")) return "in_progress";

  const allDone = groupStatuses.every((s) => s === "submitted" || s === "accepted");
  if (allDone) {
    const allAccepted = groupStatuses.every((s) => s === "accepted");
    return allAccepted ? "complete" : "awaiting_review";
  }

  // Mix of not_started only
  return "sent";
}
