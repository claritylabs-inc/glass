"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { StatusTag } from "@/components/ui/status-tag";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { typeStyle } from "@/lib/typography";

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
  const clientName =
    (clientOrg as { name?: string } | undefined)?.name?.trim() || "Client";

  const actions = (
    <>
      {clientOrg && isClientRoot ? (
        <StatusTag tone={status === "active" ? "success" : "warning"}>
          {statusLabel}
        </StatusTag>
      ) : null}
      {pageActions}
    </>
  );

  return (
    <ClientDetailActionsContext.Provider
      value={{ setActions: setPageActions, setRightPanel, setBreadcrumbExtra }}
    >
      <AppShell
        breadcrumbDetail={
          <span className="flex items-center gap-1.5 min-w-0">
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
                <span className={`text-muted-foreground/30 ${typeStyle("body.default")}`}>/</span>
                <span className="truncate">{breadcrumbExtra}</span>
              </>
            ) : null}
          </span>
        }
        actions={actions}
        rightPanel={rightPanel}
        disablePersistentChat
      >
        {children}
      </AppShell>
    </ClientDetailActionsContext.Provider>
  );
}
