"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Mail } from "lucide-react";
import { cn } from "@/lib/utils";

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
  { type: "vendor_compliance_gap", label: "Vendor compliance gaps", group: "Vendor Compliance" },
  { type: "vendor_policy_expiring", label: "Vendor policy expiring", group: "Vendor Compliance" },
  { type: "vendor_policy_expired", label: "Vendor policy expired", group: "Vendor Compliance" },
  { type: "vendor_compliance_met", label: "Vendor becomes compliant", group: "Vendor Compliance" },
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
  "vendor_compliance_gap",
  "vendor_policy_expiring",
  "vendor_policy_expired",
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
    <div className="flex max-w-3xl flex-col gap-5">
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
          <NotificationSwitch
            checked={allEmailEnabled}
            onCheckedChange={() => setAll({ orgId, enabled: !allEmailEnabled })}
            label="Toggle all email notifications"
          />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {GROUPS.map((group) => (
          <section key={group} className="rounded-lg border border-foreground/6 bg-card">
            <div className="grid grid-cols-[minmax(0,1fr)_64px_64px] items-center border-b border-foreground/6 px-5 py-3.5">
              <h2 className="text-sm font-medium text-foreground">{group}</h2>
              <span className="text-center text-label-sm font-medium text-muted-foreground/70">
                In-app
              </span>
              <span className="text-center text-label-sm font-medium text-muted-foreground/70">
                Email
              </span>
            </div>
            {BROKER_PREF_ROWS.filter((r) => r.group === group).map((row, i, arr) => (
              <div
                key={row.type}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_64px_64px] items-center px-5 py-3.5",
                  i < arr.length - 1 && "border-b border-foreground/6",
                )}
              >
                <span className="min-w-0 truncate text-body-sm text-foreground">{row.label}</span>
                {(["in_app", "email"] as const).map((channel) => {
                  const enabled = getEnabled(row.type, channel);
                  return (
                    <div key={channel} className="flex justify-center">
                      <NotificationSwitch
                        checked={enabled}
                        compact
                        onCheckedChange={() =>
                          set({ orgId, type: row.type, channel, enabled: !enabled })
                        }
                        label={`${row.label} ${channel === "in_app" ? "in-app" : "email"}`}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function NotificationSwitch({
  checked,
  onCheckedChange,
  label,
  compact = false,
}: {
  checked: boolean;
  onCheckedChange: () => void;
  label: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onCheckedChange}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full transition-colors cursor-pointer",
        compact ? "h-4 w-7" : "h-5 w-9",
        checked ? "bg-brand" : "bg-foreground/15",
      )}
    >
      <span
        className={cn(
          "inline-block transform rounded-full transition-transform",
          compact ? "size-3" : "size-3.5",
          checked ? "bg-brand-foreground" : "bg-background",
          checked
            ? compact
              ? "translate-x-3.5"
              : "translate-x-5"
            : compact
              ? "translate-x-0.5"
              : "translate-x-1",
        )}
      />
    </button>
  );
}
