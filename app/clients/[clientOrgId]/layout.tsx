"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useParams, usePathname } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

const ClientDetailActionsContext = createContext<{
  setActions: (node: ReactNode) => void;
  setRightPanel: (node: ReactNode) => void;
  setBreadcrumbExtra: (node: ReactNode) => void;
}>({ setActions: () => {}, setRightPanel: () => {}, setBreadcrumbExtra: () => {} });

export function useClientDetailActions() {
  return useContext(ClientDetailActionsContext);
}

export default function ClientDetailLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const pathname = usePathname();
  const isClientRoot = pathname === `/clients/${clientOrgId}`;
  const [pageActions, setPageActions] = useState<ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);
  const [breadcrumbExtra, setBreadcrumbExtra] = useState<ReactNode>(null);

  const clientOrg = useCachedQuery(
    "clients.getDetail",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).clients.getDetail,
    clientOrgId ? { clientOrgId: clientOrgId as Id<"organizations"> } : "skip",
  );

  const status =
    (clientOrg as { onboardingComplete?: boolean } | undefined)
      ?.onboardingComplete
      ? "active"
      : "onboarding";
  const statusLabel = status === "active" ? "Active" : "Onboarding";

  const actions = (
    <div className="flex items-center gap-2">
      {clientOrg && isClientRoot ? (
        <Badge variant={status === "active" ? "default" : "secondary"}>
          {statusLabel}
        </Badge>
      ) : null}
      {pageActions}
    </div>
  );

  return (
    <ClientDetailActionsContext.Provider
      value={{ setActions: setPageActions, setRightPanel, setBreadcrumbExtra }}
    >
      <AppShell
        breadcrumbDetail={
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="truncate text-muted-foreground/80">
              {(clientOrg as { name?: string } | undefined)?.name?.trim() || "Client"}
            </span>
            {breadcrumbExtra ? (
              <>
                <span className="text-muted-foreground/30 text-body-sm">/</span>
                <span className="truncate">{breadcrumbExtra}</span>
              </>
            ) : null}
          </span>
        }
        actions={actions}
        rightPanel={rightPanel}
      >
        {children}
      </AppShell>
    </ClientDetailActionsContext.Provider>
  );
}
