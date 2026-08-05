"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { CheckCircle2, Loader2, MessageSquare, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ClientEmailRoutingSection } from "@/components/settings/client-email-routing-section";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { Input } from "@/components/ui/input";
import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { useCurrentOrg } from "@/hooks/use-current-org";

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
}: {
  clientOrgId: Id<"organizations">;
  showEmailRouting?: boolean;
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
  const hostStatus = useQuery(
    api.agentChannels.getSlackHostStatus,
    isOperator ? {} : "skip",
  );
  const result = isOperator ? operatorResult : customerResult;
  const canEdit =
    isOperator ||
    (currentOrg?.orgId === clientOrgId &&
      currentOrg.orgType === "client" &&
      currentOrg.role === "admin");
  const update = useMutation(api.agentChannels.update);
  const updateForOperator = useMutation(api.agentChannels.updateForOperator);
  const setOperatorSlackIdentity = useMutation(
    api.agentChannels.setOperatorSlackIdentity,
  );
  const bindPrimaryChannel = useMutation(
    api.agentChannels.bindPrimaryChannelForOperator,
  );
  const beginOAuth = useAction(api.actions.slackOAuth.begin);
  const beginHostOAuth = useAction(api.actions.slackOAuth.beginHost);
  const disconnect = useAction(api.actions.slackOAuth.disconnect);
  const provisionPrimary = useAction(api.actions.slackOnboarding.createPrimaryChannel);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [clientSlug, setClientSlug] = useState("");
  const [operatorTeamId, setOperatorTeamId] = useState("");
  const [operatorSlackUserId, setOperatorSlackUserId] = useState("");
  const [manualSetupReason, setManualSetupReason] = useState<string | null>(null);
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
        error instanceof Error
          ? error.message
          : "Agent channels could not be saved",
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
      toast.error(error instanceof Error ? error.message : "Slack setup could not start");
      setBusy(null);
    }
  }

  async function installHost() {
    setBusy("host-oauth");
    try {
      const { url } = await beginHostOAuth({});
      window.location.assign(url);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Clarity Slack setup could not start",
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
      toast.error(error instanceof Error ? error.message : "Slack could not be disconnected");
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
        setManualSetupReason(response.manualSetupRequired ? response.reason : null);
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
        error instanceof Error
          ? error.message
          : "The Slack Connect channel could not be created",
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
        error instanceof Error
          ? error.message
          : "The primary channel could not be connected",
      );
    } finally {
      setBusy(null);
    }
  }

  async function connectOperatorIdentity() {
    setBusy("operator-identity");
    try {
      await setOperatorSlackIdentity({
        teamId: operatorTeamId,
        userId: operatorSlackUserId,
      });
      toast.success("Operator Slack identity connected");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Slack identity could not be connected",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!result) {
    return <div className="h-40 animate-pulse rounded-lg bg-foreground/[0.03]" />;
  }
  const { settings, connection, primaryChannel } = result;
  const disabled = !canEdit || busy === "settings";

  return (
    <div className="space-y-5">
      <OperationalPanel>
        <OperationalPanelHeader
          title="Agent channels"
          description="Choose where your team can work with Glass. Email and iMessage are AI-only; Slack combines the agent with Glass service operators."
        />
        <ChannelRow
          title="Email"
          description="Agent-only conversations through your Glass email address."
          checked={settings.emailEnabled}
          disabled={disabled}
          onChange={() =>
            void save({ ...settings, emailEnabled: !settings.emailEnabled })
          }
        />
        <ChannelRow
          title="iMessage"
          description="Agent-only conversations through the Glass phone number."
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
          description="Privileged AI and human service in your connected workspace."
          checked={settings.slackEnabled}
          disabled={disabled || !connection}
          onChange={() =>
            void save({ ...settings, slackEnabled: !settings.slackEnabled })
          }
        />
      </OperationalPanel>

      <OperationalPanel>
        <OperationalPanelHeader
          title="Slack connection"
          description="Glass stores service-channel conversations and completed actions in your client record."
          action={
            connection ? (
              <span className="inline-flex items-center gap-1.5 text-label text-emerald-600">
                <CheckCircle2 className="size-3.5" /> Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-label text-muted-foreground">
                <TriangleAlert className="size-3.5" /> Not connected
              </span>
            )
          }
        />
        <OperationalPanelBody className="space-y-4">
          {connection ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-label text-muted-foreground">Workspace</p>
                <p className="mt-1 text-base text-foreground">
                  {connection.teamName}
                </p>
              </div>
              <div>
                <p className="text-label text-muted-foreground">Primary service channel</p>
                <p className="mt-1 text-base text-foreground">
                  {primaryChannel
                    ? `#${primaryChannel.channelName}${primaryChannel.customerChannelId ? "" : " · mention @Glass there to finish"}`
                    : "Awaiting Glass setup"}
                </p>
              </div>
              <div>
                <p className="text-label text-muted-foreground">OAuth health</p>
                <p className="mt-1 text-base text-foreground">
                  {connection.grantedScopes.length > 0
                    ? "Required scopes verified"
                    : "Reinstall required"}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-base text-muted-foreground">
              A client admin installs Glass after the private Slack Connect channel invitation arrives. The app must be invited to each additional channel where the team wants to use @Glass.
            </p>
          )}
          {canEdit ? (
            <div className="space-y-4">
              <label className="flex items-start gap-3 text-base text-muted-foreground">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className="mt-1 size-4"
                />
                <span>
                  I understand that everyone in an invited channel, including third-party Slack Connect participants, can see Glass responses.
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                <PillButton
                  onClick={() => void install()}
                  disabled={busy !== null || !acknowledged}
                >
                  {busy === "oauth" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <MessageSquare className="size-3.5" />
                  )}
                  {connection ? "Reinstall Glass" : "Install Glass in Slack"}
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
            </div>
          ) : null}
        </OperationalPanelBody>
      </OperationalPanel>

      <OperationalPanel>
        <OperationalPanelHeader
          title="Slack automation"
          description="Safe client alerts and policy delivery start enabled. Vendor alerts stay off unless an admin enables them."
        />
        <ChannelRow
          title="Compliance and policy-change alerts"
          description="Share safe customer compliance and policy-change updates in the primary channel."
          checked={settings.slackSafeAlertsEnabled}
          disabled={disabled || !connection}
          onChange={() =>
            void save({
              ...settings,
              slackSafeAlertsEnabled: !settings.slackSafeAlertsEnabled,
            })
          }
        />
        <ChannelRow
          title="Vendor alerts"
          description="Share vendor compliance updates. Off by default."
          checked={settings.slackVendorAlertsEnabled}
          disabled={disabled || !connection}
          onChange={() =>
            void save({
              ...settings,
              slackVendorAlertsEnabled: !settings.slackVendorAlertsEnabled,
            })
          }
        />
        <ChannelRow
          title="Policy and endorsement delivery"
          description="Deliver client-owned policy documents in their Slack threads."
          checked={settings.slackPolicyDeliveryEnabled}
          disabled={disabled || !connection}
          onChange={() =>
            void save({
              ...settings,
              slackPolicyDeliveryEnabled: !settings.slackPolicyDeliveryEnabled,
            })
          }
        />
      </OperationalPanel>

      {isOperator ? (
        <OperationalPanel>
          <OperationalPanelHeader
            title="Glass-led Slack Connect setup"
            description="Create the private channel in claritylabsinc.slack.com and send the customer invitation. This action is audited."
          />
          <OperationalPanelBody className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-base font-medium text-foreground">
                  Clarity host installation
                </p>
                <p className="mt-0.5 text-base text-muted-foreground">
                  {hostStatus?.installation
                    ? `${hostStatus.installation.teamName} · rotating credentials active`
                    : "Install the native app before creating Connect channels."}
                </p>
              </div>
              <PillButton
                variant="secondary"
                onClick={() => void installHost()}
                disabled={busy !== null || hostStatus === undefined}
              >
                {busy === "host-oauth" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                {hostStatus?.installation ? "Reinstall host app" : "Install host app"}
              </PillButton>
            </div>
            <div>
              <p className="mb-2 text-label text-muted-foreground">
                Your operator identity
              </p>
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <Input
                  value={operatorTeamId}
                  onChange={(event) => setOperatorTeamId(event.target.value)}
                  placeholder="Slack team ID"
                />
                <Input
                  value={operatorSlackUserId}
                  onChange={(event) =>
                    setOperatorSlackUserId(event.target.value)
                  }
                  placeholder="Slack user ID"
                />
                <PillButton
                  variant="secondary"
                  onClick={() => void connectOperatorIdentity()}
                  disabled={
                    busy !== null ||
                    !operatorTeamId.trim() ||
                    !operatorSlackUserId.trim()
                  }
                >
                  Connect identity
                </PillButton>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                value={clientSlug}
                onChange={(event) => setClientSlug(event.target.value)}
                placeholder="client-slug"
              />
              <Input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="client-admin@example.com"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <p className="text-base text-muted-foreground">
                Paid-plan or workspace permission restrictions return a manual-setup instruction instead of changing account access.
              </p>
              <PillButton
                onClick={() => void createPrimary()}
                disabled={
                  busy !== null || !clientSlug.trim() || !inviteEmail.trim()
                }
              >
                {busy === "provision" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                Create channel
              </PillButton>
            </div>
            {manualSetupReason ? (
              <div className="space-y-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                <p className="text-base text-foreground">
                  Slack could not automate the Connect invitation ({manualSetupReason}). Create the private channel and invitation in the Clarity workspace, complete customer OAuth, then record the shared channel IDs below.
                </p>
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
                  {busy === "manual-channel" ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Connect manual channel
                </PillButton>
              </div>
            ) : null}
          </OperationalPanelBody>
        </OperationalPanel>
      ) : null}

      {showEmailRouting ? <ClientEmailRoutingSection clientOrgId={clientOrgId} /> : null}
    </div>
  );
}
