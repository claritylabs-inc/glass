"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { SiClaude } from "react-icons/si";
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Network,
  Plug,
  Trash2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { ModelProviderLogo } from "@/components/model-provider-logo";
import type { SettingsTabId } from "@/lib/settings-sections";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";
import { formatDisplayDate } from "@/lib/date-format";

type ConnectedAppRow = {
  tokenId: Id<"oauthTokens">;
  clientId: string;
  clientName: string;
  connectedAt: number;
  [key: string]: unknown;
};

function useMcpUrl() {
  return useSyncExternalStore(
    () => () => undefined,
    () => `${window.location.origin}/mcp`,
    () => "/mcp",
  );
}

function CopyIconButton({
  copied,
  label,
  onClick,
}: {
  copied: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded p-1.5 transition-colors hover:bg-foreground/5"
      aria-label={label}
    >
      {copied ? (
        <Check className="size-4 text-green-500" />
      ) : (
        <Copy className="size-4 text-muted-foreground" />
      )}
    </button>
  );
}

export function ConnectionsSection({ tab }: { tab: SettingsTabId }) {
  const { setActions } = useSettingsActions();

  useEffect(() => {
    setActions(null);
    return () => setActions(null);
  }, [setActions]);

  if (tab === "cli") return <CliSection />;
  if (tab === "advanced") return <AdvancedSection />;
  return <McpSection />;
}

