"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import dayjs from "dayjs";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Globe,
  Key,
  Loader2,
  Network,
  Plug,
  Plus,
  Trash2,
} from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { Id } from "@/convex/_generated/dataModel";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";

type ConnectedAppRow = {
  tokenId: Id<"oauthTokens">;
  clientId: string;
  clientName: string;
  connectedAt: number;
  [key: string]: unknown;
};
type ApiKeyRow = {
  _id: Id<"apiKeys">;
  name: string;
  keyPrefix: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
  [key: string]: unknown;
};

export function ConnectionsSection() {
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

  const apiKeys = useCachedQuery("apiKeys.list", api.apiKeys.list, {}) as
    | ApiKeyRow[]
    | undefined;
  const updateApiKeys = useUpdateCachedQuery<ApiKeyRow[], Record<string, never>>(
    "apiKeys.list",
  );
  const generateApiKey = useMutation(api.apiKeys.generate);
  const revokeApiKey = useMutation(api.apiKeys.revoke);
  const removeApiKey = useMutation(api.apiKeys.remove);

  const [revokeTarget, setRevokeTarget] = useState<{
    tokenId: Id<"oauthTokens">;
    clientName: string;
    clientId: string;
  } | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [copiedLocal, setCopiedLocal] = useState(false);
  const [copiedRemote, setCopiedRemote] = useState(false);
  const [copiedCli, setCopiedCli] = useState(false);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showGenerateKeyDialog, setShowGenerateKeyDialog] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [generatingKey, setGeneratingKey] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [showRevokeKeyDialog, setShowRevokeKeyDialog] = useState<string | null>(null);
  const { setActions, setRightPanel } = useSettingsActions();
  useEffect(() => {
    setActions(null);
    return () => setActions(null);
  }, [setActions]);

  useEffect(() => {
    setRightPanel(
      <>
        <SettingsDrawer
          open={showGenerateKeyDialog}
          onOpenChange={(v) => !v && closeGenerateDialog()}
          title={generatedKey ? "API key generated" : "Generate API key"}
          footer={
            <>
              <PillButton
                variant="secondary"
                onClick={closeGenerateDialog}
                disabled={generatingKey}
              >
                {generatedKey ? "Done" : "Cancel"}
              </PillButton>
              {!generatedKey && (
                <PillButton onClick={handleGenerate} disabled={generatingKey || !newKeyName}>
                  {generatingKey ? "Generating…" : "Generate"}
                </PillButton>
              )}
            </>
          }
        >
          {generatedKey ? (
            <>
              <p className="text-body-sm text-muted-foreground">
                Copy this key now. You won&apos;t be able to see it again.
              </p>
              <div className="flex items-center gap-2 bg-foreground/3 border border-foreground/6 rounded-lg p-3">
                <code className="text-label font-mono text-foreground flex-1 break-all select-all">
                  {generatedKey}
                </code>
                <button
                  type="button"
                  onClick={handleCopyKey}
                  className="shrink-0 p-1.5 rounded hover:bg-foreground/5 transition-colors"
                >
                  {copiedKey ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4 text-muted-foreground" />
                  )}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-body-sm text-muted-foreground">
                Create a new API key for programmatic MCP access.
              </p>
              <div>
                <label className="text-label-sm font-medium text-muted-foreground block mb-1.5">
                  Key name
                </label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="e.g. CI pipeline, ingestion script"
                  className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                />
              </div>
            </>
          )}
        </SettingsDrawer>

        <SettingsDrawer
          open={!!revokeTarget}
          onOpenChange={(v) => !v && setRevokeTarget(null)}
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
              <PillButton variant="destructive" onClick={handleRevokeApp} disabled={revoking}>
                {revoking ? "Revoking…" : "Revoke"}
              </PillButton>
            </>
          }
        >
          <div className="flex items-start gap-3">
            <Trash2 className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-body-sm text-muted-foreground">
              This will disconnect <strong>{revokeTarget?.clientName}</strong> and revoke its
              access to your Glass data.
            </p>
          </div>
        </SettingsDrawer>

        <SettingsDrawer
          open={!!showRevokeKeyDialog}
          onOpenChange={(v) => !v && setShowRevokeKeyDialog(null)}
          title="Revoke API key"
          footer={
            <>
              <PillButton variant="secondary" onClick={() => setShowRevokeKeyDialog(null)}>
                Cancel
              </PillButton>
              <PillButton
                variant="destructive"
                onClick={async () => {
                  if (!showRevokeKeyDialog) return;
                  try {
                    await revokeApiKey({ id: showRevokeKeyDialog as Id<"apiKeys"> });
                    await updateApiKeys({}, (current) =>
                      current.map((key) =>
                        key._id === showRevokeKeyDialog
                          ? { ...key, revokedAt: dayjs().valueOf() }
                          : key,
                      ),
                    );
                    setShowRevokeKeyDialog(null);
                    toast.success("API key revoked");
                  } catch {
                    toast.error("Failed to revoke key");
                  }
                }}
              >
                Yes, revoke
              </PillButton>
            </>
          }
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-body-sm text-muted-foreground">
              This key will immediately stop working. Any integrations using it will lose access.
            </p>
          </div>
        </SettingsDrawer>
      </>,
    );
    return () => setRightPanel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showGenerateKeyDialog,
    revokeTarget,
    showRevokeKeyDialog,
    generatedKey,
    generatingKey,
    newKeyName,
    copiedKey,
    revoking,
  ]);

  const siteUrl = typeof window !== "undefined" ? window.location.origin : "";
  const mcpUrl = `${siteUrl}/mcp`;

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
  const cliSnippet = [
    "npm install -g @claritylabs/glass-cli",
    "glass auth:login",
    "glass auth:whoami",
    "glass auth:whoami --set-org <orgId>",
    "glass policies:list",
  ].join("\n");

  function copyTo(text: string, which: "local" | "remote" | "cli") {
    navigator.clipboard.writeText(text);
    if (which === "local") {
      setCopiedLocal(true);
      setTimeout(() => setCopiedLocal(false), 2000);
    } else if (which === "remote") {
      setCopiedRemote(true);
      setTimeout(() => setCopiedRemote(false), 2000);
    } else {
      setCopiedCli(true);
      setTimeout(() => setCopiedCli(false), 2000);
    }
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

  function openGenerateDialog() {
    setShowGenerateKeyDialog(true);
    setGeneratedKey(null);
    setNewKeyName("");
  }

  function closeGenerateDialog() {
    setShowGenerateKeyDialog(false);
    setGeneratedKey(null);
  }

  async function handleGenerate() {
    if (!newKeyName) return;
    setGeneratingKey(true);
    try {
      const key = await generateApiKey({ name: newKeyName });
      setGeneratedKey(key);
      toast.success("API key generated");
    } catch {
      toast.error("Failed to generate key");
    } finally {
      setGeneratingKey(false);
    }
  }

  function handleCopyKey() {
    if (!generatedKey) return;
    navigator.clipboard.writeText(generatedKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  }

  return (
    <div className="space-y-4">
      {/* MCP connections */}
      <div className="rounded-lg border border-foreground/6 bg-card">
        <div className="px-5 py-3.5 border-b border-foreground/6">
          <h3 className="mb-0! text-sm font-medium text-foreground">MCP connections</h3>
        </div>
        <div className="px-5 py-5 space-y-4">
          <p className="text-body-sm text-muted-foreground">
            Connect Glass to Claude.ai, ChatGPT, or another AI assistant. In your assistant&apos;s
            connector or integration settings, add a new MCP connection and paste the URL below.
            You&apos;ll be asked to sign in to Glass the first time you use it.
          </p>
          <div className="flex items-center gap-2 bg-foreground/3 border border-foreground/6 rounded-lg p-3">
            <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
            <code className="text-label font-mono text-foreground flex-1 break-all">{mcpUrl}</code>
            <button
              type="button"
              onClick={() => copyTo(mcpUrl, "remote")}
              className="shrink-0 p-1.5 rounded hover:bg-foreground/5 transition-colors"
            >
              {copiedRemote ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Glass CLI */}
      <div className="rounded-lg border border-foreground/6 bg-card">
        <div className="px-5 py-3.5 border-b border-foreground/6">
          <h3 className="mb-0! text-sm font-medium text-foreground">Glass CLI</h3>
        </div>
        <div className="px-5 py-5 space-y-4">
          <p className="text-body-sm text-muted-foreground">
            Install the command line interface for terminal workflows, scripts, and local
            automation. It uses the same OAuth sign-in as connected apps.
          </p>
          <div className="relative">
            <pre className="text-label bg-foreground/3 border border-foreground/6 rounded-lg p-4 pr-11 overflow-x-auto text-muted-foreground">
              {cliSnippet}
            </pre>
            <button
              type="button"
              onClick={() => copyTo(cliSnippet, "cli")}
              className="absolute top-2 right-2 p-1.5 rounded hover:bg-foreground/5 transition-colors"
              aria-label="Copy CLI install commands"
            >
              {copiedCli ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Connected apps */}
      <div className="rounded-lg border border-foreground/6 bg-card">
        <div className="px-5 py-3.5 border-b border-foreground/6">
          <h3 className="mb-0! text-sm font-medium text-foreground">Connected apps</h3>
        </div>
        {connectedApps === undefined ? (
          <div className="px-5 py-8 text-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
          </div>
        ) : connectedApps.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <Plug className="w-6 h-6 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-body-sm text-muted-foreground">No connected apps yet</p>
            <p className="text-label-sm text-muted-foreground/50 mt-0.5">
              Apps appear here after they complete the OAuth sign-in.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-foreground/6">
            {connectedApps.map((app) => (
              <div key={app.tokenId} className="px-5 py-3.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-body-sm font-medium text-foreground">{app.clientName}</p>
                  <p className="text-label-sm text-muted-foreground/50 mt-0.5">
                    Connected {dayjs(app.connectedAt).format("M/D/YYYY")}
                  </p>
                </div>
                <PillButton
                  variant="destructive"
                  size="compact"
                  onClick={() =>
                    setRevokeTarget({
                      tokenId: app.tokenId,
                      clientName: app.clientName,
                      clientId: app.clientId,
                    })
                  }
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Revoke
                </PillButton>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Advanced — API keys */}
      <div className="rounded-lg border border-foreground/6 bg-card">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="w-full px-5 py-3.5 border-b border-foreground/6 flex items-center justify-between hover:bg-foreground/2 transition-colors"
          style={{ borderBottomWidth: showAdvanced ? 1 : 0 }}
        >
          <span className="text-sm font-medium text-foreground flex items-center gap-2">
            {showAdvanced ? (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            )}
            Advanced
          </span>
          <span className="text-label-sm text-muted-foreground/60">
            For developers
          </span>
        </button>
        {showAdvanced && (
          <div>
            <div className="px-5 py-5 border-b border-foreground/6 space-y-3">
              <div>
                <h4 className="text-body-sm font-medium text-foreground mb-1">Local MCP</h4>
                <p className="text-body-sm text-muted-foreground">
                  For Claude Code, Cursor, Codex, and other local MCP clients. Paste this into your MCP
                  config (e.g. <code className="text-label bg-foreground/5 px-1 py-0.5 rounded">~/.claude/mcp.json</code> or
                  <code className="text-label bg-foreground/5 px-1 py-0.5 rounded ml-1">~/.cursor/mcp.json</code>).
                  On first run, a browser window will open to sign in.
                </p>
              </div>
              <div className="relative">
                <pre className="text-label bg-foreground/3 border border-foreground/6 rounded-lg p-4 overflow-x-auto text-muted-foreground">
                  {localSnippet}
                </pre>
                <button
                  type="button"
                  onClick={() => copyTo(localSnippet, "local")}
                  className="absolute top-2 right-2 p-1.5 rounded hover:bg-foreground/5 transition-colors"
                >
                  {copiedLocal ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4 text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>
            <div className="px-5 py-4 border-b border-foreground/6 flex items-start justify-between gap-3">
              <div>
                <h4 className="text-body-sm font-medium text-foreground mb-1">API keys</h4>
                <p className="text-body-sm text-muted-foreground">
                  Long-lived bearer tokens for programmatic access. Prefer the OAuth flow above for
                  interactive tools.
                </p>
              </div>
              <PillButton size="compact" variant="secondary" onClick={openGenerateDialog}>
                <Plus className="w-3.5 h-3.5" />
                Generate key
              </PillButton>
            </div>
            {apiKeys === undefined ? (
              <div className="px-5 py-8 text-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
              </div>
            ) : apiKeys.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <Key className="w-6 h-6 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-body-sm text-muted-foreground">No API keys yet</p>
              </div>
            ) : (
              <div className="divide-y divide-foreground/6">
                {apiKeys.map((key) => (
                  <div key={key._id} className="px-5 py-3.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-body-sm font-medium text-foreground">
                        {key.name}
                        {key.revokedAt && (
                          <span className="text-label-sm text-red-400 bg-red-50 dark:bg-red-950/40 px-1.5 py-0.5 rounded ml-2">
                            Revoked
                          </span>
                        )}
                      </p>
                      <p className="text-label-sm text-muted-foreground font-mono mt-0.5">
                        {key.keyPrefix}
                        {"••••••••"}
                      </p>
                      {key.lastUsedAt && (
                        <p className="text-label-sm text-muted-foreground/50 mt-0.5">
                          Last used {dayjs(key.lastUsedAt).format("M/D/YYYY")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!key.revokedAt ? (
                        <PillButton
                          variant="destructive"
                          size="compact"
                          onClick={() => setShowRevokeKeyDialog(key._id)}
                        >
                          Revoke
                        </PillButton>
                      ) : (
                        <PillButton
                          variant="ghost"
                          size="compact"
                          onClick={async () => {
                            try {
                              await removeApiKey({ id: key._id as Id<"apiKeys"> });
                              await updateApiKeys({}, (current) =>
                                current.filter((row) => row._id !== key._id),
                              );
                              toast.success("Key removed");
                            } catch {
                              toast.error("Failed to remove key");
                            }
                          }}
                        >
                          Delete
                        </PillButton>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

export const ConnectionsIcon = Network;
