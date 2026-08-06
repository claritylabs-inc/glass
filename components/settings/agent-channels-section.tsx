"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  CheckCircle2,
  Loader2,
  MessageSquare,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ClientEmailRoutingSection } from "@/components/settings/client-email-routing-section";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { Badge } from "@/components/ui/badge";
import { FormSection } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

type ChannelSettings = {
  emailEnabled: boolean;
  imessageEnabled: boolean;
  slackEnabled: boolean;
  slackSafeAlertsEnabled: boolean;
  slackVendorAlertsEnabled: boolean;
  slackPolicyDeliveryEnabled: boolean;
};

function ChannelRow({
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
    <OperationalItem className="flex items-center justify-between gap-5">
      <div>
        <p className="text-base font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-base text-muted-foreground">{description}</p>
      </div>
      <SettingsSwitch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        label={`${title} availability`}
      />
    </OperationalItem>
  );
}

export function AgentChannelsSection({
  clientOrgId,
  showEmailRouting = false,
  defaultClientSlug = "",
  defaultInviteEmail = "",
}: {
  clientOrgId: Id<"organizations">;
  showEmailRouting?: boolean;
  defaultClientSlug?: string;
  defaultInviteEmail?: string;
}) {
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
  const [acknowledged, setAcknowledged] = useState(false);
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
    if (!acknowledged) {
      toast.error("Acknowledge channel visibility before installing Glass");
      return;
    }
    setBusy("oauth");
    try {
      const { url } = await beginOAuth({
        clientOrgId,
        thirdPartyVisibilityAcknowledged: true,
      });
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

  if (!result) {
    return (
      <div className="h-40 animate-pulse rounded-lg bg-foreground/[0.03]" />
    );
  }
  const { settings, connection, primaryChannel } = result;
  const disabled = !canEdit || busy === "settings";
  const slackNeedsReinstall =
    !!connection && connection.grantedScopes.length === 0;
  const slackReady =
    !!connection && !!primaryChannel?.customerChannelId && !slackNeedsReinstall;
  const slackStatus = !primaryChannel
    ? "Channel not created"
    : !connection
      ? "Waiting for client"
      : slackNeedsReinstall
        ? "Reinstall required"
        : !primaryChannel.customerChannelId
          ? "Finish in Slack"
          : settings.slackEnabled
            ? "Ready"
            : "Connected, off";
  const serviceChannelSetup =
    isOperator && !primaryChannel ? (
      <OperationalPanel>
        <OperationalPanelHeader
          title="Service channel invitation"
          description="Create a private Slack Connect channel for this client and invite their admin."
        />
        <OperationalPanelBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              value={clientSlug}
              onChange={(event) => setClientSlug(event.target.value)}
              placeholder="client-slug"
              aria-label="Slack channel slug"
            />
            <Input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="client-admin@example.com"
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
              Create and invite
            </PillButton>
          </div>
          {manualSetupReason ? (
            <FormSection
              title="Manual channel link"
              description={`Slack could not automate the invitation (${manualSetupReason}). Create the channel and invitation in the Clarity workspace, then enter its IDs.`}
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
                  onChange={(event) => setCustomerChannelId(event.target.value)}
                  placeholder="Customer channel ID (optional)"
                />
                <Input
                  value={manualChannelName}
                  onChange={(event) => setManualChannelName(event.target.value)}
                  placeholder="glass-client-slug"
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
        </OperationalPanelBody>
      </OperationalPanel>
    ) : null;

  return (
    <div className="space-y-5">
      <OperationalPanel>
        <OperationalPanelHeader
          title="Channel access"
          description="Control where client members can reach Glass."
        />
        <ChannelRow
          title="Email"
          description="Let members email the client’s Glass agent."
          checked={settings.emailEnabled}
          disabled={disabled}
          onChange={() =>
            void save({ ...settings, emailEnabled: !settings.emailEnabled })
          }
        />
        <ChannelRow
          title="iMessage"
          description="Let linked members message the Glass phone number."
          checked={settings.imessageEnabled}
          disabled={disabled}
          onChange={() =>
            void save({
              ...settings,
              imessageEnabled: !settings.imessageEnabled,
            })
          }
        />
        <ChannelRow
          title="Slack"
          description={
            connection
              ? "Use Glass in the connected client workspace."
              : "Connect the client workspace before turning this on."
          }
          checked={settings.slackEnabled}
          disabled={disabled || !connection}
          onChange={() =>
            void save({ ...settings, slackEnabled: !settings.slackEnabled })
          }
        />
      </OperationalPanel>

      {serviceChannelSetup}

      <OperationalPanel>
        <OperationalPanelHeader
          title="Client Slack workspace"
          description="Connect the client’s workspace to its private service channel."
          action={
            <Badge variant={slackReady ? "outline" : "secondary"}>
              {slackStatus}
            </Badge>
          }
        />
        <OperationalPanelBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-label text-muted-foreground">
                Service channel
              </p>
              <p className="mt-1 text-base text-foreground">
                {primaryChannel
                  ? `#${primaryChannel.channelName}`
                  : "Not created"}
              </p>
            </div>
            <div>
              <p className="text-label text-muted-foreground">
                Client workspace
              </p>
              <p className="mt-1 text-base text-foreground">
                {connection?.teamName ?? "Not connected"}
              </p>
            </div>
            <div>
              <p className="text-label text-muted-foreground">Glass access</p>
              <p className="mt-1 text-base text-foreground">
                {connection
                  ? slackNeedsReinstall
                    ? "Reinstall required"
                    : settings.slackEnabled
                      ? "On"
                      : "Off"
                  : "Unavailable"}
              </p>
            </div>
          </div>

          {!connection ? (
            <div className="flex gap-2 rounded-lg bg-muted/35 px-3 py-2.5 text-base text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <p>
                {primaryChannel
                  ? "The invitation is ready. A client admin accepts it, then installs Glass in their workspace."
                  : isOperator
                    ? "Create the service channel invitation before connecting the client workspace."
                    : "Ask Clarity Labs for a private service channel invitation before connecting Slack."}
              </p>
            </div>
          ) : primaryChannel && !primaryChannel.customerChannelId ? (
            <div className="flex gap-2 rounded-lg bg-muted/35 px-3 py-2.5 text-base text-muted-foreground">
              <MessageSquare className="mt-0.5 size-4 shrink-0" />
              <p>
                Mention @Glass in #{primaryChannel.channelName} once to finish
                linking the shared channel.
              </p>
            </div>
          ) : slackReady ? (
            <div className="flex gap-2 rounded-lg bg-emerald-500/5 px-3 py-2.5 text-base text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <p>Glass is ready in the client’s primary service channel.</p>
            </div>
          ) : null}

          {canEdit ? (
            <FormSection
              title={connection ? "Connection controls" : "Connect workspace"}
              description={
                connection
                  ? "Reinstall to refresh Slack permissions, or disconnect this client workspace."
                  : "Slack will open to authorize Glass in the client workspace."
              }
            >
              <label className="flex items-start gap-3 text-base text-muted-foreground">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className="mt-1 size-4"
                />
                <span>
                  Everyone in an invited channel, including third-party Slack
                  Connect participants, can see Glass responses.
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                <PillButton
                  onClick={() => void install()}
                  disabled={
                    busy !== null ||
                    !acknowledged ||
                    (isOperator && !primaryChannel)
                  }
                >
                  {busy === "oauth" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <MessageSquare className="size-3.5" />
                  )}
                  {connection ? "Reinstall Glass" : "Connect Slack"}
                </PillButton>
                {connection ? (
                  <PillButton
                    variant="destructive"
                    onClick={() => void removeConnection()}
                    disabled={busy !== null}
                  >
                    Disconnect
                  </PillButton>
                ) : null}
              </div>
            </FormSection>
          ) : null}
        </OperationalPanelBody>
      </OperationalPanel>

      {connection ? (
        <OperationalPanel>
          <OperationalPanelHeader
            title="Slack automation"
            description={
              settings.slackEnabled
                ? "Choose which updates Glass can post automatically."
                : "Turn on Slack access above before these automations can run."
            }
          />
          <ChannelRow
            title="Compliance and policy-change alerts"
            description="Post client compliance and policy-change updates."
            checked={settings.slackSafeAlertsEnabled}
            disabled={disabled || !settings.slackEnabled}
            onChange={() =>
              void save({
                ...settings,
                slackSafeAlertsEnabled: !settings.slackSafeAlertsEnabled,
              })
            }
          />
          <ChannelRow
            title="Vendor alerts"
            description="Post vendor compliance updates."
            checked={settings.slackVendorAlertsEnabled}
            disabled={disabled || !settings.slackEnabled}
            onChange={() =>
              void save({
                ...settings,
                slackVendorAlertsEnabled: !settings.slackVendorAlertsEnabled,
              })
            }
          />
          <ChannelRow
            title="Policy and endorsement delivery"
            description="Deliver client-owned documents in their Slack threads."
            checked={settings.slackPolicyDeliveryEnabled}
            disabled={disabled || !settings.slackEnabled}
            onChange={() =>
              void save({
                ...settings,
                slackPolicyDeliveryEnabled:
                  !settings.slackPolicyDeliveryEnabled,
              })
            }
          />
        </OperationalPanel>
      ) : null}

      {showEmailRouting ? (
        <ClientEmailRoutingSection clientOrgId={clientOrgId} />
      ) : null}
    </div>
  );
}
