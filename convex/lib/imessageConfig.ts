export function isImessageEnabled(): boolean {
  return process.env.IMESSAGE_ENABLED === "true";
}

export function getImessageWorkerUrl(): string | undefined {
  if (!isImessageEnabled()) return undefined;
  return process.env.IMESSAGE_WORKER_URL;
}
