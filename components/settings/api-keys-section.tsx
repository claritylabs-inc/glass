"use client";

import { useState, useEffect } from "react";
import { useSettingsActions } from "@/app/settings/page";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import {
  Loader2,
  Key,
  Plus,
  Copy,
  Check,
  AlertTriangle,
} from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Id } from "@/convex/_generated/dataModel";

export function ApiKeysSection() {
  const apiKeys = useQuery(api.apiKeys.list);
  const generateApiKey = useMutation(api.apiKeys.generate);
  const revokeApiKey = useMutation(api.apiKeys.revoke);
  const removeApiKey = useMutation(api.apiKeys.remove);

  const [showGenerateKeyDialog, setShowGenerateKeyDialog] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [generatingKey, setGeneratingKey] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [showRevokeDialog, setShowRevokeDialog] = useState<string | null>(null);

  const { setActions } = useSettingsActions();

  useEffect(() => {
    setActions(
      <PillButton size="compact" variant="secondary" onClick={openGenerateDialog}>
        <Plus className="w-3.5 h-3.5" />
        Generate Key
      </PillButton>
    );
    return () => setActions(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  if (apiKeys === undefined) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* API Keys list */}
      <div className="rounded-lg border border-foreground/6 bg-card">
        <div className="px-5 py-3.5 border-b border-foreground/6">
          <h3 className="!mb-0 text-sm font-medium text-foreground">API Keys</h3>
        </div>
        {apiKeys.length > 0 ? (
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
                    {key.keyPrefix}{"••••••••"}
                  </p>
                  {key.lastUsedAt && (
                    <p className="text-label-sm text-muted-foreground/50 mt-0.5">
                      Last used {new Date(key.lastUsedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!key.revokedAt ? (
                    <PillButton
                      variant="destructive"
                      size="compact"
                      onClick={() => setShowRevokeDialog(key._id)}
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
        ) : (
          <div className="px-5 py-8 text-center">
            <Key className="w-6 h-6 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-body-sm text-muted-foreground">No API keys yet</p>
            <p className="text-label-sm text-muted-foreground/50 mt-0.5">
              Generate a key to connect AI agents via MCP.
            </p>
          </div>
        )}
      </div>

      {/* Local MCP Setup Instructions */}
      <div className="rounded-lg border border-foreground/6 bg-card">
        <div className="px-5 py-3.5 border-b border-foreground/6">
          <h3 className="!mb-0 text-sm font-medium text-foreground">Local MCP Setup</h3>
        </div>
        <div className="px-5 py-5">
          <p className="text-body-sm text-muted-foreground mb-3">
            For local tools like Claude Code and Cursor. For remote tools (Claude.ai, ChatGPT), use the Sources tab instead. Add this to your MCP config (<code className="text-[12px] bg-foreground/5 px-1 py-0.5 rounded">~/.claude/mcp.json</code>):
          </p>
          <pre className="text-[12px] bg-foreground/[0.03] border border-foreground/6 rounded-lg p-4 overflow-x-auto text-muted-foreground">
{JSON.stringify({
  mcpServers: {
    prism: {
      command: "node",
      args: ["<path-to-prism>/mcp-server/dist/index.js"],
      env: {
        PRISM_CONVEX_SITE_URL: (process.env.NEXT_PUBLIC_CONVEX_URL ?? "").replace(".cloud", ".site"),
        PRISM_API_KEY: "prism_...",
      },
    },
  },
}, null, 2)}
          </pre>
        </div>
      </div>

      {/* Generate API Key Dialog */}
      <Dialog open={showGenerateKeyDialog} onOpenChange={(v) => { if (!v) closeGenerateDialog(); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-5 h-5 text-muted-foreground" />
              {generatedKey ? "API Key Generated" : "Generate API Key"}
            </DialogTitle>
            <DialogDescription>
              {generatedKey
                ? "Copy this key now. You won't be able to see it again."
                : "Create a new API key for MCP server or programmatic access."}
            </DialogDescription>
          </DialogHeader>
          {generatedKey ? (
            <div className="py-2">
              <div className="flex items-center gap-2 bg-foreground/[0.03] border border-foreground/6 rounded-lg p-3">
                <code className="text-[12px] font-mono text-foreground flex-1 break-all select-all">
                  {generatedKey}
                </code>
                <button
                  type="button"
                  onClick={handleCopyKey}
                  className="shrink-0 p-1.5 rounded hover:bg-foreground/5 transition-colors cursor-pointer"
                >
                  {copiedKey ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4 text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="py-2">
              <label className="text-label-sm font-medium text-muted-foreground  block mb-1.5">
                Key Name
              </label>
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g. Claude Code, Cursor"
                className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
              />
            </div>
          )}
          <DialogFooter>
            <PillButton variant="secondary" onClick={closeGenerateDialog} disabled={generatingKey}>
              {generatedKey ? "Done" : "Cancel"}
            </PillButton>
            {!generatedKey && (
              <PillButton
                onClick={handleGenerate}
                disabled={generatingKey || !newKeyName}
              >
                {generatingKey ? "Generating..." : "Generate"}
              </PillButton>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke API Key Dialog */}
      <Dialog open={!!showRevokeDialog} onOpenChange={(v) => !v && setShowRevokeDialog(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Revoke API Key
            </DialogTitle>
            <DialogDescription>
              This key will immediately stop working. Any MCP servers or integrations using it will lose access.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <PillButton variant="secondary" onClick={() => setShowRevokeDialog(null)}>
              Cancel
            </PillButton>
            <PillButton
              variant="destructive"
              onClick={async () => {
                if (!showRevokeDialog) return;
                try {
                  await revokeApiKey({ id: showRevokeDialog as Id<"apiKeys"> });
                  setShowRevokeDialog(null);
                  toast.success("API key revoked");
                } catch {
                  toast.error("Failed to revoke key");
                }
              }}
            >
              Yes, Revoke
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
