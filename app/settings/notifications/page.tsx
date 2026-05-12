"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

interface PrefRow {
  type: string;
  label: string;
  group: string;
}

const BROKER_PREF_ROWS: PrefRow[] = [
  { type: "client_document_uploaded", label: "Client uploads document", group: "Documents" },
  { type: "policy_delivered_by_broker", label: "Policy delivered", group: "Policies & Quotes" },
  { type: "quote_delivered_by_broker", label: "Quote delivered", group: "Policies & Quotes" },
  { type: "renewal_reminder", label: "Renewal reminder", group: "Policies & Quotes" },
  { type: "policy_lapsed", label: "Policy lapsed", group: "Policies & Quotes" },
  { type: "client_invitation_accepted", label: "Client accepted invitation", group: "Account" },
  { type: "client_onboarding_completed", label: "Client completed onboarding", group: "Account" },
];

const GROUPS = Array.from(new Set(BROKER_PREF_ROWS.map((r) => r.group)));

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
]);

interface NotificationPreferencesPageProps {
  orgId: Id<"organizations">;
}

export default function NotificationPreferencesPage({ orgId }: NotificationPreferencesPageProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _api = api as any;
  const prefs = useQuery(_api.notificationPreferences.getForUser, { orgId }) ?? [];
  const setAll = useMutation(_api.notificationPreferences.setAllEmail);
  const set = useMutation(_api.notificationPreferences.set);

  function getEnabled(type: string, channel: "in_app" | "email"): boolean {
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
  const allEmailEnabled = allEmailRow ? allEmailRow.enabled : true;

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <h1 className="text-xl font-semibold text-foreground mb-6">Notification Preferences</h1>

      {/* Master email toggle */}
      <div className="flex items-center justify-between p-4 rounded-lg border border-foreground/10 mb-8">
        <div>
          <p className="text-sm font-medium text-foreground">Email — all notifications</p>
          <p className="text-xs text-muted-foreground mt-0.5">Master toggle for all email delivery</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={allEmailEnabled}
          onClick={() => setAll({ orgId, enabled: !allEmailEnabled })}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            allEmailEnabled ? "bg-blue-600" : "bg-foreground/20"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
              allEmailEnabled ? "translate-x-5" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Per-type grid */}
      {GROUPS.map((group) => (
        <div key={group} className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {group}
          </h2>
          <div className="rounded-lg border border-foreground/10 overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[1fr_80px_80px] px-4 py-2 border-b border-foreground/6 bg-foreground/[0.02]">
              <span className="text-xs font-medium text-muted-foreground">Event</span>
              <span className="text-xs font-medium text-muted-foreground text-center">In-app</span>
              <span className="text-xs font-medium text-muted-foreground text-center">Email</span>
            </div>
            {BROKER_PREF_ROWS.filter((r) => r.group === group).map((row, i, arr) => (
              <div
                key={row.type}
                className={`grid grid-cols-[1fr_80px_80px] px-4 py-3 items-center ${
                  i < arr.length - 1 ? "border-b border-foreground/[0.04]" : ""
                }`}
              >
                <span className="text-sm text-foreground">{row.label}</span>
                {(["in_app", "email"] as const).map((channel) => {
                  const enabled = getEnabled(row.type, channel);
                  return (
                    <div key={channel} className="flex justify-center">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        onClick={() => set({ orgId, type: row.type, channel, enabled: !enabled })}
                        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                          enabled ? "bg-blue-600" : "bg-foreground/20"
                        }`}
                      >
                        <span
                          className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
                            enabled ? "translate-x-3.5" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
