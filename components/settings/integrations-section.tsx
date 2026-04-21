"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { ConnectionCard } from "@/components/integrations/connection-card";
import { MergeLinkButton } from "@/components/integrations/merge-link-button";
import { BrokerRequestBanner } from "@/components/integrations/broker-request-banner";
import { Plug } from "lucide-react";

const CATEGORIES: {
  key: "accounting" | "hris" | "payroll";
  label: string;
  description: string;
}[] = [
  { key: "accounting", label: "Accounting", description: "QuickBooks, Xero, and more" },
  { key: "hris", label: "HR / HRIS", description: "Rippling, Gusto, BambooHR, and more" },
  { key: "payroll", label: "Payroll", description: "Gusto, Rippling, Deel, and more" },
];

export function IntegrationsSection() {
  const currentOrg = useCurrentOrg();
  const org = currentOrg?.org ?? null;
  const connections = useQuery(
    (api as any).integrationConnections.listForClient,
    org?._id ? { clientOrgId: org._id } : "skip",
  );

  if (!org) return null;

  const activeByCategory = new Set(
    (connections ?? [])
      .filter((c: { status: string }) => c.status === "active" || c.status === "connecting")
      .map((c: { category: string }) => c.category),
  );

  return (
    <div className="space-y-8">
      {/* Broker-requested integration banners */}
      <BrokerRequestBanner clientOrgId={org._id} />

      {/* Connected integrations */}
      {connections && connections.filter((c: { status: string }) => c.status !== "disconnected").length > 0 && (
        <section>
          <h3 className="text-body-sm font-medium text-foreground mb-3">Connected</h3>
          <div className="space-y-2">
            {connections
              .filter((c: { status: string }) => c.status !== "disconnected")
              .map((conn: {
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
        </section>
      )}

      {/* Available categories — only show unconnected ones */}
      <section>
        <h3 className="text-body-sm font-medium text-foreground mb-3">
          Connect a data source
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {CATEGORIES.filter((c) => !activeByCategory.has(c.key)).map((cat) => (
            <div
              key={cat.key}
              className="flex items-start gap-3 rounded-lg border border-foreground/6 bg-card p-4"
            >
              <div className="mt-0.5 w-8 h-8 rounded-lg bg-foreground/[0.04] flex items-center justify-center shrink-0">
                <Plug className="w-4 h-4 text-muted-foreground/50" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-body-sm font-medium text-foreground">{cat.label}</p>
                <p className="text-label-sm text-muted-foreground/50">{cat.description}</p>
              </div>
              <MergeLinkButton
                clientOrgId={org._id}
                category={cat.key}
                label="Connect"
                variant="secondary"
              />
            </div>
          ))}
        </div>
        {CATEGORIES.every((c) => activeByCategory.has(c.key)) && (
          <p className="text-label-sm text-muted-foreground/60 mt-2">
            All categories connected.
          </p>
        )}
      </section>
    </div>
  );
}
