"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { ChevronRight, Loader2, Mail, MessageSquareText } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { FormSection } from "@/components/ui/form-section";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import {
  OperationalPanel,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  getEffectiveChannelDefault,
  getNotificationSettingsRows,
  isProactiveNotificationType,
  NOTIFICATION_SEVERITY,
  PROACTIVE_PREFERENCE_TYPE,
  type NotificationChannel,
  type NotificationSettingsRow,
} from "@/convex/lib/notificationTypes";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

interface NotificationPreferencesSectionProps {
  orgId: Id<"organizations">;
  orgType: "broker" | "client";
}

function prefKey(type: string, channel: NotificationChannel) {
  return `${type}:${channel}`;
}

function channelSummary(email: boolean, text: boolean) {
  if (email && text) return "Email and text";
  if (email) return "Email";
  if (text) return "Text";
  return "Off";
}

function DefaultNotificationRow({
  icon: Icon,
  title,
  description,
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  icon: typeof Mail;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: () => void;
  label: string;
  disabled: boolean;
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
            <p className="mt-0.5 text-base text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
        <SettingsSwitch
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          label={label}
        />
      </div>
    </OperationalPanel>
  );
}

function NotificationPreferenceDrawer({
  orgId,
  row,
  initialEmail,
  initialText,
  usesDefaults,
  onOpenChange,
  onSaved,
}: {
  orgId: Id<"organizations">;
  row: NotificationSettingsRow;
  initialEmail: boolean;
  initialText: boolean;
  usesDefaults: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (type: string, email: boolean, text: boolean) => void;
}) {
  const setChannels = useMutation(api.notificationPreferences.setChannels);
  const [email, setEmail] = useState(initialEmail);
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const hasChanges = email !== initialEmail || text !== initialText;

  async function savePreference() {
    setSaving(true);
    try {
      await setChannels({ orgId, type: row.type, email, imessage: text });
      onSaved(row.type, email, text);
      toast.success("Notification preference saved");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save notification preference",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={onOpenChange}
      title={row.label}
      footer={
        <>
          <PillButton
            variant="secondary"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </PillButton>
          <PillButton
            disabled={!hasChanges || saving}
            onClick={() => void savePreference()}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {saving ? "Saving…" : "Save changes"}
          </PillButton>
        </>
      }
    >
      <FormSection
        title="Delivery channels"
        description={
          usesDefaults
            ? "This event currently follows your default delivery settings."
            : "This event has custom delivery settings."
        }
        divided={false}
      >
        <OperationalPanel as="div" className="divide-y divide-foreground/6">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-base font-medium text-foreground">Email</p>
              <p className="text-base text-muted-foreground">
                Send this event to your account email.
              </p>
            </div>
            <SettingsSwitch
              checked={email}
              onCheckedChange={() => setEmail((current) => !current)}
              label={`${row.label} email`}
            />
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-base font-medium text-foreground">Text</p>
              <p className="text-base text-muted-foreground">
                Send this event to your profile phone number.
              </p>
            </div>
            <SettingsSwitch
              checked={text}
              onCheckedChange={() => setText((current) => !current)}
              label={`${row.label} text message`}
            />
          </div>
        </OperationalPanel>
      </FormSection>
    </SettingsDrawer>
  );
}

export function NotificationPreferencesSection({
  orgId,
  orgType,
}: NotificationPreferencesSectionProps) {
  const prefs = useCachedQuery(
    "notificationPreferences.getForUser",
    api.notificationPreferences.getForUser,
    { orgId },
  );
  const setAllEmail = useMutation(api.notificationPreferences.setAllEmail);
  const setAllChannel = useMutation(api.notificationPreferences.setAllChannel);
  const { setRightPanel } = useSettingsActions();
  const [localPrefs, setLocalPrefs] = useState<Record<string, boolean>>({});
  const [savingDefault, setSavingDefault] = useState<NotificationChannel | null>(
    null,
  );
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const visibleRows = getNotificationSettingsRows(orgType);
  const groups = Array.from(new Set(visibleRows.map((row) => row.group)));
  const storedPrefs = prefs ?? [];

  function explicitPreference(type: string, channel: NotificationChannel) {
    const local = localPrefs[prefKey(type, channel)];
    if (local !== undefined) return local;
    return storedPrefs.find(
      (pref) => pref.type === type && pref.channel === channel,
    )?.enabled;
  }

  // The `__all__` row is an explicit override. When it does not exist, the
  // backend falls back to severity-based defaults per event, so there is no
  // single on/off state to show here.
  function defaultOverride(channel: NotificationChannel) {
    return explicitPreference("__all__", channel);
  }

  function effectivePreference(
    type: NotificationSettingsRow["type"],
    channel: NotificationChannel,
  ) {
    const explicit = explicitPreference(type, channel);
    if (explicit !== undefined) return explicit;

    if (isProactiveNotificationType(type)) {
      const proactiveDefault = explicitPreference(
        PROACTIVE_PREFERENCE_TYPE,
        channel,
      );
      if (proactiveDefault !== undefined) return proactiveDefault;
    }

    const defaultOverride = explicitPreference("__all__", channel);
    if (defaultOverride !== undefined) return defaultOverride;

    return getEffectiveChannelDefault(
      channel,
      NOTIFICATION_SEVERITY[type],
    );
  }

  function setLocalPreference(
    type: string,
    channel: NotificationChannel,
    enabled: boolean,
  ) {
    setLocalPrefs((current) => ({
      ...current,
      [prefKey(type, channel)]: enabled,
    }));
  }

  const saveEventLocally = useCallback(
    (type: string, email: boolean, text: boolean) => {
      setLocalPrefs((current) => ({
        ...current,
        [prefKey(type, "email")]: email,
        [prefKey(type, "imessage")]: text,
      }));
    },
    [],
  );

  async function toggleDefault(channel: NotificationChannel) {
    const previous = defaultOverride(channel);
    const next = !(previous ?? false);
    setLocalPreference("__all__", channel, next);
    setSavingDefault(channel);
    try {
      if (channel === "email") {
        await setAllEmail({ orgId, enabled: next });
      } else {
        await setAllChannel({ orgId, channel, enabled: next });
      }
    } catch (error) {
      if (previous === undefined) {
        setLocalPrefs((current) => {
          const { [prefKey("__all__", channel)]: _removed, ...rest } = current;
          return rest;
        });
      } else {
        setLocalPreference("__all__", channel, previous);
      }
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update notification default",
      );
    } finally {
      setSavingDefault(null);
    }
  }

  const selectedRow = visibleRows.find((row) => row.type === selectedType);
  const selectedEmail = selectedRow
    ? effectivePreference(selectedRow.type, "email")
    : false;
  const selectedText = selectedRow
    ? effectivePreference(selectedRow.type, "imessage")
    : false;
  const selectedUsesDefaults = selectedRow
    ? explicitPreference(selectedRow.type, "email") === undefined &&
      explicitPreference(selectedRow.type, "imessage") === undefined
    : true;

  useEffect(() => {
    setRightPanel(
      selectedRow ? (
        <NotificationPreferenceDrawer
          key={selectedRow.type}
          orgId={orgId}
          row={selectedRow}
          initialEmail={selectedEmail}
          initialText={selectedText}
          usesDefaults={selectedUsesDefaults}
          onOpenChange={(open) => {
            if (!open) setSelectedType(null);
          }}
          onSaved={saveEventLocally}
        />
      ) : null,
    );
    return () => setRightPanel(null);
  }, [
    orgId,
    saveEventLocally,
    selectedEmail,
    selectedRow,
    selectedText,
    selectedUsesDefaults,
    setRightPanel,
  ]);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <DefaultNotificationRow
          icon={Mail}
          title="Default email delivery"
          description={
            defaultOverride("email") === undefined
              ? "Set a default for all events. Events currently follow Glass defaults by importance."
              : "Overrides the Glass default for events without a custom email setting."
          }
          checked={defaultOverride("email") ?? false}
          disabled={savingDefault !== null}
          onCheckedChange={() => void toggleDefault("email")}
          label="Default email delivery"
        />
        <DefaultNotificationRow
          icon={MessageSquareText}
          title="Default text delivery"
          description={
            defaultOverride("imessage") === undefined
              ? "Set a default for all events. Events currently follow Glass defaults by importance."
              : "Overrides the Glass default for events without a custom text setting."
          }
          checked={defaultOverride("imessage") ?? false}
          disabled={savingDefault !== null}
          onCheckedChange={() => void toggleDefault("imessage")}
          label="Default text delivery"
        />
      </div>

      {groups.map((group) => (
        <OperationalPanel key={group}>
          <OperationalPanelHeader title={group} className="px-5 py-3.5" />
          <div className="divide-y divide-foreground/6">
            {visibleRows
              .filter((row) => row.group === group)
              .map((row) => {
                const email = effectivePreference(row.type, "email");
                const text = effectivePreference(row.type, "imessage");
                const usesDefaults =
                  explicitPreference(row.type, "email") === undefined &&
                  explicitPreference(row.type, "imessage") === undefined;
                return (
                  <button
                    key={row.type}
                    type="button"
                    onClick={() => setSelectedType(row.type)}
                    className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-foreground/3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/10"
                  >
                    <span className="min-w-0 flex-1 text-base font-medium text-foreground">
                      {row.label}
                    </span>
                    <span className="shrink-0 text-base text-muted-foreground">
                      {usesDefaults ? "Default · " : ""}
                      {channelSummary(email, text)}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
                  </button>
                );
              })}
          </div>
        </OperationalPanel>
      ))}
    </div>
  );
}
