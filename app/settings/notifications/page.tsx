"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Mail } from "lucide-react";
import { SettingsSwitch } from "@/components/settings/settings-switch";

interface PrefRow {
  type: string;
  label: string;
  group: string;
  audience?: "broker";
}

const BROKER_PREF_ROWS: PrefRow[] = [
  { type: "client_document_uploaded", label: "Client uploads document", group: "Documents", audience: "broker" },
  { type: "policy_delivered_by_broker", label: "Policy delivered", group: "Policies & Quotes" },
  { type: "quote_delivered_by_broker", label: "Quote delivered", group: "Policies & Quotes" },
  { type: "renewal_reminder", label: "Renewal reminder", group: "Policies & Quotes" },
  { type: "policy_lapsed", label: "Policy lapsed", group: "Policies & Quotes" },
  { type: "vendor_compliance_gap", label: "Vendor compliance gaps", group: "Vendor Compliance" },
  { type: "vendor_policy_expiring", label: "Vendor policy expiring", group: "Vendor Compliance" },
  { type: "vendor_policy_expired", label: "Vendor policy expired", group: "Vendor Compliance" },
  { type: "vendor_compliance_met", label: "Vendor becomes compliant", group: "Vendor Compliance" },
  { type: "client_invitation_accepted", label: "Client accepted invitation", group: "Account", audience: "broker" },
  { type: "client_onboarding_completed", label: "Client completed onboarding", group: "Account", audience: "broker" },
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
]);

interface NotificationPreferencesPageProps {
  orgId: Id<"organizations">;
  isBroker: boolean;
}

type NotificationChannel = "in_app" | "email";

export default function NotificationPreferencesPage({ orgId, isBroker }: NotificationPreferencesPageProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _api = api as any;
  const prefs = useQuery(_api.notificationPreferences.getForUser, { orgId }) ?? [];
  const setAll = useMutation(_api.notificationPreferences.setAllEmail);
  const set = useMutation(_api.notificationPreferences.set);
  const [optimisticPrefs, setOptimisticPrefs] = useState<Record<string, boolean>>({});
  const visibleRows = BROKER_PREF_ROWS.filter((row) => isBroker || row.audience !== "broker");
  const groups = Array.from(new Set(visibleRows.map((row) => row.group)));

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
    return true; // in_app defaults on
  }

  const allEmailRow = (prefs as Array<{ type: string; channel: string; enabled: boolean }>).find(
    (p) => p.type === "__all__" && p.channel === "email"
  );
  const allEmailEnabled = optimisticPrefs[prefKey("__all__", "email")] ?? (allEmailRow ? allEmailRow.enabled : true);

  async function toggleAllEmail() {
    const next = !allEmailEnabled;
    const key = prefKey("__all__", "email");
    setOptimisticPrefs((current) => ({ ...current, [key]: next }));
    try {
      await setAll({ orgId, enabled: next });
    } catch (err) {
      setOptimisticPrefs((current) => ({ ...current, [key]: !next }));
      console.warn("[NotificationPreferencesPage] Failed to update email notification preference", err);
    }
  }

  async function togglePreference(type: string, channel: NotificationChannel) {
    const next = !getEnabled(type, channel);
    const key = prefKey(type, channel);
    setOptimisticPrefs((current) => ({ ...current, [key]: next }));
    try {
      await set({ orgId, type, channel, enabled: next });
    } catch (err) {
      setOptimisticPrefs((current) => ({ ...current, [key]: !next }));
      console.warn("[NotificationPreferencesPage] Failed to update notification preference", err);
    }
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <div>
        <h1 className="text-lg font-medium text-foreground">Notifications</h1>
        <p className="mt-1 text-body-sm text-muted-foreground/70">
          Choose how Glass should notify your team about account, policy, and vendor events.
        </p>
      </div>

      <div className="rounded-lg border border-foreground/6 bg-card">
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/5 text-foreground">
              <Mail className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="text-body-sm font-medium text-foreground">Email notifications</p>
              <p className="mt-0.5 text-label-sm text-muted-foreground/60">
                Master control for every email notification.
              </p>
            </div>
          </div>
          <SettingsSwitch
            checked={allEmailEnabled}
            onCheckedChange={() => void toggleAllEmail()}
            label="Toggle all email notifications"
          />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <section key={group} className="overflow-hidden rounded-lg border border-foreground/6 bg-card">
            <table className="w-full table-fixed">
              <colgroup>
                <col />
                <col className="w-28" />
                <col className="w-28" />
              </colgroup>
              <thead>
                <tr className="border-b border-foreground/6">
                  <th className="px-5 py-3.5 text-left text-sm font-medium text-foreground">
                    {group}
                  </th>
                  <th className="px-3 py-3.5 text-center text-label-sm font-medium text-muted-foreground/70">
                    In-app
                  </th>
                  <th className="px-3 py-3.5 text-center text-label-sm font-medium text-muted-foreground/70">
                    Email
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.filter((r) => r.group === group).map((row) => (
                  <tr key={row.type} className="border-b border-foreground/6 last:border-b-0">
                    <td className="px-5 py-3.5 text-body-sm text-foreground">{row.label}</td>
                    {(["in_app", "email"] as const).map((channel) => {
                      const enabled = getEnabled(row.type, channel);
                      return (
                        <td key={channel} className="px-3 py-3.5">
                          <div className="flex justify-center">
                            <SettingsSwitch
                              checked={enabled}
                              onCheckedChange={() => void togglePreference(row.type, channel)}
                              label={`${row.label} ${channel === "in_app" ? "in-app" : "email"}`}
                            />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}
