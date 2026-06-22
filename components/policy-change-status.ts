const STATUS_ALIASES: Record<string, string> = {
  accepted: "completed",
  draft: "intake",
  ready: "ready_to_submit",
};

const STATUS_LABELS: Record<string, string> = {
  cancelled: "Cancelled",
  completed: "Done",
  declined: "Declined",
  intake: "Draft",
  needs_info: "Needs info",
  ready_to_submit: "Ready",
  submitted: "Sent",
  waiting_for_endorsement: "Waiting",
};

const CLOSED_STATUSES = new Set(["completed", "declined", "cancelled"]);

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStatus(status?: unknown) {
  const raw = asString(status);
  return STATUS_ALIASES[raw] ?? raw;
}

export function cleanPolicyChangeCopy(value: string) {
  return value
    .replace(/source-span evidence/gi, "supporting policy evidence")
    .replace(/source spans?/gi, "policy evidence")
    .replace(/^PCE\b/, "Policy update")
    .replace(/\bPCE\b/g, "policy update");
}

export function formatPolicyChangeStatus(
  status?: unknown,
  hasQuestions = false,
) {
  if (hasQuestions) return "Needs info";
  const normalized = normalizeStatus(status);
  if (!normalized) return "Draft";
  return (
    STATUS_LABELS[normalized] ??
    normalized.replace(/_/g, " ").replace(/^\w/, (char) => char.toUpperCase())
  );
}

export function isPolicyChangeTerminal(status?: unknown) {
  return CLOSED_STATUSES.has(normalizeStatus(status));
}

export function policyChangeSourceLabel(source?: unknown) {
  const value = asString(source);
  const labels: Record<string, string> = {
    agent: "Agent",
    api: "API",
    chat: "Chat",
    cli: "CLI",
    email: "Email",
    imessage: "iMessage",
    manual: "Manual",
    mcp: "MCP",
    policy_page: "Policy page",
    sms: "SMS",
    uploaded_document: "Uploaded document",
  };
  return labels[value] ?? "";
}
