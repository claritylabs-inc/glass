"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import dayjs from "dayjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Mail, MessageSquareText } from "lucide-react";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { OperationalPanel } from "@/components/ui/operational-panel";
import {
  useCachedQuery,
  useUpsertCachedQuery,
} from "@/lib/sync/use-cached-query";

interface PrefRow {
  type: string;
  label: string;
  group: string;
}

const BROKER_PREF_ROWS: PrefRow[] = [
  { type: "client_document_uploaded", label: "Client uploads document", group: "Client Activity" },
  { type: "client_invitation_accepted", label: "Client accepted invitation", group: "Client Activity" },
  { type: "client_onboarding_completed", label: "Client completed onboarding", group: "Client Activity" },
  { type: "policy_delivered_by_broker", label: "Policy delivered", group: "Policies" },
  { type: "policy_change_needs_info", label: "Policy change needs info", group: "Policies" },
  { type: "policy_change_completed", label: "Policy change completed", group: "Policies" },
  { type: "policy_declaration_discrepancy", label: "Policy details do not match", group: "Policies" },
  { type: "renewal_reminder", label: "Renewal reminder", group: "Policies" },
  { type: "policy_lapsed", label: "Policy lapsed", group: "Policies" },
  { type: "vendor_compliance_gap", label: "Vendor compliance gaps", group: "Vendor Compliance" },
  { type: "vendor_policy_expiring", label: "Vendor policy expiring", group: "Vendor Compliance" },
  { type: "vendor_policy_expired", label: "Vendor policy expired", group: "Vendor Compliance" },
  { type: "vendor_compliance_met", label: "Vendor becomes compliant", group: "Vendor Compliance" },
];

const CLIENT_PREF_ROWS: PrefRow[] = [
  { type: "policy_delivered_by_broker", label: "Policy delivered", group: "Policies" },
  { type: "policy_change_needs_info", label: "Policy change needs info", group: "Policies" },
  { type: "policy_change_completed", label: "Policy change completed", group: "Policies" },
  { type: "policy_declaration_discrepancy", label: "Policy details do not match", group: "Policies" },
  { type: "renewal_reminder", label: "Renewal reminder", group: "Policies" },
  { type: "policy_lapsed", label: "Policy lapsed", group: "Policies" },
  { type: "vendor_compliance_gap", label: "Vendor compliance gaps", group: "Vendor Compliance" },
  { type: "vendor_policy_expiring", label: "Vendor policy expiring", group: "Vendor Compliance" },
  { type: "vendor_policy_expired", label: "Vendor policy expired", group: "Vendor Compliance" },
  { type: "vendor_compliance_met", label: "Vendor becomes compliant", group: "Vendor Compliance" },
];

const PARTNER_PREF_ROWS: PrefRow[] = [
  { type: "program_admin_certificate_request", label: "Certified COI needs approval", group: "Program Approvals" },
  { type: "program_admin_pce_request", label: "Policy change needs approval", group: "Program Approvals" },
];

const WARN_TYPES = new Set([
  "renewal_reminder",
  "policy_lapsed",
  "coverage_gap",
  "coverage_limit_concern",
  "missing_coverage",
  "carrier_rating_change",
  "extraction_error",
  "incomplete_extraction",
  "premium_anomaly",
  "vendor_compliance_gap",
  "vendor_policy_expiring",
  "vendor_policy_expired",
  "program_admin_certificate_request",
  "program_admin_pce_request",
  "policy_declaration_discrepancy",
  "policy_change_needs_info",
]);

interface NotificationPreferencesPageProps {
  orgId: Id<"organizations">;
  orgType: "broker" | "client" | "partner";
}

type NotificationChannel = "in_app" | "email" | "imessage";

function MasterNotificationRow({
  icon: Icon,
  title,
  description,
  checked,
  onCheckedChange,
  label,
}: {
  icon: typeof Mail;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: () => void;
  label: string;
}) {
  return (
    <OperationalPanel as="div">
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/5 text-foreground">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-medium text-foreground">{title}</p>
            <p className="mt-0.5 text-label text-muted-foreground/60">
              {description}
            </p>
          </div>
        </div>
        <SettingsSwitch
          checked={checked}
          onCheckedChange={onCheckedChange}
          label={label}
        />
      </div>
    </OperationalPanel>
  );
}

