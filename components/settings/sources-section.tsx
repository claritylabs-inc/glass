"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Loader2, Plug, Trash2, Copy, Check, Globe } from "lucide-react";
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

export function SourcesSection() {
  const connectedApps = useQuery(api.oauth.listConnectedApps);
  const revokeApp = useMutation(api.oauth.revokeApp);

  const [revokeTarget, setRevokeTarget] = useState<{
    tokenId: Id<"oauthTokens">;
    clientName: string;
    clientId: string;
  } | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [copied, setCopied] = useState(false);

  const siteUrl = typeof window !== "undefined" ? window.location.origin : "";
  const mcpUrl = `${siteUrl}/.well-known/mcp.json`;

  function handleCopy(url: string) {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await revokeApp({ clientId: revokeTarget.clientId });
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
      {/* Connected Apps */}
      <div className="rounded-lg border border-foreground/6 bg-card">
        <div className="px-5 py-3.5 border-b border-foreground/6">
          <h3 className="!mb-0 text-sm font-medium text-foreground">Connected Apps</h3>
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
              Connect remote AI tools like Claude.ai or ChatGPT via MCP.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-foreground/6">
            {connectedApps.map((app) => (
              <div key={app.tokenId} className="px-5 py-3.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-body-sm font-medium text-foreground">{app.clientName}</p>
                  <p className="text-label-sm text-muted-foreground/50 mt-0.5">
                    Connected {new Date(app.connectedAt).toLocaleDateString()}
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

      {/* Remote MCP Setup */}
      <div className="rounded-lg border border-foreground/6 bg-card">
        <div className="px-5 py-3.5 border-b border-foreground/6">
          <h3 className="!mb-0 text-sm font-medium text-foreground">Remote MCP Setup</h3>
        </div>
        <div className="px-5 py-5 space-y-4">
          <p className="text-body-sm text-muted-foreground">
            For remote tools like Claude.ai and ChatGPT. Point your tool to the MCP discovery URL below:
          </p>

          <div className="flex items-center gap-2 bg-foreground/[0.03] border border-foreground/6 rounded-lg p-3">
            <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
            <code className="text-[12px] font-mono text-foreground flex-1 break-all">
              {mcpUrl}
            </code>
            <button
              type="button"
              onClick={() => handleCopy(mcpUrl)}
              className="shrink-0 p-1.5 rounded hover:bg-foreground/5 transition-colors cursor-pointer"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-label-sm font-medium text-muted-foreground">OAuth endpoints</p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-[12px] font-mono text-muted-foreground bg-foreground/[0.03] border border-foreground/6 rounded-lg px-3 py-2">
                <span className="shrink-0 w-20 text-muted-foreground/50">Authorize</span>
                <span className="break-all">{siteUrl}/oauth/authorize</span>
              </div>
              <div className="flex items-center gap-2 text-[12px] font-mono text-muted-foreground bg-foreground/[0.03] border border-foreground/6 rounded-lg px-3 py-2">
                <span className="shrink-0 w-20 text-muted-foreground/50">Token</span>
                <span className="break-all">{siteUrl}/oauth/token</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Revoke Dialog */}
      <Dialog open={!!revokeTarget} onOpenChange={(v) => !v && setRevokeTarget(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-500" />
              Revoke Connection
            </DialogTitle>
            <DialogDescription>
              This will disconnect <strong>{revokeTarget?.clientName}</strong> and revoke its access to your Glass data.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <PillButton variant="secondary" onClick={() => setRevokeTarget(null)} disabled={revoking}>
              Cancel
            </PillButton>
            <PillButton variant="destructive" onClick={handleRevoke} disabled={revoking}>
              {revoking ? "Revoking..." : "Revoke"}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
