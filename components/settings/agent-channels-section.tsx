"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  missingSlackCustomerScopes,
  SLACK_INSTALL_INVITE_EXPIRATION_DAYS,
} from "@/convex/lib/slackOAuthPolicy";
import { resolveSlackAutomaticChannel } from "@/convex/lib/slackChannelRouting";
import { ClientEmailRoutingSection } from "@/components/settings/client-email-routing-section";
import { SlackConnectionFields } from "@/components/settings/slack-connection-fields";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { FormSection } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
import { PillButton } from "@/components/ui/pill-button";
import {
  StatusTag,
  type StatusTagTone,
} from "@/components/ui/status-tag";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { openOAuthTab } from "@/lib/oauth-tab";
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
  const sendSlackInstallInvite = useAction(
    api.actions.slackOAuth.sendInstallInvite,
  );
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
    const oauthTab = isMockSlack ? null : openOAuthTab();
    if (!isMockSlack && !oauthTab) {
      toast.error("Allow pop-ups for Glass to connect Slack in a new tab");
      return;
    }

    setBusy("oauth");
    try {
      const { url } = await beginOAuth({
        clientOrgId,
        thirdPartyVisibilityAcknowledged: true,
      });
      if (!url) {
        toast.success(connection ? "Glass reinstalled" : "Slack connected");
        return;
      }
      if (!oauthTab?.navigate(url)) {
        throw new Error("The Slack setup tab was closed. Try again.");
      }
    } catch (error) {
      oauthTab?.close();
      toast.error(
        getUserFacingErrorMessage(error, "Slack setup could not start"),
      );
    } finally {
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

  async function sendInstallInvite() {
    setBusy("install-invite");
    try {
      const result = await sendSlackInstallInvite({
        clientOrgId,
        recipientEmail: inviteEmail,
      });
      toast.success(`Slack install invite sent to ${result.recipientEmail}`);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "The Slack install invite could not be sent",
        ),
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
      toast.success("Shared support channel connected");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "The shared support channel could not be connected",
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  const connection = result?.connection;
  const supportChannel = result?.supportChannel ?? result?.primaryChannel;
  const joinedChannels = result?.joinedChannels ?? [];
  const settings = result?.settings;
  const slackNeedsReinstall =
    !!connection &&
    missingSlackCustomerScopes(connection.grantedScopes).length > 0;
  const slackReady = !!connection && !slackNeedsReinstall;
  const isMockSlack = result?.slackMode === "mock";
  const canSendSlackInstallInvite = Boolean(
    !connection && isOperator && !isMockSlack,
  );
  const automaticChannel = connection
    ? resolveSlackAutomaticChannel(connection, supportChannel)
    : undefined;
  const automaticChannelId = automaticChannel?.channelId;

  const slackFooter = !canEdit ? null : connection ? (
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

  const channelContent =
    result && settings ? (
      activeDrawer === "email" ? (
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
      ) : (
        <div className="space-y-6">
          <FormSection
            title="Glass app installation"
            description="Install Glass once in the client workspace. Members can message it privately or add it to any channels where the team wants to use it."
            divided={false}
          >
            {connection ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-foreground/6 bg-popover px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-base text-foreground">
                    {connection.teamName}
                  </p>
                  <p className="text-label text-muted-foreground">
                    Slack workspace
                  </p>
                </div>
                <StatusTag tone={slackNeedsReinstall ? "danger" : "success"}>
                  {slackNeedsReinstall ? "Update required" : "Installed"}
                </StatusTag>
              </div>
            ) : canSendSlackInstallInvite ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="slack-install-invite-email"
                    className="text-label text-muted-foreground"
                  >
                    Client Slack admin email
                  </label>
                  <Input
                    id="slack-install-invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="admin@client.com"
                    autoComplete="email"
                  />
                  <p className="text-label text-muted-foreground">
                    The one-time install link expires in{" "}
                    {SLACK_INSTALL_INVITE_EXPIRATION_DAYS} days.
                  </p>
                </div>
                <PillButton
                  onClick={() => void sendInstallInvite()}
                  disabled={busy !== null || !inviteEmail.trim()}
                >
                  {busy === "install-invite" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  Send install invite
                </PillButton>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-base text-muted-foreground">
                  Install Glass in this Slack workspace. The shared support
                  channel is set up separately by Clarity Labs.
                </p>
                {canEdit ? (
                  <PillButton
                    onClick={() => void install()}
                    disabled={busy !== null}
                  >
                    {busy === "oauth" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    Connect Slack
                  </PillButton>
                ) : null}
              </div>
            )}
          </FormSection>

          <FormSection
            title="Shared support channel"
            description="Clarity Labs creates and invites this Slack Connect channel for human support."
            divided={false}
          >
            {supportChannel ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-foreground/6 bg-popover px-3 py-2.5">
                <p className="min-w-0 truncate text-base text-foreground">
                  #{supportChannel.channelName}
                </p>
                <StatusTag
                  tone={
                    supportChannel.customerChannelId ? "success" : "warning"
                  }
                >
                  {supportChannel.customerChannelId
                    ? "Connected"
                    : "Invitation pending"}
                </StatusTag>
              </div>
            ) : isOperator ? (
              <div className="space-y-3">
                <Input
                  value={clientSlug}
                  onChange={(event) => setClientSlug(event.target.value)}
                  placeholder="Support channel name"
                  aria-label="Slack support channel name"
                />
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="Client admin email"
                  aria-label="Client admin email"
                />
                <PillButton
                  onClick={() => void createPrimary()}
                  disabled={
                    busy !== null || !clientSlug.trim() || !inviteEmail.trim()
                  }
                >
                  {busy === "provision" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  Create support channel
                </PillButton>
              </div>
            ) : (
              <p className="text-base text-muted-foreground">
                Waiting for Clarity Labs to send the shared-channel invitation.
              </p>
            )}
            {manualSetupReason && isOperator ? (
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
                    placeholder="Customer mirror ID (optional)"
                  />
                  <Input
                    value={manualChannelName}
                    onChange={(event) =>
                      setManualChannelName(event.target.value)
                    }
                    placeholder="Support channel name"
                  />
                </div>
                <PillButton
                  variant="secondary"
                  onClick={() => void saveManualPrimaryChannel()}
                  disabled={
                    busy !== null ||
                    !hostTeamId.trim() ||
                    !hostChannelId.trim() ||
                    !manualChannelName.trim()
                  }
                >
                  {busy === "manual-channel" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  Link support channel
                </PillButton>
              </FormSection>
            ) : null}
          </FormSection>

          {connection && !slackNeedsReinstall ? (
            <SlackConnectionFields
              key={`${connection._id}:${automaticChannelId ?? "unselected"}`}
              clientOrgId={clientOrgId}
              currentChannelId={automaticChannelId}
              knownChannels={joinedChannels}
              canEdit={canEdit}
            />
          ) : slackNeedsReinstall ? (
            <p className="text-base text-muted-foreground">
              Reinstall Glass to grant the permissions needed for App Home
              messages and public-channel management.
            </p>
          ) : null}

          {connection && !slackNeedsReinstall ? (
            <FormSection
              title="Automations"
              description="Choose what Glass can post to the default channel."
              divided={false}
            >
              <div className="space-y-3">
                <ChannelCard
                  title="Available in Slack"
                  description="Let members use Glass privately and in every channel where it has been added."
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
                    !canEdit ||
                    busy === "settings" ||
                    !settings.slackEnabled ||
                    !automaticChannelId
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
                    !canEdit ||
                    busy === "settings" ||
                    !settings.slackEnabled ||
                    !automaticChannelId
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
                    !canEdit ||
                    busy === "settings" ||
                    !settings.slackEnabled ||
                    !automaticChannelId
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
            </FormSection>
          ) : null}
        </div>
      )
    ) : null;

  useEffect(() => {
    if (!result || !settings) {
      setRightPanel(null);
      return;
    }

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
        {channelContent}
      </SettingsDrawer>,
    );

    return () => setRightPanel(null);
    // Keep the drawer synchronized with async setup and form state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeDrawer,
    automaticChannelId,
    busy,
    canEdit,
    canSendSlackInstallInvite,
    clientOrgId,
    clientSlug,
    connection,
    customerChannelId,
    hostChannelId,
    hostTeamId,
    inviteEmail,
    isOperator,
    joinedChannels,
    manualChannelName,
    manualSetupReason,
    result,
    setRightPanel,
    settings,
    showEmailRouting,
    slackNeedsReinstall,
    supportChannel,
  ]);

  if (!result) {
    return (
      <div className="h-40 animate-pulse rounded-lg bg-foreground/[0.03]" />
    );
  }

  const resolvedSettings = result.settings;
  const slackDescription = slackReady
    ? `${connection.teamName} · ${joinedChannels.length} joined ${joinedChannels.length === 1 ? "channel" : "channels"}`
    : slackNeedsReinstall
      ? `${connection.teamName} needs updated Slack permissions.`
      : supportChannel
        ? "Support channel ready · Glass app not installed"
        : isOperator
          ? "Set up the app and support channel independently."
          : "Waiting for Slack setup.";
  const slackStatus = slackReady
    ? resolvedSettings.slackEnabled
      ? "On"
      : "Off"
    : slackNeedsReinstall
      ? "Needs attention"
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
