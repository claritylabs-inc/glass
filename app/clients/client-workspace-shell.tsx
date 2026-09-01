"use client";

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { typeStyle } from "@/lib/typography";

type ClientWorkspaceActions = {
  setActions: (node: ReactNode) => void;
  setRightPanel: (node: ReactNode) => void;
  setBreadcrumbExtra: (node: ReactNode) => void;
};

const ClientWorkspaceActionsContext = createContext<ClientWorkspaceActions>({
  setActions: () => {},
  setRightPanel: () => {},
  setBreadcrumbExtra: () => {},
});

export function useClientWorkspaceActions() {
  return useContext(ClientWorkspaceActionsContext);
}

export function ClientWorkspaceShell({ children }: { children: ReactNode }) {
  const params = useParams<{ clientOrgId?: string }>();
  const clientOrgId = params.clientOrgId;
  const [pageActions, setPageActions] = useState<ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);
  const [breadcrumbExtra, setBreadcrumbExtra] = useState<ReactNode>(null);

  const clientOrg = useCachedQuery(
    "clients.getDetail",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).clients.getDetail,
    clientOrgId
      ? { clientOrgId: clientOrgId as Id<"organizations"> }
      : "skip",
  );

  const clientName =
    (clientOrg as { name?: string } | undefined)?.name?.trim() || "Client";

  return (
    <ClientWorkspaceActionsContext.Provider
      value={{
        setActions: setPageActions,
        setRightPanel,
        setBreadcrumbExtra,
      }}
    >
      <AppShell
        breadcrumbDetail={
          clientOrgId ? (
            <span className="flex min-w-0 items-center gap-1.5">
              {breadcrumbExtra ? (
                <Link
                  href={`/clients/${clientOrgId}`}
                  className="truncate text-muted-foreground/80 transition-colors hover:text-foreground"
                >
                  {clientName}
                </Link>
              ) : (
                <span className="truncate text-muted-foreground/80">
                  {clientName}
                </span>
              )}
              {breadcrumbExtra ? (
                <>
                  <span
                    className={`text-muted-foreground/30 ${typeStyle("body.default")}`}
                  >
                    /
                  </span>
                  <span className="truncate">{breadcrumbExtra}</span>
                </>
              ) : null}
            </span>
          ) : undefined
        }
        actions={pageActions}
        rightPanel={rightPanel}
        disablePersistentChat
      >
        {children}
      </AppShell>
    </ClientWorkspaceActionsContext.Provider>
  );
}
