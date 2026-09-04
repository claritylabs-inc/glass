"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { OperatorPageContextRegistration } from "@/components/operator-agent/operator-page-context";
import { CompanyWikiSection } from "@/components/settings/company-wiki-section";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import type { Id } from "@/convex/_generated/dataModel";
import {
  useCachedOperatorClients,
  useCachedOperatorCurrent,
} from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { OperatorClientSidebar } from "../operator-client-sidebar";

export default function OperatorClientWikiPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const current = useCachedOperatorCurrent();
  const clients = useCachedOperatorClients();
  const client = clients?.find((row) => row._id === clientOrgId) ?? null;
  const [workspaceActions, setWorkspaceActions] = useState<ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);
  const activeImpersonation = current?.activeImpersonation ?? null;

  return (
    <AppShell
      actions={workspaceActions}
      breadcrumbDetail={
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
          <span className="truncate">Company wiki</span>
        </span>
      }
      rightPanel={rightPanel}
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorClientSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          clientOrgId={clientOrgId}
          activeImpersonation={activeImpersonation}
          impersonationDisabled={!client}
        />
      )}
      customSidebarStorageKey="operator-sidebar"
      disablePersistentChat
      disableCommandPalette
      showBrokerShare={false}
    >
      <OperatorPageContextRegistration
        context={{
          pageType: "operator_client_wiki",
          entityId: clientOrgId,
          summary: client
            ? `Company wiki for ${client.name}`
            : "Current client company wiki",
        }}
      />
      {clients === undefined ? (
        <OperationalPanel>
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        </OperationalPanel>
      ) : !client ? (
        <OperationalPanel>
          <OperationalPanelHeader title="Client not found" />
          <OperationalPanelBody>
            <PillButton href="/operator/clients" variant="secondary">
              Back to clients
            </PillButton>
          </OperationalPanelBody>
        </OperationalPanel>
      ) : (
        <main className="w-full space-y-6">
          <CompanyWikiSection
            clientOrgId={clientOrgId as Id<"organizations">}
            operator
            readOnly={Boolean(activeImpersonation)}
            onActions={setWorkspaceActions}
            onRightPanel={setRightPanel}
          />
        </main>
      )}
    </AppShell>
  );
}
