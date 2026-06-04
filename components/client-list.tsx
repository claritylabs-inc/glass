"use client";

import { useState, useMemo } from "react";
import type { FunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserPlus } from "lucide-react";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { ClientListRow, type ClientRow } from "@/components/client-list-row";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

type StatusFilter = "all" | "draft" | "invited" | "onboarding" | "active";
type ClientListStatus = Exclude<StatusFilter, "all">;

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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "draft", label: "Draft" },
    { id: "invited", label: "Invited" },
    { id: "onboarding", label: "Onboarding" },
    { id: "active", label: "Active" },
  ];

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    let result = rows;
    if (statusFilter !== "all") {
      result = result.filter((r) => r.onboardingStatus === statusFilter);
    }
    return result;
  }, [rows, statusFilter]);

  function toClientRow(r: ClientListRecord): ClientRow {
    // Legacy pending invite (no clientOrgId yet)
    if (r.onboardingStatus === "invited" && r.invitationId && !r.clientOrgId) {
      return {
        kind: "invite",
        partnerOrgId,
        invitationId: r.invitationId as Id<"clientInvitations">,
        name: r.name,
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as StatusFilter)}
        >
          <TabsList variant="pill">
            {STATUS_FILTERS.map((f) => (
              <TabsTrigger key={f.id} value={f.id}>
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {rows === undefined ? (
        <div className="min-h-32" aria-hidden="true" />
      ) : filteredRows.length === 0 ? (
        rows.length === 0 ? (
          <EmptyStateCard
            icon={<UserPlus className="w-5 h-5" />}
            title="No clients yet"
            description="Invite your first client to start managing their policies and documents in one place."
            actionLabel="Invite client"
            onAction={onInvite}
          />
        ) : (
          <EmptyStateCard
            title="No clients match this filter"
            description="Try a different status filter to see more clients."
          />
        )
      ) : (
        <OperationalPanel as="div">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {filteredRows.map((row: any) => {
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
