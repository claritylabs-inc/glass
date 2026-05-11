"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { AppShell } from "@/components/app-shell";
import { ActivityFeed, type ActivityEvent } from "@/components/activity-feed";

export default function PortfolioActivityPage() {
  const currentOrg = useCurrentOrg();

  const events = useQuery(
    api.brokerActivity.listPortfolio,
    currentOrg?.isBroker
      ? { brokerOrgId: currentOrg.orgId as Id<"organizations"> }
      : "skip",
  );

  return (
    <AppShell>
      <ActivityFeed
        events={events as ActivityEvent[] | undefined}
        showClientColumn={true}
      />
    </AppShell>
  );
}
