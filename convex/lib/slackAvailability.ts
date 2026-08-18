type SlackConnectionAvailability = {
  status: "active" | "revoked" | "disconnected";
  healthStatus?: "healthy" | "degraded";
};

type SlackBindingAvailability = {
  status: "active" | "unavailable" | "archived";
  healthStatus?: "healthy" | "degraded";
};

export function isSlackConnectionHealthy(
  connection: SlackConnectionAvailability | null | undefined,
) {
  return (
    connection?.status === "active" && connection.healthStatus !== "degraded"
  );
}

export function isSlackBindingReachable(
  binding: SlackBindingAvailability | null | undefined,
) {
  return binding?.status === "active" && binding.healthStatus !== "degraded";
}

export function slackConnectionUnavailableReason(
  connection: SlackConnectionAvailability | null | undefined,
) {
  if (!connection) return "Slack connection is unavailable";
  if (connection.status === "revoked") return "Slack authorization is revoked";
  if (connection.status === "disconnected") return "Slack is disconnected";
  if (connection.healthStatus === "degraded") {
    return "Slack connection health could not be verified";
  }
  return undefined;
}

export function slackBindingUnavailableReason(
  binding: SlackBindingAvailability | null | undefined,
) {
  if (!binding) return "Slack channel is unavailable";
  if (binding.status === "archived") return "Slack channel binding is archived";
  if (binding.status === "unavailable") return "Slack channel is unavailable";
  if (binding.healthStatus === "degraded") {
    return "Slack channel health could not be verified";
  }
  return undefined;
}
