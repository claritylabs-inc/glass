"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Check, FileText, Link2, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { Input } from "@/components/ui/input";
import { PillButton } from "@/components/ui/pill-button";
import { Textarea } from "@/components/ui/textarea";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { useCurrentOrg } from "@/lib/hooks/use-current-org";

type ConnectedOrgsApi = {
  connectedOrgs: {
    listVendors: FunctionReference<"query">;
    listClients: FunctionReference<"query">;
    requestVendorAccess: FunctionReference<"mutation">;
    requestVendorAccessByEmail: FunctionReference<"action">;
    resendVendorInvitation: FunctionReference<"action">;
    approve: FunctionReference<"mutation">;
    revoke: FunctionReference<"mutation">;
  };
  compliance: {
    listVendorCompliance: FunctionReference<"query">;
  };
};

const connectedOrgsApi = api as unknown as ConnectedOrgsApi;

export type ConnectedOrgsPageKind = "clients" | "vendors";

type ConnectedOrgRow = {
  _id: string;
  kind?: "relationship" | "invitation";
  invitationId?: Id<"connectedOrgInvitations">;
  invitationStatus?: "pending" | "accepted" | "expired" | "revoked";
  relationshipId?: Id<"connectedOrgRelationships">;
  status: "pending" | "active" | "expired" | "revoked";
  relationshipLabel?: string;
  note?: string;
  updatedAt: number;
  clientOrg?: {
    _id: Id<"organizations">;
    name: string;
    website?: string;
  } | null;
  vendorOrg?: {
    _id: Id<"organizations">;
    name: string;
    website?: string;
  } | null;
  vendorEmail?: string;
};

type VendorComplianceSummary = {
  relationshipId: Id<"connectedOrgRelationships">;
  status:
    | "non_compliant"
    | "attention"
    | "no_requirements"
    | "compliant";
  requirementCount: number;
  metCount: number;
  missingCount: number;
  expiringSoonCount: number;
};

function StatusBadge({ status }: { status: ConnectedOrgRow["status"] }) {
  const variant =
    status === "active"
      ? "default"
      : status === "pending"
        ? "secondary"
        : "outline";
  return <Badge variant={variant}>{status}</Badge>;
}

