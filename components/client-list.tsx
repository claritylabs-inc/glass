"use client";

import type { FunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { UserPlus } from "lucide-react";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { ClientListRow, type ClientRow } from "@/components/client-list-row";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

type ClientListStatus = "draft" | "invited" | "onboarding" | "active";

type ClientsApi = {
  clients: {
    listForBroker: FunctionReference<"query">;
  };
};

const clientsApi = api as unknown as ClientsApi;

type ClientListRecord = {
  invitationId?: Id<"clientInvitations">;
  clientOrgId?: Id<"organizations">;
  name: string;
  website?: string;
  iconUrl?: string | null;
  primaryContactName?: string;
  primaryContactEmail?: string;
  onboardingStatus: ClientListStatus;
  createdAt: number;
  lastActivityAt?: number;
  activePoliciesCount?: number;
  primaryBrokerContactId?: Id<"users">;
};

export function ClientList({
  partnerOrgId,
  onInvite,
  onResumeDraft,
}: {
  partnerOrgId: Id<"organizations">;
  onInvite: () => void;
  onResumeDraft: (clientOrgId: Id<"organizations">) => void;
}) {
  const rows = useCachedQuery(
    "clients.listForBroker",
    clientsApi.clients.listForBroker,
    {
      brokerOrgId: partnerOrgId,
    },
  ) as ClientListRecord[] | undefined;
  const brokerMembers = useCachedQuery(
    "orgs.listMembers",
    api.orgs.listMembers,
    {},
  );

  function toClientRow(r: ClientListRecord): ClientRow {
    // Legacy pending invite (no clientOrgId yet)
    if (r.onboardingStatus === "invited" && r.invitationId && !r.clientOrgId) {
      return {
        kind: "invite",
        partnerOrgId,
        invitationId: r.invitationId as Id<"clientInvitations">,
        name: r.name,
        website: r.website,
        iconUrl: r.iconUrl,
        primaryContactName: r.primaryContactName,
        primaryContactEmail: r.primaryContactEmail,
        onboardingStatus: "invited",
        createdAt: r.createdAt,
      };
    }
    // Draft or invited (backed by a draft client org)
    if (r.onboardingStatus === "draft" || r.onboardingStatus === "invited") {
      return {
        kind: "draft",
        partnerOrgId,
        clientOrgId: r.clientOrgId as Id<"organizations">,
        name: r.name,
        website: r.website,
        iconUrl: r.iconUrl,
        primaryContactName: r.primaryContactName,
        primaryContactEmail: r.primaryContactEmail,
        onboardingStatus: r.onboardingStatus as "draft" | "invited",
        createdAt: r.createdAt,
        activePoliciesCount: r.activePoliciesCount ?? 0,
        onResume: onResumeDraft,
      };
    }
    return {
      kind: "client",
      clientOrgId: r.clientOrgId as Id<"organizations">,
      name: r.name,
      website: r.website,
      iconUrl: r.iconUrl,
      primaryContactName: r.primaryContactName,
      primaryContactEmail: r.primaryContactEmail,
      onboardingStatus: r.onboardingStatus as "onboarding" | "active",
      createdAt: r.createdAt,
      lastActivityAt: r.lastActivityAt,
      activePoliciesCount: r.activePoliciesCount ?? 0,
      primaryBrokerContactId: r.primaryBrokerContactId,
      brokerMembers: brokerMembers ?? [],
    };
  }

  return (
    <div className="flex flex-col gap-4">
      {rows === undefined ? (
        <div className="min-h-32" aria-hidden="true" />
      ) : rows.length === 0 ? (
        <EmptyStateCard
          icon={<UserPlus className="w-5 h-5" />}
          title="No clients yet"
          description="Invite your first client to start managing their policies and documents in one place."
          actionLabel="Invite client"
          onAction={onInvite}
        />
      ) : (
        <OperationalPanel as="div">
          {rows.map((row) => {
            const mapped = toClientRow(row);
            const key =
              mapped.kind === "invite"
                ? `invite-${mapped.invitationId}`
                : `client-${mapped.clientOrgId}`;
            return <ClientListRow key={key} row={mapped} />;
          })}
        </OperationalPanel>
      )}
    </div>
  );
}
