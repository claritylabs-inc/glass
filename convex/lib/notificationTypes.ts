// convex/lib/notificationTypes.ts

import dayjs from "dayjs";

export const ALL_NOTIFICATION_TYPES = [
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
  // Vendor compliance
  "vendor_compliance_met",
  "vendor_compliance_gap",
  "vendor_policy_expiring",
  "vendor_policy_expired",
  "policy_change_needs_info",
  "policy_change_completed",
] as const;

export type NotificationType = (typeof ALL_NOTIFICATION_TYPES)[number];

export type NotificationSeverity = "info" | "warning" | "critical";

export const NOTIFICATION_SEVERITY: Record<NotificationType, NotificationSeverity> = {
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
  // Vendor compliance
  vendor_compliance_met: "info",
  vendor_compliance_gap: "warning",
  vendor_policy_expiring: "warning",
  vendor_policy_expired: "critical",
  policy_change_needs_info: "warning",
  policy_change_completed: "info",
};

/** Types that coalesce within a 10-minute window. Value is window in ms. */
export const COALESCE_WINDOW_MS: Partial<Record<NotificationType, number>> = {
  client_document_uploaded: 10 * 60 * 1000,
  vendor_compliance_met: 24 * 60 * 60 * 1000,
  vendor_compliance_gap: 24 * 60 * 60 * 1000,
  vendor_policy_expiring: 24 * 60 * 60 * 1000,
  vendor_policy_expired: 24 * 60 * 60 * 1000,
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
  nowMs: number = dayjs().valueOf(),
): string {
  const bucket = Math.floor(nowMs / windowMs);
  return [...parts, String(bucket)].join(":");
}

/** Returns true when the type's severity triggers email by default. */
export function getEffectiveEmailDefault(severity: NotificationSeverity): boolean {
  return severity === "warning" || severity === "critical";
}

export type NotificationChannel = "in_app" | "email" | "imessage";

export function getEffectiveChannelDefault(
  channel: NotificationChannel,
  severity: NotificationSeverity,
): boolean {
  if (channel === "in_app") return true;
  if (channel === "email") return getEffectiveEmailDefault(severity);
  return false;
}
