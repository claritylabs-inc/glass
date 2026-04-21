// components/integrations/connection-card.tsx
"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { PillButton } from "@/components/ui/pill-button";
import { MergeLinkButton } from "./merge-link-button";
import { formatDistanceToNow } from "date-fns";
import {
  SiQuickbooks,
  SiXero,
  SiGusto,
} from "react-icons/si";
import { Plug, Trash2 } from "lucide-react";

type IntegrationConnection = {
  _id: string;
  clientOrgId: string;
  category: "accounting" | "hris" | "payroll";
  providerSlug: string;
  providerDisplayName: string;
  status: "connecting" | "active" | "reauth_required" | "disconnected" | "error";
  lastSyncAt?: number;
  lastSyncStatus?: "success" | "partial" | "error";
};

const PROVIDER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  quickbooks_online: SiQuickbooks as React.ComponentType<{ className?: string }>,
  xero: SiXero as React.ComponentType<{ className?: string }>,
  gusto: SiGusto as React.ComponentType<{ className?: string }>,
};

const STATUS_BADGE_VARIANT: Record<
  IntegrationConnection["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  connecting: "secondary",
  active: "default",
  reauth_required: "destructive",
  disconnected: "outline",
  error: "destructive",
};

interface ConnectionCardProps {
  connection: IntegrationConnection;
  onChanged?: () => void;
}

export function ConnectionCard({ connection, onChanged }: ConnectionCardProps) {
  const disconnect = useMutation((api as any).integrationConnections.disconnect);

  const Icon = PROVIDER_ICONS[connection.providerSlug] ?? Plug;

  async function handleDisconnect() {
    try {
      await disconnect({ connectionId: connection._id });
      toast.success(`${connection.providerDisplayName} disconnected`);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to disconnect");
    }
  }

  const needsReauth =
    connection.status === "reauth_required" || connection.status === "error";

  return (
    <div className="flex items-center gap-4 rounded-lg border border-foreground/8 bg-card p-4">
      <div className="w-10 h-10 rounded-lg bg-foreground/[0.04] flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-muted-foreground/70" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-body-sm font-medium text-foreground">
            {connection.providerDisplayName}
          </p>
          <Badge variant={STATUS_BADGE_VARIANT[connection.status]}>
            {connection.status.replace("_", " ")}
          </Badge>
        </div>
        <p className="text-label-sm text-muted-foreground/60 capitalize">
          {connection.category}
          {connection.lastSyncAt
            ? ` · Last synced ${formatDistanceToNow(connection.lastSyncAt, { addSuffix: true })}`
            : ""}
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {needsReauth && (
          <MergeLinkButton
            clientOrgId={connection.clientOrgId}
            category={connection.category}
            label="Reconnect"
            variant="secondary"
            onLinked={onChanged}
          />
        )}
        {connection.status !== "disconnected" && !needsReauth && (
          <PillButton
            variant="ghost"
            onClick={handleDisconnect}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Disconnect
          </PillButton>
        )}
      </div>
    </div>
  );
}
