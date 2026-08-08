"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ClientEmailRoutingSection } from "@/components/settings/client-email-routing-section";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { FormSection } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
import { PillButton } from "@/components/ui/pill-button";
import {
  StatusTag,
  type StatusTagTone,
} from "@/components/ui/status-tag";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

type ChannelSettings = {
  emailEnabled: boolean;
  imessageEnabled: boolean;
  slackEnabled: boolean;
  slackSafeAlertsEnabled: boolean;
  slackVendorAlertsEnabled: boolean;
  slackPolicyDeliveryEnabled: boolean;
};

type ChannelDrawer = "email" | "imessage" | "slack";

function ChannelCard({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-foreground/6 bg-popover px-4 py-3">
      <div>
        <p className="text-base font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-label text-muted-foreground/60">
          {description}
        </p>
      </div>
      <div className="ml-4 flex shrink-0 items-center gap-2">
        <SettingsSwitch
          checked={checked}
          onCheckedChange={onChange}
          disabled={disabled}
          label={`${title} availability`}
        />
      </div>
    </div>
  );
}

function ChannelRow({
  title,
  description,
  status,
  statusTone,
  onClick,
}: {
  title: string;
  description: string;
  status: string;
  statusTone: StatusTagTone;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-4 rounded-lg border border-foreground/6 bg-popover px-4 py-3 text-left transition-colors hover:bg-foreground/2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/10"
    >
      <span className="min-w-0">
        <span className="block text-base font-medium text-foreground">
          {title}
        </span>
        <span className="mt-0.5 block text-label text-muted-foreground/60">
          {description}
        </span>
      </span>
      <span className="ml-4 flex shrink-0 items-center gap-2">
        <StatusTag tone={statusTone}>{status}</StatusTag>
        <ChevronRight className="size-4 text-muted-foreground/50" />
      </span>
    </button>
  );
}

