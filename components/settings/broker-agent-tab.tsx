"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Loader2 } from "lucide-react";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import {
  patchCachedViewerOrg,
  useCachedViewerOrg,
} from "@/lib/sync/glass-cached-queries";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";

type AgentSettingsArgs = {
  chatEmailNotifications: boolean;
  autoSendEmails: boolean;
  bccRequesterOnAgentEmails: boolean;
  emailSendDelay: number;
};

function AgentSwitchRow({
  title,
  description,
  checked,
  onCheckedChange,
  label,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: () => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="text-base font-medium text-foreground">{title}</p>
        <p className="mt-0.5 max-w-md text-label text-muted-foreground/60">
          {description}
        </p>
      </div>
      <SettingsSwitch
        checked={checked}
        onCheckedChange={onCheckedChange}
        label={label}
        className="ml-4"
      />
    </div>
  );
}

export function BrokerAgentTab() {
  const viewerOrg = useCachedViewerOrg();
  const updateOrg = useMutation(api.orgs.updateOrg);

  const org = viewerOrg?.org as
    | {
        chatEmailNotifications?: boolean;
        autoSendEmails?: boolean;
        bccRequesterOnAgentEmails?: boolean;
        emailSendDelay?: number;
      }
    | undefined;

  const [chatEmailNotifications, setChatEmailNotifications] = useState(false);
  const [autoSendEmails, setAutoSendEmails] = useState(false);
  const [bccRequesterOnAgentEmails, setBccRequesterOnAgentEmails] =
    useState(true);
  const [emailSendDelay, setEmailSendDelay] = useState<number>(5);
  const [settingsHydrated, setSettingsHydrated] = useState(false);

  const hydratedRef = useRef(false);

  useEffect(() => {
    if (org && !hydratedRef.current) {
      setChatEmailNotifications(org.chatEmailNotifications ?? false);
      setAutoSendEmails(org.autoSendEmails ?? false);
      setBccRequesterOnAgentEmails(org.bccRequesterOnAgentEmails ?? true);
      setEmailSendDelay(org.emailSendDelay ?? 5);
      hydratedRef.current = true;
      setSettingsHydrated(true);
    }
  }, [org]);

  const settingsValueKey = useMemo(
    () =>
      JSON.stringify({
        chatEmailNotifications,
        autoSendEmails,
        bccRequesterOnAgentEmails,
        emailSendDelay,
      }),
    [
      autoSendEmails,
      bccRequesterOnAgentEmails,
      chatEmailNotifications,
      emailSendDelay,
    ],
  );

  const saveAgentSettings = useCallback(
    async (args: AgentSettingsArgs) => {
      await updateOrg(args);
    },
    [updateOrg],
  );

  const settingsAutoSave = useLocalFirstAutoSave({
    mutationName: "settings.agent.updateOrg",
    args: {
      chatEmailNotifications,
      autoSendEmails,
      bccRequesterOnAgentEmails,
      emailSendDelay,
    },
    valueKey: settingsValueKey,
    enabled: settingsHydrated,
    applyLocal: (store, args) => patchCachedViewerOrg(store, args),
    flush: saveAgentSettings,
    errorMessage: "Agent settings could not be saved.",
  });

  if (viewerOrg === undefined) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const delayOptions = [0, 3, 5, 10, 15];
  return (
    <div className="space-y-4">
      <AutoSaveStatus status={settingsAutoSave.status} />

      <OperationalPanel>
        <OperationalPanelHeader title="Email behavior" />
        <OperationalPanelBody className="divide-y divide-foreground/6 px-5 py-2">
          <AgentSwitchRow
            title="Email notifications for chat responses"
            description="Send the requesting team member an email copy when the agent replies in chat."
            checked={chatEmailNotifications}
            onCheckedChange={() => setChatEmailNotifications((v) => !v)}
            label="Toggle email notifications for chat responses"
          />
          <AgentSwitchRow
            title="Auto-send emails"
            description="When off, drafted emails require confirmation before sending."
            checked={autoSendEmails}
            onCheckedChange={() => setAutoSendEmails((v) => !v)}
            label="Toggle auto-send emails"
          />
          <AgentSwitchRow
            title="BCC requester"
            description="Blind copy the team member who asked the agent to send an email."
            checked={bccRequesterOnAgentEmails}
            onCheckedChange={() => setBccRequesterOnAgentEmails((v) => !v)}
            label="Toggle BCC requester"
          />
        </OperationalPanelBody>
      </OperationalPanel>

      <OperationalPanel>
        <OperationalPanelHeader title="Send delay" />
        <OperationalPanelBody className="px-5 py-5">
          <div>
            <label className="text-label font-medium text-muted-foreground block mb-1.5">
              Email send delay (seconds)
            </label>
            <div className="flex flex-wrap gap-2">
              {delayOptions.map((value) => {
                const selected = emailSendDelay === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setEmailSendDelay(value)}
                    className={`rounded-lg border px-3 py-1.5 text-base transition-colors ${
                      selected
                        ? "border-foreground/20 bg-foreground/3 text-foreground"
                        : "border-foreground/8 bg-popover text-muted-foreground hover:border-foreground/15"
                    }`}
                  >
                    {value === 0 ? "Off" : `${value}s`}
                  </button>
                );
              })}
            </div>
            <p className="text-label text-muted-foreground/60 mt-2">
              Undo window before outgoing emails are sent.
            </p>
          </div>
        </OperationalPanelBody>
      </OperationalPanel>
    </div>
  );
}
