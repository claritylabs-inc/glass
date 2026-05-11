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

  const events = useQuery(
    api.brokerActivity.listForClient,
    currentOrg && clientOrgId
      ? {
          brokerOrgId: currentOrg.orgId as Id<"organizations">,
          clientOrgId: clientOrgId as Id<"organizations">,
        }
      : "skip",
  );

  return (
    <ActivityFeed
      events={events as ActivityEvent[] | undefined}
      showClientColumn={false}
    />
  );
}
