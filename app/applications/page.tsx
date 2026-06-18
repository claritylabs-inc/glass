"use client";

import { useState, type ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { ApplicationIntakePage } from "@/components/application-intake/application-intake-page";

export default function ApplicationsPage() {
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);
  const [actions, setActions] = useState<ReactNode>(null);

  return (
    <AppShell actions={actions} rightPanel={rightPanel}>
      <ApplicationIntakePage
        mode="broker"
        onActionsChange={setActions}
        onRightPanelChange={setRightPanel}
      />
    </AppShell>
  );
}