function SlackConnectionFields({
  clientOrgId,
  workspaceName,
  currentChannelId,
  channelName,
  canEdit,
}: {
  clientOrgId: Id<"organizations">;
  workspaceName: string;
  currentChannelId?: string;
  channelName: string;
  canEdit: boolean;
}) {
  const listChannels = useAction(
    api.actions.slackOnboarding.listAvailableChannels,
  );
  const selectChannel = useAction(
    api.actions.slackOnboarding.selectPrimaryChannel,
  );
  const [channels, setChannels] = useState(
    currentChannelId ? [{ id: currentChannelId, name: channelName }] : [],
  );
  const [selectedChannelId, setSelectedChannelId] = useState(
    currentChannelId ?? "",
  );
  const [loading, setLoading] = useState(canEdit);
  const [loadError, setLoadError] = useState(false);
  const selectedChannel = channels.find(
    (channel) => channel.id === selectedChannelId,
  );
  const autoSave = useLocalFirstAutoSave({
    mutationName: `client.slackChannel.select.${clientOrgId}`,
    args: { clientOrgId, channelId: selectedChannelId },
    valueKey: selectedChannelId,
    resetKey: `${clientOrgId}:${currentChannelId ?? "unselected"}`,
    enabled: canEdit,
    canSave: Boolean(selectedChannelId && selectedChannel),
    delayMs: 0,
    flush: selectChannel,
    onFlushed: (result) => {
      if (!result) return;
      setChannels((current) =>
        current.some((channel) => channel.id === result.id)
          ? current
          : [...current, result],
      );
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Slack channel could not be changed"),
  });

  useEffect(() => {
    if (!canEdit) return;
    let cancelled = false;
    void listChannels({ clientOrgId })
      .then((result) => {
        if (cancelled) return;
        setChannels(
          !currentChannelId ||
            result.channels.some((channel) => channel.id === currentChannelId)
            ? result.channels
            : [{ id: currentChannelId, name: channelName }, ...result.channels],
        );
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canEdit, channelName, clientOrgId, currentChannelId, listChannels]);

  return (
    <div className="space-y-3">
      {canEdit && selectedChannelId ? (
        <AutoSaveStatus status={autoSave.status} />
      ) : null}
      <div className="space-y-1.5">
        <label
          htmlFor="slack-workspace-name"
          className="text-label text-muted-foreground"
        >
          Workspace
        </label>
        <Input
          id="slack-workspace-name"
          value={workspaceName}
          disabled
          readOnly
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-3">
          <label
            htmlFor="slack-channel-name"
            className="text-label text-muted-foreground"
          >
            Channel
          </label>
        </div>
        <Select
          value={selectedChannelId || null}
          onValueChange={(nextChannelId) => {
            if (typeof nextChannelId === "string") {
              setSelectedChannelId(nextChannelId);
            }
          }}
          disabled={!canEdit || loading || channels.length === 0}
        >
          <SelectTrigger id="slack-channel-name" className="w-full">
            <SelectValue>
              {selectedChannel ? `#${selectedChannel.name}` : "Select channel"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {channels.map((channel) => (
              <SelectItem key={channel.id} value={channel.id}>
                #{channel.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {loadError ? (
          <p className="text-label text-destructive">
            Slack channels could not be loaded.
          </p>
        ) : !loading && canEdit && channels.length === 0 ? (
          <p className="text-label text-muted-foreground">
            Add Glass to a Slack channel, then reopen this panel.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function AgentChannelsSection({
  clientOrgId,
  showEmailRouting = false,
  defaultClientSlug = "",
  defaultInviteEmail = "",
  setRightPanel: setRightPanelOverride,
}: {
  clientOrgId: Id<"organizations">;
  showEmailRouting?: boolean;
  defaultClientSlug?: string;
  defaultInviteEmail?: string;
  setRightPanel?: (node: ReactNode) => void;
}) {
  const { setRightPanel: setSettingsRightPanel } = useSettingsActions();
  const setRightPanel = setRightPanelOverride ?? setSettingsRightPanel;
  const currentOrg = useCurrentOrg();
  const viewer = useQuery(api.users.viewer);
  const isOperator = viewer?.accountKind === "operator";
  const customerResult = useQuery(
    api.agentChannels.get,
    viewer && !isOperator ? { clientOrgId } : "skip",
  );
  const operatorResult = useQuery(
    api.agentChannels.getForOperator,
    isOperator ? { clientOrgId } : "skip",
  );
  const result = isOperator ? operatorResult : customerResult;
  const canEdit =
    isOperator ||
    (currentOrg?.orgId === clientOrgId &&
      currentOrg.orgType === "client" &&
      currentOrg.role === "admin");
  const update = useMutation(api.agentChannels.update);
  const updateForOperator = useMutation(api.agentChannels.updateForOperator);
  const bindPrimaryChannel = useMutation(
    api.agentChannels.bindPrimaryChannelForOperator,
  );
  const beginOAuth = useAction(api.actions.slackOAuth.begin);
  const disconnect = useAction(api.actions.slackOAuth.disconnect);
  const provisionPrimary = useAction(
    api.actions.slackOnboarding.createPrimaryChannel,
  );
  const [activeDrawer, setActiveDrawer] = useState<ChannelDrawer | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState(defaultInviteEmail);
  const [clientSlug, setClientSlug] = useState(defaultClientSlug);
  const [manualSetupReason, setManualSetupReason] = useState<string | null>(
    null,
  );
  const [hostTeamId, setHostTeamId] = useState("");
  const [hostChannelId, setHostChannelId] = useState("");
  const [customerChannelId, setCustomerChannelId] = useState("");
  const [manualChannelName, setManualChannelName] = useState("");

  async function save(settings: ChannelSettings) {
    if (!canEdit) return;
    setBusy("settings");
    try {
      if (isOperator) {
        await updateForOperator({ clientOrgId, ...settings });
      } else {
        await update(settings);
      }
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Agent channels could not be saved"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function install() {
    setBusy("oauth");
    try {
      const { url } = await beginOAuth({
        clientOrgId,
        thirdPartyVisibilityAcknowledged: true,
      });
      if (!url) {
        toast.success(connection ? "Glass reinstalled" : "Slack connected");
        setBusy(null);
        return;
      }
      window.location.assign(url);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Slack setup could not start"),
      );
      setBusy(null);
    }
  }

  async function removeConnection() {
    setBusy("disconnect");
    try {
      await disconnect({ clientOrgId });
      setActiveDrawer(null);
      toast.success("Slack disconnected");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Slack could not be disconnected"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function createPrimary() {
    setBusy("provision");
    try {
      const response = await provisionPrimary({
        clientOrgId,
        clientSlug,
        inviteEmail,
      });
      if (!response.created) {
        setManualSetupReason(
          response.manualSetupRequired ? response.reason : null,
        );
        toast.error(
          response.manualSetupRequired
            ? `Slack requires manual channel setup: ${response.reason}`
            : response.reason,
        );
        return;
      }
      setManualSetupReason(null);
      toast.success(`#${response.channelName} created and invitation sent`);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "The Slack Connect channel could not be created",
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  async function saveManualPrimaryChannel() {
    setBusy("manual-channel");
    try {
      await bindPrimaryChannel({
        clientOrgId,
        hostTeamId,
        hostChannelId,
        customerChannelId: customerChannelId.trim() || undefined,
        channelName: manualChannelName.replace(/^#/, ""),
      });
      setManualSetupReason(null);
      toast.success("Primary Slack channel connected");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "The primary channel could not be connected",
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  const connection = result?.connection;
  const primaryChannel = result?.primaryChannel;
  const settings = result?.settings;
  const slackNeedsReinstall =
    !!connection && connection.grantedScopes.length === 0;
  const channelLinked = !!primaryChannel?.customerChannelId;
  const slackReady = !!connection && channelLinked && !slackNeedsReinstall;
  const isMockSlack = result?.slackMode === "mock";

  useEffect(() => {
    if (!result || !settings) {
      setRightPanel(null);
      return;
    }

    const slackFooter = !canEdit ? null : !primaryChannel && isOperator ? (
      <PillButton
        onClick={() => void createPrimary()}
        disabled={busy !== null || !clientSlug.trim() || !inviteEmail.trim()}
      >
        {busy === "provision" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : null}
        Create and invite
      </PillButton>
    ) : primaryChannel && !connection && (!isOperator || isMockSlack) ? (
      <PillButton onClick={() => void install()} disabled={busy !== null}>
        {busy === "oauth" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : null}
        Connect Slack
      </PillButton>
    ) : connection ? (
      <>
        <PillButton
          variant="secondary"
          onClick={() => void install()}
          disabled={busy !== null}
        >
          {busy === "oauth" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          Reinstall Glass
        </PillButton>
        <PillButton
          variant="destructive"
          onClick={() => void removeConnection()}
          disabled={busy !== null}
        >
          {busy === "disconnect" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          Disconnect
        </PillButton>
      </>
    ) : null;

    setRightPanel(
      <SettingsDrawer
        open={activeDrawer !== null}
        onOpenChange={(open) => {
          if (!open) setActiveDrawer(null);
        }}
        title={
          activeDrawer === "email"
            ? "Email"
            : activeDrawer === "imessage"
              ? "iMessage"
              : "Slack"
        }
        footer={activeDrawer === "slack" ? slackFooter : null}
      >
        {activeDrawer === "email" ? (
          <div className="space-y-4">
            <ChannelCard
              title="Available by email"
              description="Let members email the client’s Glass agent."
              checked={settings.emailEnabled}
              disabled={!canEdit || busy === "settings"}
              onChange={() =>
                void save({
                  ...settings,
                  emailEnabled: !settings.emailEnabled,
                })
              }
            />
            {showEmailRouting ? (
              <ClientEmailRoutingSection clientOrgId={clientOrgId} />
            ) : null}
          </div>
        ) : activeDrawer === "imessage" ? (
          <ChannelCard
            title="Available by iMessage"
            description="Let linked members message the Glass phone number."
            checked={settings.imessageEnabled}
            disabled={!canEdit || busy === "settings"}
            onChange={() =>
              void save({
                ...settings,
                imessageEnabled: !settings.imessageEnabled,
              })
            }
          />
        ) : !primaryChannel ? (
          isOperator ? (
            <div className="space-y-3">
              <p className="text-base text-muted-foreground">
                Enter the channel name and the client admin to invite.
              </p>
              <Input
                value={clientSlug}
                onChange={(event) => setClientSlug(event.target.value)}
                placeholder="Channel name"
                aria-label="Slack channel name"
              />
              <Input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="Client admin email"
                aria-label="Client admin email"
              />
              {manualSetupReason ? (
                <FormSection
                  title="Link a channel manually"
                  description={manualSetupReason}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      value={hostTeamId}
                      onChange={(event) => setHostTeamId(event.target.value)}
                      placeholder="Clarity team ID"
                    />
                    <Input
                      value={hostChannelId}
                      onChange={(event) => setHostChannelId(event.target.value)}
                      placeholder="Clarity channel ID"
                    />
                    <Input
                      value={customerChannelId}
                      onChange={(event) =>
                        setCustomerChannelId(event.target.value)
                      }
                      placeholder="Customer channel ID (optional)"
                    />
                    <Input
                      value={manualChannelName}
                      onChange={(event) =>
                        setManualChannelName(event.target.value)
                      }
                      placeholder="Channel name"
                    />
                  </div>
                  <PillButton
                    variant="secondary"
                    onClick={() => void saveManualPrimaryChannel()}
                    disabled={
                      busy !== null ||
                      !connection ||
                      !hostTeamId.trim() ||
                      !hostChannelId.trim() ||
                      !manualChannelName.trim()
                    }
                  >
                    {busy === "manual-channel" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    Link channel
                  </PillButton>
                </FormSection>
              ) : null}
            </div>
          ) : (
            <p className="text-base text-muted-foreground">
              Waiting for Clarity Labs to invite this workspace.
            </p>
          )
        ) : !connection ? (
          <p className="text-base text-muted-foreground">
            Install Glass in the client workspace for #
            {primaryChannel.channelName}.
          </p>
        ) : slackNeedsReinstall ? (
          <p className="text-base text-muted-foreground">
            {connection.teamName} is missing required Slack permissions.
          </p>
        ) : !channelLinked ? (
          canEdit ? (
            <SlackConnectionFields
              key={`${primaryChannel._id}:unselected`}
              clientOrgId={clientOrgId}
              workspaceName={connection.teamName}
              channelName={primaryChannel.channelName}
              canEdit
            />
          ) : (
            <p className="text-base text-muted-foreground">
              Waiting for an admin to select a Slack channel.
            </p>
          )
        ) : (
          <div className="space-y-4">
            <SlackConnectionFields
              key={`${primaryChannel._id}:${primaryChannel.customerChannelId ?? primaryChannel.hostChannelId}`}
              clientOrgId={clientOrgId}
              workspaceName={connection.teamName}
              currentChannelId={primaryChannel.customerChannelId}
              channelName={primaryChannel.channelName}
              canEdit={canEdit}
            />
            <div className="space-y-3">
              <ChannelCard
                title="Available in Slack"
                description="Let members use Glass in this channel."
                checked={settings.slackEnabled}
                disabled={!canEdit || busy === "settings"}
                onChange={() =>
                  void save({
                    ...settings,
                    slackEnabled: !settings.slackEnabled,
                  })
                }
              />
              <ChannelCard
                title="Compliance and policy-change alerts"
                description="Post client compliance and policy-change updates."
                checked={settings.slackSafeAlertsEnabled}
                disabled={
                  !canEdit || busy === "settings" || !settings.slackEnabled
                }
                onChange={() =>
                  void save({
                    ...settings,
                    slackSafeAlertsEnabled: !settings.slackSafeAlertsEnabled,
                  })
                }
              />
              <ChannelCard
                title="Vendor alerts"
                description="Post vendor compliance updates."
                checked={settings.slackVendorAlertsEnabled}
                disabled={
                  !canEdit || busy === "settings" || !settings.slackEnabled
                }
                onChange={() =>
                  void save({
                    ...settings,
                    slackVendorAlertsEnabled:
                      !settings.slackVendorAlertsEnabled,
                  })
                }
              />
              <ChannelCard
                title="Policy and endorsement delivery"
                description="Deliver client-owned documents in their Slack threads."
                checked={settings.slackPolicyDeliveryEnabled}
                disabled={
                  !canEdit || busy === "settings" || !settings.slackEnabled
                }
                onChange={() =>
                  void save({
                    ...settings,
                    slackPolicyDeliveryEnabled:
                      !settings.slackPolicyDeliveryEnabled,
                  })
                }
              />
            </div>
          </div>
        )}
      </SettingsDrawer>,
    );

    return () => setRightPanel(null);
    // The drawer must be rebuilt when its setup state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeDrawer,
    busy,
    canEdit,
    clientSlug,
    clientOrgId,
    connection,
    customerChannelId,
    hostChannelId,
    hostTeamId,
    inviteEmail,
    isOperator,
    manualChannelName,
    manualSetupReason,
    primaryChannel,
    result,
    setRightPanel,
    settings,
    showEmailRouting,
    slackNeedsReinstall,
    slackReady,
  ]);

  if (!result) {
    return (
      <div className="h-40 animate-pulse rounded-lg bg-foreground/[0.03]" />
    );
  }

  const resolvedSettings = result.settings;
  const slackDescription = slackReady
    ? `${connection.teamName} · #${primaryChannel.channelName}`
    : slackNeedsReinstall
      ? `${connection.teamName} needs updated Slack permissions.`
      : connection && primaryChannel
        ? canEdit
          ? `${connection.teamName} · Select a channel.`
          : `${connection.teamName} · Waiting for channel selection.`
        : primaryChannel
          ? isOperator && !isMockSlack
            ? `Waiting for the client admin to connect #${primaryChannel.channelName}.`
            : `Ready to connect #${primaryChannel.channelName}.`
          : isOperator
            ? "Create the client’s private Slack channel."
            : "Waiting for Glass to create your private Slack channel.";
  const slackStatus = slackReady
    ? resolvedSettings.slackEnabled
      ? "On"
      : "Off"
    : slackNeedsReinstall
      ? "Needs attention"
      : !primaryChannel
        ? "Not set up"
        : "Pending";
  const slackStatusTone: StatusTagTone = slackReady
    ? resolvedSettings.slackEnabled
      ? "success"
      : "neutral"
    : slackNeedsReinstall
      ? "danger"
      : "warning";

  return (
    <div className="w-full space-y-4">
      <section className="space-y-3" aria-label="Agent channels">
        <ChannelRow
          title="Email"
          description="Let members email the client’s Glass agent."
          status={resolvedSettings.emailEnabled ? "On" : "Off"}
          statusTone={resolvedSettings.emailEnabled ? "success" : "neutral"}
          onClick={() => setActiveDrawer("email")}
        />
        <ChannelRow
          title="iMessage"
          description="Let linked members message the Glass phone number."
          status={resolvedSettings.imessageEnabled ? "On" : "Off"}
          statusTone={
            resolvedSettings.imessageEnabled ? "success" : "neutral"
          }
          onClick={() => setActiveDrawer("imessage")}
        />
        <ChannelRow
          title="Slack"
          description={slackDescription}
          status={slackStatus}
          statusTone={slackStatusTone}
          onClick={() => setActiveDrawer("slack")}
        />
      </section>
    </div>
  );
}
