"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  OperatorComplianceWorkspace,
  type ComplianceWorkspaceShellArgs,
} from "@/components/compliance-page";
import { AppShell } from "@/components/app-shell";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  useCachedOperatorClients,
  useCachedOperatorCurrent,
} from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { OperatorClientSidebar } from "../operator-client-sidebar";
import { OperatorClientImpersonationAction } from "../operator-client-impersonation-action";

export default function OperatorClientCompliancePage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const current = useCachedOperatorCurrent();
  const clients = useCachedOperatorClients();
  const client = clients?.find((row) => row._id === clientOrgId) ?? null;
  const activeImpersonation = current?.activeImpersonation ?? null;

  const impersonationAction = (
    <OperatorClientImpersonationAction
      clientOrgId={clientOrgId}
      activeImpersonation={activeImpersonation}
      disabled={!client}
    />
  );

  const breadcrumb = (
    <span className="flex min-w-0 items-center gap-1.5">
      <Link
        href={`/operator/clients/${clientOrgId}`}
        className="truncate text-muted-foreground/80 transition-colors hover:text-foreground"
      >
        {client?.name ?? "Client"}
      </Link>
      <span
        className={`text-muted-foreground/30 ${typeStyle("body.default")}`}
        aria-hidden="true"
      >
        /
      </span>
      <span className="truncate">Compliance</span>
    </span>
  );

  const sidebar = ({
    collapsed,
    onToggleCollapse,
  }: {
    collapsed: boolean;
    onToggleCollapse: () => void;
  }) => (
    <OperatorClientSidebar
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      clientOrgId={clientOrgId}
    />
  );

  if (clients === undefined) {
    return (
      <AppShell
        actions={impersonationAction}
        breadcrumbDetail={breadcrumb}
        customSidebar={sidebar}
        customSidebarStorageKey="operator-sidebar-collapsed"
        disablePersistentChat
        disableCommandPalette
        showBrokerShare={false}
      >
        <OperationalPanel>
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        </OperationalPanel>
      </AppShell>
    );
  }

  if (!client) {
    return (
      <AppShell
        actions={impersonationAction}
        breadcrumbDetail={breadcrumb}
        customSidebar={sidebar}
        customSidebarStorageKey="operator-sidebar-collapsed"
        disablePersistentChat
        disableCommandPalette
        showBrokerShare={false}
      >
        <OperationalPanel>
          <OperationalPanelHeader title="Client not found" />
          <OperationalPanelBody>
            <PillButton href="/operator" variant="secondary">
              Back to clients
            </PillButton>
          </OperationalPanelBody>
        </OperationalPanel>
      </AppShell>
    );
  }

  return (
    <OperatorComplianceWorkspace
      orgContext={{
        orgId: client._id,
        orgType: "client",
        role: "admin",
        featureFlags: client.featureFlags,
        isReadOnlyImpersonation: Boolean(activeImpersonation),
      }}
      renderShell={({
        actions,
        rightPanel,
        toolbar,
        children,
      }: ComplianceWorkspaceShellArgs) => (
        <AppShell
          actions={
            actions ? (
              <>
                {impersonationAction}
                {actions}
              </>
            ) : (
              impersonationAction
            )
          }
          breadcrumbDetail={breadcrumb}
          rightPanel={rightPanel}
          customSidebar={sidebar}
          customSidebarStorageKey="operator-sidebar-collapsed"
          disablePersistentChat
          disableCommandPalette
          showBrokerShare={false}
        >
          <main className="w-full space-y-6">
            <div className="flex justify-end">{toolbar}</div>
            {children}
          </main>
        </AppShell>
      )}
    />
  );
}
