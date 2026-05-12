// convex/lib/notificationTypes.ts

export const ALL_NOTIFICATION_TYPES = [
  // Existing glass types (unchanged)
  "merge_suggestion",
  "coverage_gap",
  "renewal_reminder",
  "policy_lapsed",
  "coverage_limit_concern",
  "missing_coverage",
  "carrier_rating_change",
  "broker_action",
  "extraction_complete",
  "extraction_error",
  "incomplete_extraction",
  "stale_data",
  "premium_anomaly",
  // Broker/client lifecycle
  "client_invitation_accepted",
  "client_onboarding_completed",
  "client_document_uploaded",
  "policy_delivered_by_broker",
  "quote_delivered_by_broker",
] as const;

export type NotificationType = (typeof ALL_NOTIFICATION_TYPES)[number];

export type NotificationSeverity = "info" | "warning" | "critical";

export const NOTIFICATION_SEVERITY: Record<NotificationType, NotificationSeverity> = {
  // Existing
  merge_suggestion: "info",
  coverage_gap: "warning",
  renewal_reminder: "warning",
  policy_lapsed: "critical",
  coverage_limit_concern: "warning",
  missing_coverage: "warning",
  carrier_rating_change: "warning",
  broker_action: "info",
  extraction_complete: "info",
  extraction_error: "warning",
  incomplete_extraction: "warning",
  stale_data: "info",
  premium_anomaly: "warning",
  // Broker/client lifecycle
  client_invitation_accepted: "info",
  client_onboarding_completed: "info",
  client_document_uploaded: "info",
  policy_delivered_by_broker: "info",
  quote_delivered_by_broker: "info",
};

/** Types that coalesce within a 10-minute window. Value is window in ms. */
export const COALESCE_WINDOW_MS: Partial<Record<NotificationType, number>> = {
  client_document_uploaded: 10 * 60 * 1000,
};

/**
 * Build a stable coalesce key from an array of parts and the current 10-min bucket.
 * @param parts   e.g. ["client_document_uploaded", brokerOrgId, clientOrgId]
 * @param windowMs  the coalesce window in ms (from COALESCE_WINDOW_MS)
 * @param nowMs   current timestamp in ms (injectable for tests)
 */
export function buildCoalesceKey(
  parts: string[],
  windowMs: number,
  nowMs: number = Date.now(),
): string {
  const bucket = Math.floor(nowMs / windowMs);
  return [...parts, String(bucket)].join(":");
}

/** Returns true when the type's severity triggers email by default. */
export function getEffectiveEmailDefault(severity: NotificationSeverity): boolean {
  return severity === "warning" || severity === "critical";
}
