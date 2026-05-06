"use client";

import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ConnectedOrgsSection } from "@/components/settings/connected-orgs-section";
import { SettingsActionsContext } from "@/components/settings/settings-actions-context";

export default function ConnectedOrgsPage() {
  const [headerActions, setHeaderActions] = useState<React.ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<React.ReactNode>(null);

  return (
    <SettingsActionsContext.Provider value={{ setActions: setHeaderActions, setRightPanel }}>
      <AppShell actions={headerActions} rightPanel={rightPanel}>
        <ConnectedOrgsSection />
      </AppShell>
    </SettingsActionsContext.Provider>
  );
}
