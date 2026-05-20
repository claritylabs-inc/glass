"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { useQuery } from "convex/react";
import { AgentContactCallout } from "@/components/agent-contact-callout";
import { AppShell } from "@/components/app-shell";
import {
  BrokerIdentitySection,
  type BrokerIdentity,
} from "@/components/settings/broker-identity-section";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
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

function displayValue(value?: string) {
  return value?.trim() || "Not set";
}

function relationshipLabel(identity: BrokerIdentity) {
  if (identity.connected) return "Connected broker";
  if (identity.source === "manual") return "Broker contact";
  return "No broker contact";
}

export default function BrokerPage() {
  const router = useRouter();
  const currentOrg = useCurrentOrg();
  const [editOpen, setEditOpen] = useState(false);
  const brokerPageContext = useQuery(api.orgs.getBrokerPageContext, {});
  const identity = useQuery(
    api.orgs.getBrokerIdentity,
    currentOrg?.orgId ? { orgId: currentOrg.orgId } : "skip",
  ) as BrokerIdentity | null | undefined;

  useEffect(() => {
    if (brokerPageContext && !brokerPageContext.showBrokerPage) {
      router.replace("/policies");
    }
  }, [brokerPageContext, router]);

  const canEdit = !!(identity?.canEditManual || identity?.canEditConnected);
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
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="w-full space-y-5">
          <AgentContactCallout
            broker={currentOrg.brokerOrg ?? null}
            fallbackAgentHandle={fallbackAgentHandle}
            className="mb-0"
          />

          <section className="w-full overflow-hidden rounded-lg border border-foreground/6 bg-card">
            <Table className="min-w-[880px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[22%] px-4 text-label-sm text-muted-foreground">
                    Broker company
                  </TableHead>
                  <TableHead className="w-[22%] text-label-sm text-muted-foreground">
                    Primary contact
                  </TableHead>
                  <TableHead className="w-[24%] text-label-sm text-muted-foreground">
                    Email
                  </TableHead>
                  <TableHead className="w-[18%] text-label-sm text-muted-foreground">
                    Phone
                  </TableHead>
                  <TableHead className="w-[14%] pr-4 text-label-sm text-muted-foreground">
                    Relationship
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="hover:bg-transparent">
                  <TableCell className="px-4 py-4 text-body-sm font-medium text-foreground">
                    {displayValue(brokerName)}
                  </TableCell>
                  <TableCell className="py-4 text-body-sm text-foreground">
                    {displayValue(contactName)}
                  </TableCell>
                  <TableCell className="py-4 text-body-sm">
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
                  <TableCell className="py-4 text-body-sm">
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
                  <TableCell className="py-4 pr-4 text-body-sm text-muted-foreground">
                    {identity ? relationshipLabel(identity) : "Broker"}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </section>

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
