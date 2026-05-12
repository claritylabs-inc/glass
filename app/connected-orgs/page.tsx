"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ConnectedOrgsSection } from "@/components/settings/connected-orgs-section";
import { SettingsActionsContext } from "@/components/settings/settings-actions-context";

export default function ConnectedOrgsPage() {
  const [headerActions, setHeaderActions] = useState<React.ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<React.ReactNode>(null);
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "clients" ? "clients" : "vendors";

  return (
    <SettingsActionsContext.Provider value={{ setActions: setHeaderActions, setRightPanel }}>
      <AppShell actions={headerActions} rightPanel={rightPanel}>
        <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8">
          <div className="mb-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Connect</p>
            <h1 className="mt-1 text-2xl font-semibold text-foreground">
              {view === "clients" ? "Client-side vendor monitoring" : "Vendor-side client access"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {view === "clients"
                ? "Invite and monitor contractors whose insurance records your organization needs to track."
                : "Review client requests to monitor your organization's insurance records."}
            </p>
          </div>
          <ConnectedOrgsSection view={view} />
        </div>
      </AppShell>
    </SettingsActionsContext.Provider>
  );
}
