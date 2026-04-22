"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCurrentOrg } from "@/lib/hooks/use-current-org";

export default function ClientOverviewPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const orgCtx = useCurrentOrg();

  const policies = useQuery(
    api.policies.listForOrg,
    clientOrgId ? { orgId: clientOrgId as Id<"organizations"> } : "skip",
  );
  const applications = useQuery(
    (api as any).applications.listForBroker,
    orgCtx && clientOrgId
      ? {
          brokerOrgId: orgCtx.orgId,
          clientOrgId: clientOrgId as Id<"organizations">,
        }
      : "skip",
  );

  const activePolicies = policies?.filter(
    (p: any) => p.documentType === "policy" && p.extractionStatus === "complete",
  ) ?? [];
  const openApps = (applications as any[])?.filter(
    (a: any) => a.status !== "complete" && a.status !== "cancelled",
  ) ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Active policies</p>
          <p className="text-2xl font-bold mt-1">{activePolicies.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Open applications</p>
          <p className="text-2xl font-bold mt-1">{openApps.length}</p>
        </div>
      </div>
      <div>
        <p className="text-sm text-muted-foreground">
          Use the tabs above to view passport, applications, policies, intelligence, and activity.
        </p>
      </div>
    </div>
  );
}
