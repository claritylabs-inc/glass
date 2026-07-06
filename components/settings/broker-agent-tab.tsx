"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { HandleAvailability } from "@/components/settings/handle-availability";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { getPublicAgentDomain } from "@/lib/domains";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import {
  patchCachedViewerOrg,
  useCachedViewerOrg,
} from "@/lib/sync/glass-cached-queries";
import { useSyncStore } from "@claritylabs/cl-sync";

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
  const store = useSyncStore();
  const updateOrg = useMutation(api.orgs.updateOrg);
  const claimAgentHandle = useMutation(api.orgs.claimAgentHandle);

  const org = viewerOrg?.org as
    | {
        _id?: string;
        type?: "broker" | "client";
        agentHandle?: string;
        chatEmailNotifications?: boolean;
        autoSendEmails?: boolean;
        bccRequesterOnAgentEmails?: boolean;
        emailSendDelay?: number;
      }
    | undefined;

  const agentDomain = getPublicAgentDomain();

  const [agentHandle, setAgentHandle] = useState("");
  const [debouncedHandle, setDebouncedHandle] = useState("");
  const [savingHandle, setSavingHandle] = useState(false);
  const [chatEmailNotifications, setChatEmailNotifications] = useState(false);
  const [autoSendEmails, setAutoSendEmails] = useState(false);
  const [bccRequesterOnAgentEmails, setBccRequesterOnAgentEmails] =
    useState(true);
  const [emailSendDelay, setEmailSendDelay] = useState<number>(5);
  const [settingsHydrated, setSettingsHydrated] = useState(false);

  const hydratedRef = useRef(false);

  const { setActions } = useSettingsActions();

  useEffect(() => {
    if (org && !hydratedRef.current) {
      setAgentHandle(org.agentHandle ?? "");
      setDebouncedHandle(org.agentHandle ?? "");
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

  const { saving, savedAt } = useLocalFirstAutoSave({
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
    onError: () => toast.error("Failed to save agent settings"),
  });

  useEffect(() => {
    setActions(
      <span className="text-label text-muted-foreground flex items-center gap-1.5">
        {saving ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" />
            Saving
          </>
        ) : savedAt ? (
          "Saved"
        ) : null}
      </span>,
    );
    return () => setActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, savedAt]);

  const currentHandle = (org?.agentHandle ?? "").trim();
  const normalizedInput = agentHandle.toLowerCase().replace(/[^a-z0-9-]/g, "");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedHandle(normalizedInput), 300);
    return () => clearTimeout(t);
  }, [normalizedInput]);

  const shouldCheck = !!debouncedHandle && debouncedHandle !== currentHandle;
  const availability = useQuery(
    api.orgs.checkHandleAvailability,
    shouldCheck && org?._id
      ? {
          handle: debouncedHandle,
          excludeOrgId: org._id as Id<"organizations">,
        }
      : "skip",
  );
  const handleChecking =
    !!normalizedInput &&
    normalizedInput !== currentHandle &&
    normalizedInput.length >= 3 &&
    (normalizedInput !== debouncedHandle || availability === undefined);

  // Auto-save handle when debounced value is valid, available, and differs from current.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (!shouldCheck) return;
    if (normalizedInput !== debouncedHandle) return;
    if (availability === undefined) return;
    if (!availability.available) return;
    let cancelled = false;
    (async () => {
      setSavingHandle(true);
      try {
        const normalized = await claimAgentHandle({
          handle: availability.normalized,
        });
        if (!cancelled) {
          setAgentHandle(normalized);
          setDebouncedHandle(normalized);
          patchCachedViewerOrg(store, { agentHandle: normalized });
          toast.success("Agent handle saved");
        }
      } catch (err) {
        if (!cancelled)
          toast.error(
            err instanceof Error ? err.message : "Failed to update handle",
          );
      } finally {
        if (!cancelled) setSavingHandle(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    shouldCheck,
    normalizedInput,
    debouncedHandle,
    availability,
    claimAgentHandle,
    store,
  ]);

  if (viewerOrg === undefined) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const delayOptions = [0, 3, 5, 10, 15];
  const isBroker = org?.type === "broker";
  const displayedAgentHandle = isBroker ? agentHandle : "agent";

  return (
    <div className="space-y-4">
      {isBroker ? (
        <OperationalPanel>
          <OperationalPanelHeader title="Agent email handle" />
          <OperationalPanelBody className="space-y-1 px-5 py-5">
            <p className="text-base text-muted-foreground/70 mb-3">
              Clients and carriers email your agent at this address. Forwarding
              a policy or asking a question routes to the Glass agent for this
              org.
            </p>
            <div className="flex items-stretch gap-0">
              <input
                type="text"
                value={agentHandle}
                onChange={(e) =>
                  setAgentHandle(
                    e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                  )
                }
                placeholder="your-broker-name"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className="flex-1 min-w-0 rounded-l-lg border border-foreground/8 bg-popover px-3 py-2 text-base placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
              />
              <span className="inline-flex items-center rounded-r-lg border border-l-0 border-foreground/8 bg-foreground/3 px-3 text-base text-muted-foreground select-none whitespace-nowrap">
                @{agentDomain}
              </span>
            </div>
            <HandleAvailability
              saving={savingHandle}
              checking={handleChecking}
              input={normalizedInput}
              current={currentHandle}
              availability={
                normalizedInput === debouncedHandle ? availability : undefined
              }
              currentLabel="Current agent handle"
              renderAvailablePreview={(s) => `${s}@${agentDomain} is available`}
            />
          </OperationalPanelBody>
        </OperationalPanel>
      ) : (
        <OperationalPanel>
          <OperationalPanelHeader title="Agent email address" />
          <OperationalPanelBody className="space-y-1 px-5 py-5">
            <p className="text-base text-muted-foreground/70 mb-3">
              Email sent to this address routes to your Glass agent for this
              org.
            </p>
            <div
              aria-disabled="true"
              className="rounded-lg border border-foreground/8 bg-muted/40 px-3 py-2 text-base text-muted-foreground cursor-not-allowed select-none"
            >
              {displayedAgentHandle}@{agentDomain}
            </div>
          </OperationalPanelBody>
        </OperationalPanel>
      )}

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