function McpSection() {
  const { setRightPanel } = useSettingsActions();
  const mcpUrl = useMcpUrl();
  const connectedApps = useCachedQuery(
    "oauth.listConnectedApps",
    api.oauth.listConnectedApps,
    {},
  ) as ConnectedAppRow[] | undefined;
  const updateConnectedApps = useUpdateCachedQuery<
    ConnectedAppRow[],
    Record<string, never>
  >("oauth.listConnectedApps");
  const revokeApp = useMutation(api.oauth.revokeApp);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{
    clientName: string;
    clientId: string;
  } | null>(null);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    setRightPanel(
      <SettingsDrawer
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke connection"
        footer={
          <>
            <PillButton
              variant="secondary"
              onClick={() => setRevokeTarget(null)}
              disabled={revoking}
            >
              Cancel
            </PillButton>
            <PillButton
              variant="destructive"
              onClick={handleRevokeApp}
              disabled={revoking}
            >
              {revoking ? "Revoking…" : "Revoke"}
            </PillButton>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <Trash2 className="mt-0.5 size-5 shrink-0 text-red-500" />
          <p className="text-base text-muted-foreground">
            This will disconnect <strong>{revokeTarget?.clientName}</strong> and
            revoke its access to your Glass data.
          </p>
        </div>
      </SettingsDrawer>,
    );
    return () => setRightPanel(null);
    // The drawer must be rebuilt as its local mutation state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revokeTarget, revoking]);

  function copyMcpUrl() {
    void navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRevokeApp() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await revokeApp({ clientId: revokeTarget.clientId });
      await updateConnectedApps({}, (current) =>
        current.filter((app) => app.clientId !== revokeTarget.clientId),
      );
      toast.success("Connection revoked");
      setRevokeTarget(null);
    } catch {
      toast.error("Failed to revoke connection");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="space-y-4">
      <OperationalPanel>
        <OperationalPanelHeader
          title="MCP endpoint"
          description="Connect Glass to an AI assistant with your existing Glass account."
          className="px-5 py-3.5"
        />
        <OperationalPanelBody className="px-5 py-5">
          <div className="flex items-center gap-2 rounded-lg border border-foreground/6 bg-foreground/3 p-3">
            <Globe className="size-4 shrink-0 text-muted-foreground" />
            <code className="flex-1 break-all font-mono text-label text-foreground">
              {mcpUrl}
            </code>
            <CopyIconButton copied={copied} label="Copy MCP endpoint" onClick={copyMcpUrl} />
          </div>
        </OperationalPanelBody>

        <OperationalItem className="grid gap-3 px-5 py-4 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-6">
          <div className="flex items-center justify-between gap-3 md:block">
            <div className="flex items-center gap-2">
              <SiClaude aria-hidden="true" className="size-[17px] text-[#D97757]" />
              <h3 className="text-base font-medium text-foreground">Claude</h3>
            </div>
            <PillButton
              href="https://claude.ai/new#settings/customize-connectors"
              target="_blank"
              rel="noreferrer"
              variant="secondary"
              size="compact"
              className="md:mt-3"
            >
              Open Claude
              <ExternalLink className="size-3.5" />
            </PillButton>
          </div>
          <ol className="list-decimal space-y-1.5 pl-5 text-base text-muted-foreground marker:text-muted-foreground/60">
            <li>
              Open <span className="font-medium text-foreground">Settings → Connectors</span>.
              Team and Enterprise owners should first choose Organization connectors.
            </li>
            <li>
              Select <span className="font-medium text-foreground">Add custom connector</span>,
              name it Glass, and paste the endpoint above.
            </li>
            <li>Add the connector, select Connect, and sign in to Glass.</li>
          </ol>
        </OperationalItem>

        <OperationalItem className="grid gap-3 px-5 py-4 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-6">
          <div className="flex items-center justify-between gap-3 md:block">
            <div className="flex items-center gap-2">
              <ModelProviderLogo provider="openai" size={17} className="dark:invert" />
              <h3 className="text-base font-medium text-foreground">ChatGPT</h3>
            </div>
            <PillButton
              href="https://chatgpt.com/#settings/Connectors"
              target="_blank"
              rel="noreferrer"
              variant="secondary"
              size="compact"
              className="md:mt-3"
            >
              Open ChatGPT
              <ExternalLink className="size-3.5" />
            </PillButton>
          </div>
          <ol className="list-decimal space-y-1.5 pl-5 text-base text-muted-foreground marker:text-muted-foreground/60">
            <li>
              Open <span className="font-medium text-foreground">Settings → Apps → Advanced settings</span>
              {" "}and enable Developer mode. Your workspace may require admin access.
            </li>
            <li>
              Return to Apps, select <span className="font-medium text-foreground">Create</span>,
              name the app Glass, and paste the endpoint above.
            </li>
            <li>Choose OAuth when prompted, scan the tools, create the app, and sign in to Glass.</li>
          </ol>
        </OperationalItem>
      </OperationalPanel>

      <OperationalPanel>
        <OperationalPanelHeader title="Connected apps" className="px-5 py-3.5" />
        {connectedApps === undefined ? (
          <div className="px-5 py-8 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : connectedApps.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <Plug className="mx-auto mb-2 size-6 text-muted-foreground/20" />
            <p className="text-base text-muted-foreground">No connected apps yet</p>
            <p className="mt-0.5 text-label text-muted-foreground/50">
              Apps appear here after they complete the OAuth sign-in.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-foreground/6">
            {connectedApps.map((app) => (
              <div key={app.tokenId} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-base font-medium text-foreground">{app.clientName}</p>
                  <p className="mt-0.5 text-label text-muted-foreground/50">
                    Connected {formatDisplayDate(app.connectedAt)}
                  </p>
                </div>
                <PillButton
                  variant="destructive"
                  size="compact"
                  onClick={() =>
                    setRevokeTarget({
                      clientName: app.clientName,
                      clientId: app.clientId,
                    })
                  }
                >
                  <Trash2 className="size-3.5" />
                  Revoke
                </PillButton>
              </div>
            ))}
          </div>
        )}
      </OperationalPanel>
    </div>
  );
}

function CliSection() {
  const [copied, setCopied] = useState(false);
  const cliSnippet = [
    "npm install -g @claritylabs/glass-cli",
    "glass auth:login",
    "glass auth:whoami",
    "glass auth:whoami --set-org <orgId>",
    "glass policies:list",
  ].join("\n");

  function copyCliSnippet() {
    void navigator.clipboard.writeText(cliSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <OperationalPanel>
      <OperationalPanelHeader
        title="Install and sign in"
        description="Use the Glass CLI for terminal workflows, scripts, and local automation."
        className="px-5 py-3.5"
      />
      <OperationalPanelBody className="px-5 py-5">
        <div className="relative">
          <pre className="overflow-x-auto rounded-lg border border-foreground/6 bg-foreground/3 p-4 pr-11 text-label text-muted-foreground">
            {cliSnippet}
          </pre>
          <div className="absolute right-2 top-2">
            <CopyIconButton
              copied={copied}
              label="Copy CLI install commands"
              onClick={copyCliSnippet}
            />
          </div>
        </div>
      </OperationalPanelBody>
    </OperationalPanel>
  );
}

function AdvancedSection() {
  const mcpUrl = useMcpUrl();
  const [copiedLocal, setCopiedLocal] = useState(false);
  const localSnippet = JSON.stringify(
    {
      mcpServers: {
        glass: {
          command: "npx",
          args: ["-y", "mcp-remote", mcpUrl],
        },
      },
    },
    null,
    2,
  );

  function copyLocalSnippet() {
    void navigator.clipboard.writeText(localSnippet);
    setCopiedLocal(true);
    setTimeout(() => setCopiedLocal(false), 2000);
  }

  return (
    <OperationalPanel>
      <OperationalPanelHeader
        title="Local MCP clients"
        description="Use Glass from Claude Code, Cursor, Codex, or another local MCP client."
        className="px-5 py-3.5"
      />
      <OperationalPanelBody className="space-y-3 px-5 py-5">
        <p className="text-base text-muted-foreground">
          Add this server to your client&apos;s MCP configuration. A browser window opens for
          Glass sign-in on first use.
        </p>
        <div className="relative">
          <pre className="overflow-x-auto rounded-lg border border-foreground/6 bg-foreground/3 p-4 pr-11 text-label text-muted-foreground">
            {localSnippet}
          </pre>
          <div className="absolute right-2 top-2">
            <CopyIconButton
              copied={copiedLocal}
              label="Copy local MCP configuration"
              onClick={copyLocalSnippet}
            />
          </div>
        </div>
      </OperationalPanelBody>
    </OperationalPanel>
  );
}

export const ConnectionsIcon = Network;
