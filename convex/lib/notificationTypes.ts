// convex/lib/notificationTypes.ts

import dayjs from "dayjs";

export const ACTIVE_NOTIFICATION_TYPES = [
  "broker_action",
  "incomplete_extraction",
  "client_invitation_accepted",
  "client_onboarding_completed",
  "vendor_compliance_met",
  "vendor_compliance_gap",
  "vendor_policy_expiring",
  "vendor_policy_expired",
  "policy_change_needs_info",
  "policy_change_completed",
] as const;

// Kept out of settings and active notify contracts. The schema still accepts
// these values so older notification rows remain readable.
export const RETIRED_NOTIFICATION_TYPES = [
  "coverage_gap",
  "renewal_reminder",
  "policy_lapsed",
  "coverage_limit_concern",
  "missing_coverage",
  "carrier_rating_change",
  "extraction_complete",
  "extraction_error",
  "stale_data",
  "premium_anomaly",
  "client_document_uploaded",
  "policy_delivered_by_broker",
] as const;

export const ALL_NOTIFICATION_TYPES = [
  ...ACTIVE_NOTIFICATION_TYPES,
  ...RETIRED_NOTIFICATION_TYPES,
] as const;

export type NotificationType = (typeof ACTIVE_NOTIFICATION_TYPES)[number];
export type StoredNotificationType = (typeof ALL_NOTIFICATION_TYPES)[number];

export type NotificationSeverity = "info" | "warning" | "critical";

export const NOTIFICATION_SEVERITY: Record<StoredNotificationType, NotificationSeverity> = {
  broker_action: "info",
  incomplete_extraction: "warning",
  client_invitation_accepted: "info",
  client_onboarding_completed: "info",
  vendor_compliance_met: "info",
  vendor_compliance_gap: "warning",
  vendor_policy_expiring: "warning",
  vendor_policy_expired: "critical",
  policy_change_needs_info: "warning",
  policy_change_completed: "info",
  coverage_gap: "warning",
  renewal_reminder: "warning",
  policy_lapsed: "critical",
  coverage_limit_concern: "warning",
  missing_coverage: "warning",
  carrier_rating_change: "warning",
  extraction_complete: "info",
  extraction_error: "warning",
  stale_data: "info",
  premium_anomaly: "warning",
  client_document_uploaded: "info",
  policy_delivered_by_broker: "info",
};

/** Active notification types that coalesce. Value is window in ms. */
export const COALESCE_WINDOW_MS: Partial<Record<NotificationType, number>> = {
  vendor_compliance_met: 24 * 60 * 60 * 1000,
  vendor_compliance_gap: 24 * 60 * 60 * 1000,
  vendor_policy_expiring: 24 * 60 * 60 * 1000,
  vendor_policy_expired: 24 * 60 * 60 * 1000,
};

/**
 * Build a stable coalesce key from an array of parts and the configured time bucket.
 * @param parts   e.g. ["vendor_compliance_gap", clientOrgId, relationshipId]
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

export type NotificationChannel = "email" | "imessage";

export function getEffectiveChannelDefault(
  channel: NotificationChannel,
  severity: NotificationSeverity,
): boolean {
  if (channel === "email") return getEffectiveEmailDefault(severity);
  return false;
}

export type NotificationSettingsAudience = "broker" | "client";

export interface NotificationSettingsRow {
  type: NotificationType;
  label: string;
  group: string;
  audiences: readonly NotificationSettingsAudience[];
}

export const NOTIFICATION_SETTINGS_ROWS: readonly NotificationSettingsRow[] = [
  {
    type: "client_invitation_accepted",
    label: "Client accepted invitation",
    group: "Client activity",
    audiences: ["broker"],
  },
  {
    type: "client_onboarding_completed",
    label: "Client completed onboarding",
    group: "Client activity",
    audiences: ["broker"],
  },
  {
    type: "broker_action",
    label: "Broker action needed",
    group: "Client activity",
    audiences: ["broker"],
  },
  {
    type: "incomplete_extraction",
    label: "Policy extraction needs review",
    group: "Policies",
    audiences: ["broker", "client"],
  },
  {
    type: "policy_change_needs_info",
    label: "Policy change needs info",
    group: "Policies",
    audiences: ["broker", "client"],
  },
  {
    type: "policy_change_completed",
    label: "Policy change completed",
    group: "Policies",
    audiences: ["broker", "client"],
  },
  {
    type: "vendor_compliance_gap",
    label: "Vendor compliance gaps",
    group: "Vendor compliance",
    audiences: ["broker", "client"],
  },
  {
    type: "vendor_policy_expiring",
    label: "Vendor policy expiring",
    group: "Vendor compliance",
    audiences: ["broker", "client"],
  },
  {
    type: "vendor_policy_expired",
    label: "Vendor policy expired",
    group: "Vendor compliance",
    audiences: ["broker", "client"],
  },
  {
    type: "vendor_compliance_met",
    label: "Vendor becomes compliant",
    group: "Vendor compliance",
    audiences: ["broker", "client"],
  },
];

export function getNotificationSettingsRows(
  audience: NotificationSettingsAudience,
): NotificationSettingsRow[] {
  return NOTIFICATION_SETTINGS_ROWS.filter((row) =>
    row.audiences.includes(audience),
  );
}
