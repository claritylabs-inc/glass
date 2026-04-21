// components/integrations/broker-integrations-panel.tsx
"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ConnectionCard } from "./connection-card";
import { RequestIntegrationButton } from "./request-integration-button";
import { Plug } from "lucide-react";

interface BrokerIntegrationsPanelProps {
  clientOrgId: string;
}

export function BrokerIntegrationsPanel({ clientOrgId }: BrokerIntegrationsPanelProps) {
  const connections = useQuery(
    (api as any).integrationConnections.listForClient,
    { clientOrgId },
  );

  const active = connections?.filter(
    (c: { status: string }) => c.status !== "disconnected",
  ) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-body-sm font-medium text-foreground">Integrations</h3>
        <RequestIntegrationButton clientOrgId={clientOrgId} />
      </div>

      {connections === undefined && (
        <p className="text-label-sm text-muted-foreground/60">Loading…</p>
      )}

      {connections !== undefined && active.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-foreground/10 p-8 text-center">
          <Plug className="w-8 h-8 text-muted-foreground/30" />
          <p className="text-label-sm text-muted-foreground/60">
            No integrations connected. Request one to get started.
          </p>
        </div>
      )}

      {active.map((conn: {
        _id: string;
        clientOrgId: string;
        category: "accounting" | "hris" | "payroll";
        providerSlug: string;
        providerDisplayName: string;
        status: "connecting" | "active" | "reauth_required" | "disconnected" | "error";
        lastSyncAt?: number;
        lastSyncStatus?: "success" | "partial" | "error";
      }) => (
        <ConnectionCard key={conn._id} connection={conn} />
      ))}
    </div>
  );
}
