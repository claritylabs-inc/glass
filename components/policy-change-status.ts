const POLICY_CHANGE_STATUS_ALIASES: Record<string, string> = {
  accepted: "completed",
  draft: "intake",
  ready: "ready_to_submit",
  submitted: "sent",
};

export function formatPolicyChangeStatus(status?: string) {
  if (!status) return "Request";
  const normalized = POLICY_CHANGE_STATUS_ALIASES[status] ?? status;
  return normalized.replace(/_/g, " ");
}

export function isPolicyChangeTerminal(status?: string) {
  return (
    status === "accepted" ||
    status === "completed" ||
    status === "declined" ||
    status === "cancelled"
  );
}