function RelationshipCard({
  row,
  side,
  onApprove,
  onResend,
  resending,
  onRevoke,
  complianceSummary,
  onViewPolicies,
}: {
  row: ConnectedOrgRow;
  side: "vendor" | "client";
  onApprove?: (id: Id<"connectedOrgRelationships">) => void;
  onResend?: (row: ConnectedOrgRow) => void;
  resending?: boolean;
  onRevoke: (id: Id<"connectedOrgRelationships">) => void;
  complianceSummary?: VendorComplianceSummary;
  onViewPolicies?: (vendorOrgId: Id<"organizations">) => void;
}) {
  const org = side === "vendor" ? row.vendorOrg : row.clientOrg;
  const displayName =
    org?.name ??
    (side === "vendor" && row.vendorEmail
      ? row.vendorEmail
      : "Unknown organization");
  const relationshipId =
    row.kind === "invitation"
      ? row.relationshipId
      : (row._id as Id<"connectedOrgRelationships">);
  return (
    <div className="flex items-center justify-between gap-4 border-b border-foreground/6 px-4 py-3 last:border-b-0 hover:bg-muted/50 transition-colors">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">
            {displayName}
          </p>
          <StatusBadge status={row.status} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {row.relationshipLabel ||
            (side === "vendor" ? "Vendor access" : "Client access")}
          {org?.website ? ` · ${org.website}` : ""}
        </p>
        {row.note ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">
            {row.note}
          </p>
        ) : null}
        {side === "vendor" && row.status === "active" && complianceSummary ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {complianceSummary.requirementCount === 0
              ? "No vendor requirements configured"
              : `${complianceSummary.metCount}/${complianceSummary.requirementCount} requirements met`}
            {complianceSummary.missingCount > 0
              ? ` · ${complianceSummary.missingCount} missing`
              : ""}
            {complianceSummary.expiringSoonCount > 0
              ? ` · ${complianceSummary.expiringSoonCount} expiring soon`
              : ""}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {side === "vendor" &&
        row.status === "active" &&
        row.vendorOrg?._id &&
        onViewPolicies ? (
          <PillButton
            size="compact"
            variant="secondary"
            onClick={() => onViewPolicies(row.vendorOrg!._id)}
          >
            <FileText className="h-3.5 w-3.5" />
            Policies
          </PillButton>
        ) : null}
        {onResend &&
        (row.invitationId || row.kind === "invitation") &&
        (row.status === "pending" ||
          row.status === "expired" ||
          row.invitationStatus === "pending" ||
          row.invitationStatus === "expired") ? (
          <PillButton
            size="compact"
            variant="secondary"
            disabled={resending}
            onClick={() => onResend(row)}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${resending ? "animate-spin" : ""}`}
            />
            Resend
          </PillButton>
        ) : null}
        {onApprove && row.status === "pending" && relationshipId ? (
          <PillButton size="compact" onClick={() => onApprove(relationshipId)}>
            <Check className="h-3.5 w-3.5" />
            Approve
          </PillButton>
        ) : null}
        {row.status !== "revoked" && relationshipId ? (
          <PillButton
            size="compact"
            variant="secondary"
            onClick={() => onRevoke(relationshipId)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Revoke
          </PillButton>
        ) : null}
      </div>
    </div>
  );
}

export function ConnectedOrgsSection({
  page = "vendors",
}: {
  page?: ConnectedOrgsPageKind;
}) {
  const router = useRouter();
  const currentOrg = useCurrentOrg();
  const vendorRows = useQuery(
    connectedOrgsApi.connectedOrgs.listVendors,
    currentOrg?.orgId ? { orgId: currentOrg.orgId } : "skip",
  ) as ConnectedOrgRow[] | undefined;
  const clientRows = useQuery(
    connectedOrgsApi.connectedOrgs.listClients,
    currentOrg?.orgId ? { orgId: currentOrg.orgId } : "skip",
  ) as ConnectedOrgRow[] | undefined;
  const vendorCompliance = useQuery(
    connectedOrgsApi.compliance.listVendorCompliance,
    currentOrg?.orgId ? { clientOrgId: currentOrg.orgId } : "skip",
  ) as VendorComplianceSummary[] | undefined;
  const requestVendorAccessByEmail = useAction(
    connectedOrgsApi.connectedOrgs.requestVendorAccessByEmail,
  );
  const resendVendorInvitation = useAction(
    connectedOrgsApi.connectedOrgs.resendVendorInvitation,
  );
  const approve = useMutation(connectedOrgsApi.connectedOrgs.approve);
  const revoke = useMutation(connectedOrgsApi.connectedOrgs.revoke);

  const [requestOpen, setRequestOpen] = useState(false);
  const [vendorEmail, setVendorEmail] = useState("");
  const [relationshipLabel, setRelationshipLabel] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resendingInvitationId, setResendingInvitationId] = useState<
    string | null
  >(null);
  const { setActions, setRightPanel } = useSettingsActions();

  useEffect(() => {
    setActions(
      page === "vendors" ? (
        <PillButton
          size="compact"
          variant="secondary"
          onClick={() => setRequestOpen(true)}
        >
          <Link2 className="h-3.5 w-3.5" />
          Add Vendor
        </PillButton>
      ) : null,
    );
    return () => setActions(null);
  }, [page, setActions]);

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
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not request vendor access",
        );
      } finally {
        setSubmitting(false);
      }
    }

    setRightPanel(
      <SettingsDrawer
        open={requestOpen}
        onOpenChange={setRequestOpen}
        title="Add Vendor"
        footer={
          <>
            <PillButton
              variant="secondary"
              disabled={submitting}
              onClick={() => setRequestOpen(false)}
            >
              Cancel
            </PillButton>
            <PillButton
              disabled={submitting || !vendorEmail.trim()}
              onClick={() => void handleSubmit()}
            >
              {submitting ? "Requesting…" : "Request access"}
            </PillButton>
          </>
        }
      >
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <p className="text-body-sm text-muted-foreground">
            Enter a vendor contact email. If they already have an account, we’ll
            send the request to their org; otherwise we’ll send an invite link
            so they can create an account and approve access.
          </p>
          <label className="flex flex-col gap-1.5 text-label-sm font-medium text-muted-foreground">
            Vendor email
            <Input
              value={vendorEmail}
              onChange={(e) => setVendorEmail(e.target.value)}
              placeholder="risk@vendor.com"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-label-sm font-medium text-muted-foreground">
            Relationship label
            <Input
              value={relationshipLabel}
              onChange={(e) => setRelationshipLabel(e.target.value)}
              placeholder="e.g. Required subcontractor coverage"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-label-sm font-medium text-muted-foreground">
            Note
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder="What insurance information do you need to monitor?"
            />
          </label>
        </form>
      </SettingsDrawer>,
    );
    return () => setRightPanel(null);
  }, [
    currentOrg?.orgId,
    note,
    relationshipLabel,
    requestOpen,
    requestVendorAccessByEmail,
    setRightPanel,
    submitting,
    vendorEmail,
  ]);

  async function approveRelationship(id: Id<"connectedOrgRelationships">) {
    try {
      await approve({ relationshipId: id });
      toast.success("Connection approved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not approve connection",
      );
    }
  }

  async function revokeRelationship(id: Id<"connectedOrgRelationships">) {
    try {
      await revoke({ relationshipId: id });
      toast.success("Connection revoked");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not revoke connection",
      );
    }
  }

  async function resendInvitation(row: ConnectedOrgRow) {
    const invitationId =
      row.invitationId ??
      (row.kind === "invitation"
        ? (row._id as Id<"connectedOrgInvitations">)
        : null);
    if (!invitationId) return;
    setResendingInvitationId(row._id);
    try {
      await resendVendorInvitation({
        invitationId,
      });
      toast.success("Vendor invite resent");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not resend invite",
      );
    } finally {
      setResendingInvitationId(null);
    }
  }

  const rows = page === "vendors" ? vendorRows : clientRows;
  const complianceByRelationshipId = new Map(
    (vendorCompliance ?? []).map((summary) => [
      summary.relationshipId,
      summary,
    ]),
  );
  function relationshipIdForSummary(row: ConnectedOrgRow) {
    if (row.relationshipId) return row.relationshipId;
    if (row.kind === "relationship") {
      return row._id as Id<"connectedOrgRelationships">;
    }
    return null;
  }

  if (rows === undefined || (page === "vendors" && vendorCompliance === undefined)) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground/60">
        Loading…
      </p>
    );
  }

  if (rows.length === 0) {
    return page === "vendors" ? (
      <EmptyStateCard
        title="No vendors yet"
        description="Request access from a vendor to monitor their insurance records against your standards."
        actionLabel="Add Vendor"
        onAction={() => setRequestOpen(true)}
      />
    ) : (
      <EmptyStateCard
        title="No clients yet"
        description="Clients you report insurance requirements to will appear here when they ask to monitor your records."
      />
    );
  }

  return (
    <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
      {rows.map((row) => (
        <RelationshipCard
          key={row._id}
          row={row}
          side={page === "vendors" ? "vendor" : "client"}
          onApprove={page === "clients" ? approveRelationship : undefined}
          onResend={page === "vendors" ? resendInvitation : undefined}
          resending={resendingInvitationId === row._id}
          onRevoke={revokeRelationship}
          complianceSummary={
            page === "vendors"
              ? ((): VendorComplianceSummary | undefined => {
                  const relationshipId = relationshipIdForSummary(row);
                  return relationshipId
                    ? complianceByRelationshipId.get(relationshipId)
                    : undefined;
                })()
              : undefined
          }
          onViewPolicies={
            page === "vendors"
              ? (vendorOrgId) =>
                  router.push(`/connect/vendors/${vendorOrgId}/policies`)
              : undefined
          }
        />
      ))}
    </div>
  );
}
