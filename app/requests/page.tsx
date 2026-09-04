"use client";

import { useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { ClientRequestsList } from "@/components/procurement/client-requests-workspace";

export default function RequestsPage() {
  const [actions, setActions] = useState<ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);

  return (
    <AppShell actions={actions} rightPanel={rightPanel}>
      <ClientRequestsList
        onActions={setActions}
        onRightPanel={setRightPanel}
      />
    </AppShell>
  );
}
