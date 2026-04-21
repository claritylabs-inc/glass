"use client";

import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserPlus } from "lucide-react";
import { ClientListRow, type ClientRow } from "@/components/client-list-row";
import { InviteClientDrawer } from "@/components/invite-client-drawer";

type StatusFilter = "all" | "invited" | "onboarding" | "active";

export function ClientList({ brokerOrgId }: { brokerOrgId: Id<"organizations"> }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = useQuery((api as any).clients.listForBroker, { brokerOrgId }) as any[] | undefined;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);

  const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
    { id: "all", label: "All" },
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
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.primaryContactName?.toLowerCase().includes(q) ?? false) ||
          (r.primaryContactEmail?.toLowerCase().includes(q) ?? false),
      );
    }
    return result;
  }, [rows, statusFilter, searchQuery]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function toClientRow(r: any): ClientRow {
    if (r.onboardingStatus === "invited") {
      return {
        kind: "invite",
        brokerOrgId,
        invitationId: r.invitationId as Id<"clientInvitations">,
        name: r.name,
        primaryContactName: r.primaryContactName,
        primaryContactEmail: r.primaryContactEmail,
        onboardingStatus: "invited",
        createdAt: r.createdAt,
        lastActivityAt: undefined,
        openApplicationsCount: 0,
        activePoliciesCount: 0,
        documentsCount: 0,
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
      openApplicationsCount: r.openApplicationsCount,
      activePoliciesCount: r.activePoliciesCount,
      documentsCount: r.documentsCount,
    };
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2 flex-wrap">
          {STATUS_FILTERS.map((f) => (
            <Badge
              key={f.id}
              variant={statusFilter === f.id ? "default" : "outline"}
              className="cursor-pointer select-none"
              onClick={() => setStatusFilter(f.id)}
            >
              {f.label}
            </Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Search clients…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-48"
          />
          <Button onClick={() => setInviteOpen(true)} size="sm">
            <UserPlus className="w-4 h-4 mr-1" />
            Invite client
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="rounded-lg border bg-card">
        {rows === undefined ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {rows.length === 0
              ? "No clients yet. Invite your first client to get started."
              : "No clients match your filter."}
          </div>
        ) : (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          filteredRows.map((row: any) => (
            <ClientListRow
              key={
                row.onboardingStatus === "invited"
                  ? `invite-${row.invitationId}`
                  : `client-${row.clientOrgId}`
              }
              row={toClientRow(row)}
            />
          ))
        )}
      </div>

      <InviteClientDrawer
        brokerOrgId={brokerOrgId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />
    </div>
  );
}
