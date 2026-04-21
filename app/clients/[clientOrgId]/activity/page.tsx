"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { ActivityFeed, type ActivityEvent } from "@/components/activity-feed";

export default function ClientActivityPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const currentOrg = useCurrentOrg();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events = useQuery(
    (api as any).brokerActivity.listForClient,
    currentOrg && clientOrgId
      ? {
          brokerOrgId: currentOrg.orgId as Id<"organizations">,
          clientOrgId: clientOrgId as Id<"organizations">,
        }
      : "skip",
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
        Activity
      </p>
      <ActivityFeed events={events as ActivityEvent[] | undefined} showClientColumn={false} />
    </div>
  );
}
