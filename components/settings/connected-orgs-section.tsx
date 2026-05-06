"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Check, Link2, Trash2 } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { useCurrentOrg } from "@/lib/hooks/use-current-org";

type ConnectedOrgsApi = {
  connectedOrgs: {
    listVendors: FunctionReference<"query">;
    listClients: FunctionReference<"query">;
    requestVendorAccess: FunctionReference<"mutation">;
    requestVendorAccessByEmail: FunctionReference<"action">;
    approve: FunctionReference<"mutation">;
    revoke: FunctionReference<"mutation">;
  };
};

const connectedOrgsApi = api as unknown as ConnectedOrgsApi;

type ConnectedOrgRow = {
  _id: string;
  kind?: "relationship" | "invitation";
  relationshipId?: Id<"connectedOrgRelationships">;
  status: "pending" | "active" | "revoked";
  relationshipLabel?: string;
  note?: string;
  updatedAt: number;
  clientOrg?: { _id: Id<"organizations">; name: string; website?: string } | null;
  vendorOrg?: { _id: Id<"organizations">; name: string; website?: string } | null;
  vendorEmail?: string;
};

function StatusBadge({ status }: { status: ConnectedOrgRow["status"] }) {
  const className =
    status === "active"
      ? "border-green-500/15 bg-green-500/8 text-green-700 dark:text-green-300"
      : status === "pending"
        ? "border-amber-500/15 bg-amber-500/8 text-amber-700 dark:text-amber-300"
        : "border-foreground/8 bg-foreground/[0.03] text-muted-foreground";
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}>{status}</span>;
}

function RelationshipCard({
  row,
  side,
  onApprove,
  onRevoke,
}: {
  row: ConnectedOrgRow;
  side: "vendor" | "client";
  onApprove?: (id: Id<"connectedOrgRelationships">) => void;
  onRevoke: (id: Id<"connectedOrgRelationships">) => void;
}) {
  const org = side === "vendor" ? row.vendorOrg : row.clientOrg;
  const displayName = org?.name ?? (side === "vendor" && row.vendorEmail ? row.vendorEmail : "Unknown organization");
  const relationshipId = row.kind === "invitation" ? row.relationshipId : row._id as Id<"connectedOrgRelationships">;
  return (
    <div className="flex items-center justify-between gap-4 border-b border-foreground/6 px-5 py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
          <StatusBadge status={row.status} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {row.relationshipLabel || (side === "vendor" ? "Vendor access" : "Client access")}
          {org?.website ? ` · ${org.website}` : ""}
        </p>
        {row.note ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">{row.note}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {onApprove && row.status === "pending" && relationshipId ? (
          <PillButton size="compact" onClick={() => onApprove(relationshipId)}>
            <Check className="h-3.5 w-3.5" />
            Approve
          </PillButton>
        ) : null}
        {row.status !== "revoked" && relationshipId ? (
          <PillButton size="compact" variant="secondary" onClick={() => onRevoke(relationshipId)}>
            <Trash2 className="h-3.5 w-3.5" />
            Revoke
          </PillButton>
        ) : null}
      </div>
    </div>
  );
}

