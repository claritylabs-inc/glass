export type SlackSetupLifecycleStatus =
  | "in_progress"
  | "completed"
  | "cancelled"
  | null;

export type SlackRowStatusTone = "neutral" | "warning" | "danger" | "success";
export type SlackHealthStatus =
  | "not_connected"
  | "revoked"
  | "disconnected"
  | "degraded"
  | "channel_unavailable"
  | "healthy";

export function resolveSlackRowStatus(args: {
  connected: boolean;
  needsUpdate: boolean;
  setupStatus: SlackSetupLifecycleStatus;
  enabled: boolean;
  healthStatus?: SlackHealthStatus;
}): {
  label:
    | "Not connected"
    | "Setup in progress"
    | "Update required"
    | "Reinstall required"
    | "Connection degraded"
    | "Channel unavailable"
    | "On"
    | "Off";
  tone: SlackRowStatusTone;
} {
  if (args.healthStatus === "revoked" || args.healthStatus === "disconnected") {
    return { label: "Reinstall required", tone: "danger" };
  }
  if (args.healthStatus === "degraded") {
    return { label: "Connection degraded", tone: "warning" };
  }
  if (args.healthStatus === "channel_unavailable") {
    return { label: "Channel unavailable", tone: "danger" };
  }
  if (args.needsUpdate) return { label: "Update required", tone: "danger" };
  if (args.setupStatus === "in_progress") {
    return { label: "Setup in progress", tone: "warning" };
  }
  if (!args.connected) return { label: "Not connected", tone: "neutral" };
  return args.enabled
    ? { label: "On", tone: "success" }
    : { label: "Off", tone: "neutral" };
}
