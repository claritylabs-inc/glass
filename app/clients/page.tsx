"use client";

import { useCurrentOrg } from "@/hooks/use-current-org";
import { AppShell } from "@/components/app-shell";
import { ClientList } from "@/components/client-list";
import type { Id } from "@/convex/_generated/dataModel";

export default function ClientsPage() {
  const currentOrg = useCurrentOrg();

  if (!currentOrg) {
    return (
      <AppShell breadcrumbDetail="Clients">
        <div className="py-12 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      </AppShell>
    );
  }

  if (!currentOrg.isBroker) {
    return (
      <AppShell breadcrumbDetail="Clients">
        <div className="py-12 text-center text-sm text-muted-foreground">
          This page is for broker organizations only.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbDetail="Clients">
      <ClientList brokerOrgId={currentOrg.orgId as Id<"organizations">} />
    </AppShell>
  );
}