export default function NotificationPreferencesPage({ orgId, orgType }: NotificationPreferencesPageProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _api = api as any;
  const prefs = useCachedQuery(
    "notificationPreferences.getForUser",
    _api.notificationPreferences.getForUser,
    { orgId },
  ) ?? [];
  const setAll = useMutation(_api.notificationPreferences.setAllEmail);
  const setAllChannel = useMutation(_api.notificationPreferences.setAllChannel);
  const set = useMutation(_api.notificationPreferences.set);
  const upsertCachedPrefs = useUpsertCachedQuery<
    Array<{
      _id: Id<"notificationPreferences">;
      _creationTime: number;
      orgId: Id<"organizations">;
      type: string;
      channel: string;
      enabled: boolean;
      updatedAt: number;
    }>,
    { orgId: Id<"organizations"> }
  >("notificationPreferences.getForUser");
  const [optimisticPrefs, setOptimisticPrefs] = useState<Record<string, boolean>>({});
  const visibleRows =
    orgType === "broker"
      ? BROKER_PREF_ROWS
      : orgType === "partner"
        ? PARTNER_PREF_ROWS
        : CLIENT_PREF_ROWS;
  const groups = Array.from(new Set(visibleRows.map((row) => row.group)));
  const descriptor =
    orgType === "broker"
      ? "client, policy, vendor and account events"
      : orgType === "partner"
        ? "program approval, certified COI and policy-change events"
        : "policy and vendor compliance events";

  function prefKey(type: string, channel: NotificationChannel): string {
    return `${type}:${channel}`;
  }

  function getEnabled(type: string, channel: NotificationChannel): boolean {
    const optimisticValue = optimisticPrefs[prefKey(type, channel)];
    if (optimisticValue !== undefined) return optimisticValue;

    const row = (prefs as Array<{ type: string; channel: string; enabled: boolean }>).find(
      (p) => p.type === type && p.channel === channel
    );
    if (row) return row.enabled;
    // Severity-default for email: warning/critical types default on, info defaults off
    if (channel === "email") {
      return WARN_TYPES.has(type);
    }
    if (channel === "imessage") return false;
    return true; // in_app defaults on
  }

  const allEmailRow = (prefs as Array<{ type: string; channel: string; enabled: boolean }>).find(
    (p) => p.type === "__all__" && p.channel === "email"
  );
  const allEmailEnabled = optimisticPrefs[prefKey("__all__", "email")] ?? (allEmailRow ? allEmailRow.enabled : true);
  const allImessageRow = (prefs as Array<{ type: string; channel: string; enabled: boolean }>).find(
    (p) => p.type === "__all__" && p.channel === "imessage"
  );
  const allImessageEnabled = optimisticPrefs[prefKey("__all__", "imessage")] ?? (allImessageRow ? allImessageRow.enabled : false);

  async function patchCachedPreference(
    type: string,
    channel: NotificationChannel,
    enabled: boolean,
  ) {
    const now = dayjs().valueOf();
    await upsertCachedPrefs({ orgId }, (current) => {
      const existing = current ?? [];
      const index = existing.findIndex(
        (row) => row.type === type && row.channel === channel,
      );
      if (index >= 0) {
        return existing.map((row, rowIndex) =>
          rowIndex === index ? { ...row, enabled, updatedAt: now } : row,
        );
      }
      return [
        ...existing,
        {
          _id: `local:${orgId}:${type}:${channel}` as Id<"notificationPreferences">,
          _creationTime: now,
          orgId,
          type,
          channel,
          enabled,
          updatedAt: now,
        },
      ];
    });
  }

  async function toggleAllEmail() {
    const next = !allEmailEnabled;
    const key = prefKey("__all__", "email");
    setOptimisticPrefs((current) => ({ ...current, [key]: next }));
    try {
      await setAll({ orgId, enabled: next });
      await patchCachedPreference("__all__", "email", next);
      setOptimisticPrefs((current) => {
        const rest = { ...current };
        delete rest[key];
        return rest;
      });
    } catch (err) {
      setOptimisticPrefs((current) => ({ ...current, [key]: !next }));
      console.warn("[NotificationPreferencesPage] Failed to update email notification preference", err);
    }
  }

  async function toggleAllImessage() {
    const next = !allImessageEnabled;
    const key = prefKey("__all__", "imessage");
    setOptimisticPrefs((current) => ({ ...current, [key]: next }));
    try {
      await setAllChannel({ orgId, channel: "imessage", enabled: next });
      await patchCachedPreference("__all__", "imessage", next);
      setOptimisticPrefs((current) => {
        const rest = { ...current };
        delete rest[key];
        return rest;
      });
    } catch (err) {
      setOptimisticPrefs((current) => ({ ...current, [key]: !next }));
      console.warn("[NotificationPreferencesPage] Failed to update iMessage notification preference", err);
    }
  }

  async function togglePreference(type: string, channel: NotificationChannel) {
    const next = !getEnabled(type, channel);
    const key = prefKey(type, channel);
    setOptimisticPrefs((current) => ({ ...current, [key]: next }));
    try {
      await set({ orgId, type, channel, enabled: next });
      await patchCachedPreference(type, channel, next);
      setOptimisticPrefs((current) => {
        const rest = { ...current };
        delete rest[key];
        return rest;
      });
    } catch (err) {
      setOptimisticPrefs((current) => ({ ...current, [key]: !next }));
      console.warn("[NotificationPreferencesPage] Failed to update notification preference", err);
    }
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <div>
        <h1 className="text-lg font-medium text-foreground">Notifications</h1>
        <p className="mt-1 text-base text-muted-foreground/70">
          Choose how Glass should notify your team about {descriptor}.
        </p>
      </div>

      <MasterNotificationRow
        icon={Mail}
        title="Email notifications"
        description="Master control for every email notification."
        checked={allEmailEnabled}
        onCheckedChange={() => void toggleAllEmail()}
        label="Toggle all email notifications"
      />

      <MasterNotificationRow
        icon={MessageSquareText}
        title="iMessage notifications"
        description="Master control for opt-in text updates."
        checked={allImessageEnabled}
        onCheckedChange={() => void toggleAllImessage()}
        label="Toggle all iMessage notifications"
      />

      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <OperationalPanel key={group}>
            <table className="w-full table-fixed">
              <colgroup>
                <col />
                <col className="w-28" />
                <col className="w-28" />
                <col className="w-28" />
              </colgroup>
              <thead>
                <tr className="border-b border-foreground/6">
                  <th className="px-5 py-3.5 text-left text-base font-medium text-foreground">
                    {group}
                  </th>
                  <th className="px-3 py-3.5 text-center text-label font-medium text-muted-foreground/70">
                    In-app
                  </th>
                  <th className="px-3 py-3.5 text-center text-label font-medium text-muted-foreground/70">
                    Email
                  </th>
                  <th className="px-3 py-3.5 text-center text-label font-medium text-muted-foreground/70">
                    iMessage
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.filter((r) => r.group === group).map((row) => (
                  <tr key={row.type} className="border-b border-foreground/6 last:border-b-0">
                    <td className="px-5 py-3.5 text-base text-foreground">{row.label}</td>
                    {(["in_app", "email", "imessage"] as const).map((channel) => {
                      const enabled = getEnabled(row.type, channel);
                      return (
                        <td key={channel} className="px-3 py-3.5">
                          <div className="flex justify-center">
                            <SettingsSwitch
                              checked={enabled}
                              onCheckedChange={() => void togglePreference(row.type, channel)}
                              label={`${row.label} ${
                                channel === "in_app"
                                  ? "in-app"
                                  : channel === "imessage"
                                    ? "iMessage"
                                    : "email"
                              }`}
                            />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </OperationalPanel>
        ))}
      </div>
    </div>
  );
}
