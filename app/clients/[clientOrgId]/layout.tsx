"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";

const ClientDetailActionsContext = createContext<{
  setActions: (node: ReactNode) => void;
  setRightPanel: (node: ReactNode) => void;
}>({ setActions: () => {}, setRightPanel: () => {} });

export function useClientDetailActions() {
  return useContext(ClientDetailActionsContext);
}

export default function ClientDetailLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const [pageActions, setPageActions] = useState<ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);

  const clientOrg = useQuery(
    api.orgs.getById,
    clientOrgId ? { orgId: clientOrgId as Id<"organizations"> } : "skip",
  );

  const status =
    (clientOrg as { onboardingComplete?: boolean } | undefined)?.onboardingComplete
      ? "active"
      : "onboarding";
  const statusLabel = status === "active" ? "Active" : "Onboarding";

  const actions = (
    <div className="flex items-center gap-2">
      {clientOrg ? (
        <Badge variant={status === "active" ? "default" : "secondary"}>
          {statusLabel}
        </Badge>
      ) : null}
      {pageActions}
    </div>
  );

  return (
    <ClientDetailActionsContext.Provider
      value={{ setActions: setPageActions, setRightPanel }}
    >
      <AppShell
        breadcrumbDetail={clientOrg?.name ?? "Client"}
        actions={actions}
        rightPanel={rightPanel}
      >
        {children}
      </AppShell>
    </ClientDetailActionsContext.Provider>
  );
}
