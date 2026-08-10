export type SlackSetupLifecycleStatus =
  | "in_progress"
  | "completed"
  | "cancelled"
  | null;

export type SlackRowStatusTone = "neutral" | "warning" | "danger" | "success";

export function resolveSlackRowStatus(args: {
  connected: boolean;
  needsUpdate: boolean;
  setupStatus: SlackSetupLifecycleStatus;
  enabled: boolean;
}): { label: "Not connected" | "Setup in progress" | "Update required" | "On" | "Off"; tone: SlackRowStatusTone } {
  if (args.needsUpdate) return { label: "Update required", tone: "danger" };
  if (args.setupStatus === "in_progress") {
    return { label: "Setup in progress", tone: "warning" };
  }
  if (!args.connected) return { label: "Not connected", tone: "neutral" };
  return args.enabled
    ? { label: "On", tone: "success" }
    : { label: "Off", tone: "neutral" };
}
