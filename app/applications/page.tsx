"use client";

import { useState, type ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { ApplicationIntakePage } from "@/components/application-intake/application-intake-page";
import { useCurrentOrg } from "@/hooks/use-current-org";
import type { Id } from "@/convex/_generated/dataModel";

export default function ApplicationsPage() {
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);
  const [actions, setActions] = useState<ReactNode>(null);
  const currentOrg = useCurrentOrg();
  const mode = currentOrg?.isBroker ? "broker" : "client";
  const clientOrgId = currentOrg && !currentOrg.isBroker
    ? (currentOrg.orgId as Id<"organizations">)
    : undefined;

  return (
    <AppShell actions={actions} rightPanel={rightPanel}>
      <ApplicationIntakePage
        mode={mode}
        clientOrgId={clientOrgId}
        onActionsChange={setActions}
        onRightPanelChange={setRightPanel}
      />
    </AppShell>
  );
}
