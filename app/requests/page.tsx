"use client";

import { useCallback, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { ClientRequestsList } from "@/components/procurement/client-requests-workspace";

export default function RequestsPage() {
  const [actions, setActions] = useState<ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);
  const handleActions = useCallback((next: ReactNode) => setActions(next), []);
  const handleRightPanel = useCallback(
    (next: ReactNode) => setRightPanel(next),
    [],
  );

  return (
    <AppShell actions={actions} rightPanel={rightPanel}>
      <ClientRequestsList
        onActions={handleActions}
        onRightPanel={handleRightPanel}
      />
    </AppShell>
  );
}
