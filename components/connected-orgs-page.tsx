"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  ConnectedOrgsSection,
  type ConnectedOrgsPageKind,
} from "@/components/settings/connected-orgs-section";
import { SettingsActionsContext } from "@/components/settings/settings-actions-context";
import { useCurrentOrg } from "@/hooks/use-current-org";

export function ConnectedOrgsPage({
  page,
}: {
  page: ConnectedOrgsPageKind;
}) {
  const router = useRouter();
  const currentOrg = useCurrentOrg();
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);

  useEffect(() => {
    if (currentOrg?.isBroker) router.replace("/clients");
  }, [currentOrg?.isBroker, router]);

  if (currentOrg?.isBroker) return null;

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