export function ConnectedOrgsSection() {
  const currentOrg = useCurrentOrg();
  const vendorRows = useQuery(
    connectedOrgsApi.connectedOrgs.listVendors,
    currentOrg?.orgId ? { orgId: currentOrg.orgId } : "skip",
  ) as ConnectedOrgRow[] | undefined;
  const clientRows = useQuery(
    connectedOrgsApi.connectedOrgs.listClients,
    currentOrg?.orgId ? { orgId: currentOrg.orgId } : "skip",
  ) as ConnectedOrgRow[] | undefined;
  const requestVendorAccessByEmail = useAction(connectedOrgsApi.connectedOrgs.requestVendorAccessByEmail);
  const approve = useMutation(connectedOrgsApi.connectedOrgs.approve);
  const revoke = useMutation(connectedOrgsApi.connectedOrgs.revoke);

  const [requestOpen, setRequestOpen] = useState(false);
  const [vendorEmail, setVendorEmail] = useState("");
  const [relationshipLabel, setRelationshipLabel] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { setActions, setRightPanel } = useSettingsActions();

  useEffect(() => {
    setActions(
      <PillButton size="compact" onClick={() => setRequestOpen(true)}>
        <Link2 className="h-3.5 w-3.5" />
        Request vendor
      </PillButton>,
    );
    return () => setActions(null);
  }, [setActions]);

  useEffect(() => {
    async function handleSubmit(event?: FormEvent) {
      event?.preventDefault();
      if (!currentOrg?.orgId) return;
      setSubmitting(true);
      try {
        await requestVendorAccessByEmail({
          clientOrgId: currentOrg.orgId,
          vendorEmail: vendorEmail.trim(),
          relationshipLabel: relationshipLabel.trim() || undefined,
          note: note.trim() || undefined,
        });
        toast.success("Vendor access request sent");
        setVendorEmail("");
        setRelationshipLabel("");
        setNote("");
        setRequestOpen(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not request vendor access");
      } finally {
        setSubmitting(false);
      }
    }

    setRightPanel(
      <SettingsDrawer
        open={requestOpen}
        onOpenChange={setRequestOpen}
        title="Request vendor access"
        footer={
          <>
            <PillButton variant="secondary" disabled={submitting} onClick={() => setRequestOpen(false)}>
              Cancel
            </PillButton>
            <PillButton disabled={submitting || !vendorEmail.trim()} onClick={() => void handleSubmit()}>
              {submitting ? "Requesting…" : "Request access"}
            </PillButton>
          </>
        }
      >
        <form className="space-y-4" onSubmit={handleSubmit}>
          <p className="text-body-sm text-muted-foreground">
            Enter a vendor contact email. If they already have an account, we’ll send the request to their org; otherwise we’ll send an invite link so they can create an account and approve access.
          </p>
          <div>
            <label className="mb-1.5 block text-label-sm font-medium text-muted-foreground">Vendor email</label>
            <input
              value={vendorEmail}
              onChange={(e) => setVendorEmail(e.target.value)}
              placeholder="risk@vendor.com"
              className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm outline-none transition-colors focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-label-sm font-medium text-muted-foreground">Relationship label</label>
            <input
              value={relationshipLabel}
              onChange={(e) => setRelationshipLabel(e.target.value)}
              placeholder="e.g. Required subcontractor coverage"
              className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm outline-none transition-colors focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-label-sm font-medium text-muted-foreground">Note</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder="What insurance information do you need to monitor?"
              className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm outline-none transition-colors focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8"
            />
          </div>
        </form>
      </SettingsDrawer>,
    );
    return () => setRightPanel(null);
  }, [currentOrg?.orgId, note, relationshipLabel, requestOpen, requestVendorAccessByEmail, setRightPanel, submitting, vendorEmail]);

  async function approveRelationship(id: Id<"connectedOrgRelationships">) {
    try {
      await approve({ relationshipId: id });
      toast.success("Connection approved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not approve connection");
    }
  }

  async function revokeRelationship(id: Id<"connectedOrgRelationships">) {
    try {
      await revoke({ relationshipId: id });
      toast.success("Connection revoked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not revoke connection");
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-foreground/6 bg-card">
        <div className="border-b border-foreground/6 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Vendors you can monitor</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Active vendors grant read-only access to their org profile, policies, quotes, and policy-aware agent answers.
            </p>
          </div>
        </div>
        {vendorRows === undefined ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground/70">Loading…</p>
        ) : vendorRows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground/70">No vendor connections yet.</p>
        ) : (
          vendorRows.map((row) => (
            <RelationshipCard key={row._id} row={row} side="vendor" onRevoke={revokeRelationship} />
          ))
        )}
      </section>

      <section className="rounded-xl border border-foreground/6 bg-card">
        <div className="border-b border-foreground/6 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Clients monitoring this org</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Approve requests only when the requesting client should see your insurance record.
            </p>
          </div>
        </div>
        {clientRows === undefined ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground/70">Loading…</p>
        ) : clientRows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground/70">No client access requests.</p>
        ) : (
          clientRows.map((row) => (
            <RelationshipCard
              key={row._id}
              row={row}
              side="client"
              onApprove={approveRelationship}
              onRevoke={revokeRelationship}
            />
          ))
        )}
      </section>
    </div>
  );
}
