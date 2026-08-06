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
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { OperatorSidebar } from "../operator-sidebar";

type OperatorSlackProfile = {
  slackTeamId?: string;
  slackUserId?: string;
};

function OperatorChannelsContent({
  profile,
}: {
  profile: OperatorSlackProfile;
}) {
  const hostStatus = useQuery(api.agentChannels.getSlackHostStatus, {});
  const beginHostOAuth = useAction(api.actions.slackOAuth.beginHost);
  const setOperatorSlackIdentity = useMutation(
    api.agentChannels.setOperatorSlackIdentity,
  );
  const [slackUserId, setSlackUserId] = useState(profile.slackUserId ?? "");
  const [busy, setBusy] = useState<"host" | "identity" | null>(null);
  const hostInstallation = hostStatus?.installation;
  const identityLinked =
    !!hostInstallation &&
    profile.slackTeamId === hostInstallation.teamId &&
    !!profile.slackUserId;

  async function installHost() {
    setBusy("host");
    try {
      const { url } = await beginHostOAuth({});
      window.location.assign(url);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Clarity Slack setup could not start"),
      );
      setBusy(null);
    }
  }

  async function saveIdentity() {
    if (!hostInstallation) return;
    setBusy("identity");
    try {
      await setOperatorSlackIdentity({
        teamId: hostInstallation.teamId,
        userId: slackUserId,
      });
      toast.success("Operator Slack identity connected");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Slack identity could not be connected",
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="grid w-full gap-5">
      <header>
        <h1 className="text-xl font-medium text-foreground">
          Agent channel infrastructure
        </h1>
        <p className="mt-1 max-w-2xl text-base text-muted-foreground">
          Global connections managed by Clarity Labs. Client-specific workspace
          setup stays on each client’s Agent channels tab.
        </p>
      </header>

      <OperationalPanel>
        <OperationalPanelHeader
          title="Clarity Slack host"
          description="One installation creates and manages private service channels for every client."
          action={
            hostStatus === undefined ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : hostInstallation ? (
              <Badge variant="outline">Connected</Badge>
            ) : (
              <Badge variant="secondary">Not connected</Badge>
            )
          }
        />
        <OperationalPanelBody className="space-y-4">
          {hostStatus === undefined ? (
            <div className="h-16 animate-pulse rounded-lg bg-foreground/[0.03]" />
          ) : hostInstallation ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-label text-muted-foreground">Workspace</p>
                <p className="mt-1 text-base text-foreground">
                  {hostInstallation.teamName}
                </p>
              </div>
              <div>
                <p className="text-label text-muted-foreground">Credentials</p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-base text-foreground">
                  <CheckCircle2 className="size-3.5 text-emerald-600" /> Active
                </p>
              </div>
              <div>
                <p className="text-label text-muted-foreground">Permissions</p>
                <p className="mt-1 text-base text-foreground">
                  {hostInstallation.grantedScopes.length} scopes granted
                </p>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 rounded-lg bg-muted/35 px-3 py-2.5 text-base text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <p>
                {hostStatus.configured
                  ? "Install the Clarity host app before creating client Slack Connect channels."
                  : "Set SLACK_CLARITY_TEAM_ID before installing the host app."}
              </p>
            </div>
          )}
          <PillButton
            onClick={() => void installHost()}
            disabled={
              busy !== null ||
              hostStatus === undefined ||
              !hostStatus.configured
            }
          >
            {busy === "host" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <MessageSquare className="size-3.5" />
            )}
            {hostInstallation ? "Reinstall host app" : "Install host app"}
          </PillButton>
        </OperationalPanelBody>
      </OperationalPanel>

      <OperationalPanel>
        <OperationalPanelHeader
          title="Your Slack identity"
          description="Link your Clarity Slack user so service-channel messages are attributed and audited correctly."
          action={
            identityLinked ? (
              <Badge variant="outline">Linked</Badge>
            ) : (
              <Badge variant="secondary">Not linked</Badge>
            )
          }
        />
        <OperationalPanelBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="rounded-lg bg-muted/35 px-3 py-2">
              <p className="text-label text-muted-foreground">Workspace</p>
              <p className="mt-0.5 truncate text-base text-foreground">
                {hostInstallation?.teamName ?? "Install the host app first"}
              </p>
            </div>
            <Input
              value={slackUserId}
              onChange={(event) => setSlackUserId(event.target.value)}
              placeholder="Slack member ID (U…)"
              aria-label="Slack member ID"
            />
            <PillButton
              variant="secondary"
              onClick={() => void saveIdentity()}
              disabled={
                busy !== null || !hostInstallation || !slackUserId.trim()
              }
            >
              {busy === "identity" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Save identity
            </PillButton>
          </div>
          <p className="text-label text-muted-foreground">
            In Slack, open your profile, choose More, then copy your member ID.
          </p>
        </OperationalPanelBody>
      </OperationalPanel>
    </main>
  );
}

export default function OperatorChannelsPage() {
  const current = useCachedOperatorCurrent();

  return (
    <AppShell
      breadcrumbDetail="Channels"
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          email={current?.user?.email}
          active="channels"
        />
      )}
      customSidebarStorageKey="operator-sidebar-collapsed"
      disablePersistentChat
      disableCommandPalette
      showBrokerShare={false}
    >
      {current ? (
        <OperatorChannelsContent
          key={current.user._id}
          profile={current.profile}
        />
      ) : (
        <OperationalPanel>
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        </OperationalPanel>
      )}
    </AppShell>
  );
}
