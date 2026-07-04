"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { AgentContactCallout } from "@/components/agent-contact-callout";
import { AppShell } from "@/components/app-shell";
import {
  BrokerIdentitySection,
  type BrokerIdentity,
} from "@/components/settings/broker-identity-section";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

function displayValue(value?: string) {
  return value?.trim() || "Not set";
}

function relationshipLabel(identity: BrokerIdentity) {
  if (identity.source === "assignment") {
    return identity.connected ? "Assigned" : "External broker contact";
  }
  if (identity.connected) return "Connected broker";
  return "No broker contact";
}

export default function BrokerPage() {
  const router = useRouter();
  const currentOrg = useCurrentOrg();
  const [editOpen, setEditOpen] = useState(false);
  const brokerPageContext = useCachedQuery(
    "orgs.getBrokerPageContext",
    api.orgs.getBrokerPageContext,
    {},
  );
  const identity = useCachedQuery(
    "orgs.getBrokerIdentity",
    api.orgs.getBrokerIdentity,
    currentOrg?.orgId ? { orgId: currentOrg.orgId } : "skip",
  ) as BrokerIdentity | null | undefined;

  useEffect(() => {
    if (brokerPageContext && !brokerPageContext.showBrokerPage) {
      router.replace("/policies");
    }
  }, [brokerPageContext, router]);

  const canEdit = !!identity?.canEdit;
  const brokerName = identity?.brokerCompanyName?.trim();
  const contactName = identity?.contactName?.trim();
  const contactEmail = identity?.contactEmail?.trim();
  const contactPhone = identity?.contactPhone?.trim();
  const fallbackAgentHandle =
    (currentOrg?.org as { agentHandle?: string } | undefined)?.agentHandle ??
    null;
  const hasBrokerInfo = !!(
    brokerName ||
    contactName ||
    contactEmail ||
    contactPhone
  );

  if (!currentOrg?.orgId || !brokerPageContext?.showBrokerPage) return null;

  const breadcrumbDetail =
    identity === undefined ? undefined : brokerName || "No broker contact";
  const actions = canEdit ? (
    <PillButton
      variant="secondary"
      size="compact"
      onClick={() => setEditOpen(true)}
    >
      <Pencil className="h-3.5 w-3.5" />
      Edit
    </PillButton>
  ) : null;

  return (
    <AppShell
      actions={actions}
      breadcrumbDetail={breadcrumbDetail}
      rightPanel={
        <SettingsDrawer
          open={editOpen}
          onOpenChange={setEditOpen}
          title="Edit broker contact"
        >
          <BrokerIdentitySection orgId={currentOrg.orgId} surface="plain" />
        </SettingsDrawer>
      }
    >
      {identity === undefined ? (
        <div className="min-h-32" aria-hidden="true" />
      ) : (
        <div className="w-full space-y-5">
          <AgentContactCallout
            broker={currentOrg.brokerOrg ?? null}
            fallbackAgentHandle={fallbackAgentHandle}
            className="mb-0"
            dismissKey="glass:agent-contact-callout:broker"
          />

          <OperationalPanel>
            <Table className="min-w-[880px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[22%] px-4 text-label text-muted-foreground">
                    Broker company
                  </TableHead>
                  <TableHead className="w-[22%] text-label text-muted-foreground">
                    Primary contact
                  </TableHead>
                  <TableHead className="w-[24%] text-label text-muted-foreground">
                    Email
                  </TableHead>
                  <TableHead className="w-[18%] text-label text-muted-foreground">
                    Phone
                  </TableHead>
                  <TableHead className="w-[14%] pr-4 text-label text-muted-foreground">
                    Relationship
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="hover:bg-transparent">
                  <TableCell className="px-4 py-4 text-base font-medium text-foreground">
                    {displayValue(brokerName)}
                  </TableCell>
                  <TableCell className="py-4 text-base text-foreground">
                    {displayValue(contactName)}
                  </TableCell>
                  <TableCell className="py-4 text-base">
                    {contactEmail ? (
                      <a
                        href={`mailto:${contactEmail}`}
                        className="text-foreground underline-offset-4 hover:underline"
                      >
                        {contactEmail}
                      </a>
                    ) : (
                      <span className="text-muted-foreground/60">Not set</span>
                    )}
                  </TableCell>
                  <TableCell className="py-4 text-base">
                    {contactPhone ? (
                      <a
                        href={`tel:${contactPhone}`}
                        className="text-foreground underline-offset-4 hover:underline"
                      >
                        {contactPhone}
                      </a>
                    ) : (
                      <span className="text-muted-foreground/60">Not set</span>
                    )}
                  </TableCell>
                  <TableCell className="py-4 pr-4 text-base text-muted-foreground">
                    {identity ? relationshipLabel(identity) : "Broker"}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </OperationalPanel>

          {!hasBrokerInfo && canEdit ? (
            <div className="border-t border-foreground/6 pt-5">
              <PillButton
                variant="primary"
                size="compact"
                onClick={() => setEditOpen(true)}
              >
                Add broker contact
              </PillButton>
            </div>
          ) : null}
        </div>
      )}
    </AppShell>
  );
}
