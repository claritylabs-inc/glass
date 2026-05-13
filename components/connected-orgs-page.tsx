"use client";

import { useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import {
  ConnectedOrgsSection,
  type ConnectedOrgsPageKind,
} from "@/components/settings/connected-orgs-section";
import { SettingsActionsContext } from "@/components/settings/settings-actions-context";

export function ConnectedOrgsPage({
  page,
}: {
  page: ConnectedOrgsPageKind;
}) {
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);

  return (
    <SettingsActionsContext.Provider
      value={{ setActions: setHeaderActions, setRightPanel }}
    >
      <AppShell actions={headerActions} rightPanel={rightPanel}>
        <ConnectedOrgsSection page={page} />
      </AppShell>
    </SettingsActionsContext.Provider>
  );
}
