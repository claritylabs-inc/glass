"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import dayjs from "dayjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  FileText,
  Link2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { Input } from "@/components/ui/input";
import { PillButton } from "@/components/ui/pill-button";
import { Textarea } from "@/components/ui/textarea";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { useCurrentOrg } from "@/lib/hooks/use-current-org";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";

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
  status: "non_compliant" | "attention" | "no_requirements" | "compliant";
  requirementCount: number;
  policyCount: number;
  metCount: number;
  missingCount: number;
  expiringSoonCount: number;
  checks: VendorComplianceCheck[];
};

type VendorComplianceCheck = {
  requirement: {
    _id: Id<"insuranceRequirements">;
    title: string;
    category: string;
    limit?: string;
    requirementText: string;
  };
  status: "met" | "missing" | "expiring_soon" | "expired";
  expiresAt?: string;
  daysUntilExpiration?: number;
  notes?: string;
  matchedPolicy?: {
    _id: Id<"policies">;
    carrier?: string;
    policyNumber?: string;
    insuredName?: string;
    expectedInsuredName?: string;
    expirationDate?: string;
    coverageName?: string;
    coverageLimit?: string;
    detectedLimitAmount?: number;
  };
};

function VendorStatusBadge({
  row,
  complianceSummary,
}: {
  row: ConnectedOrgRow;
  complianceSummary?: VendorComplianceSummary;
}) {
  if (row.status !== "active") {
    return <Badge variant="secondary">invited</Badge>;
  }
  if (!complianceSummary || complianceSummary.policyCount === 0) {
    return <Badge variant="secondary">waiting on policies</Badge>;
  }
  if (complianceSummary.status === "compliant") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/25 bg-emerald-500/10 text-emerald-500"
      >
        active / compliant
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-red-500/25 bg-red-500/10 text-red-500"
    >
      active / noncompliant
    </Badge>
  );
}

function RelationshipStatusBadge({
  status,
}: {
  status: ConnectedOrgRow["status"];
}) {
  const variant =
    status === "active"
      ? "default"
      : status === "pending"
        ? "secondary"
        : "outline";
  return <Badge variant={variant}>{status}</Badge>;
}

function formatDate(value: string | undefined) {
  if (!value) return "No expiration date";
  const date = dayjs(value);
  if (!date.isValid()) return value;
  return date.format("MMM D, YYYY");
}

function formatMoney(value: number | undefined) {
  if (value === undefined) return undefined;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function ComplianceCheckBadge({
  status,
}: {
  status: VendorComplianceCheck["status"];
}) {
  if (status === "met") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-emerald-500/25 bg-emerald-500/10 text-emerald-500"
      >
        <CheckCircle2 className="h-3 w-3" />
        Met
      </Badge>
    );
  }
  if (status === "expiring_soon") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-amber-500/25 bg-amber-500/10 text-amber-500"
      >
        <AlertCircle className="h-3 w-3" />
        Needs attention
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 border-red-500/25 bg-red-500/10 text-red-500"
    >
      <AlertCircle className="h-3 w-3" />
      Not met
    </Badge>
  );
}

function VendorComplianceChecklist({
  summary,
}: {
  summary: VendorComplianceSummary;
}) {
  if (summary.requirementCount === 0) {
    return (
      <div className="border-t border-foreground/6 px-4 py-4 text-base text-muted-foreground">
        No vendor requirements are configured yet.
      </div>
    );
  }
  return (
    <div className="border-t border-foreground/6">
      {summary.checks.map((check) => {
        const detectedLimit =
          check.matchedPolicy?.coverageLimit ??
          formatMoney(check.matchedPolicy?.detectedLimitAmount);
        return (
          <div
            key={check.requirement._id}
            className="grid gap-3 border-b border-foreground/4 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="truncate text-base font-medium text-foreground">
                  {check.requirement.title}
                </p>
                <ComplianceCheckBadge status={check.status} />
              </div>
              <p className="line-clamp-2 text-label text-muted-foreground">
                {check.requirement.requirementText}
              </p>
              {check.requirement.limit ? (
                <p className="text-label text-muted-foreground/75">
                  Required limit:{" "}
                  <span className="text-foreground">
                    {check.requirement.limit}
                  </span>
                </p>
              ) : null}
            </div>
            <div className="min-w-0 rounded-md border border-foreground/6 bg-background/40 px-3 py-2">
              {check.matchedPolicy ? (
                <div className="space-y-1 text-label text-muted-foreground">
                  <p className="truncate text-foreground">
                    {check.matchedPolicy.carrier ?? "Policy"}{" "}
                    {check.matchedPolicy.policyNumber ?? ""}
                  </p>
                  <p>
                    Coverage:{" "}
                    <span className="text-foreground">
                      {check.matchedPolicy.coverageName ?? "Matched coverage"}
                    </span>
                    {detectedLimit ? (
                      <>
                        {" "}
                        · Limit{" "}
                        <span className="text-foreground">{detectedLimit}</span>
                      </>
                    ) : null}
                  </p>
                  <p>
                    Expires:{" "}
                    <span className="text-foreground">
                      {formatDate(check.matchedPolicy.expirationDate)}
                    </span>
                  </p>
                  <p>
                    Insured:{" "}
                    <span className="text-foreground">
                      {check.matchedPolicy.insuredName ?? "Not detected"}
                    </span>
                    {check.matchedPolicy.expectedInsuredName ? (
                      <>
                        {" "}
                        · Expected{" "}
                        <span className="text-foreground">
                          {check.matchedPolicy.expectedInsuredName}
                        </span>
                      </>
                    ) : null}
                  </p>
                  {check.notes ? (
                    <p className="line-clamp-2 text-muted-foreground/75">
                      {check.notes}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-1 text-label text-muted-foreground">
                  <p className="text-foreground">No matching policy found</p>
                  <p>{check.notes ?? "Upload a matching active policy."}</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
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
  const [expanded, setExpanded] = useState(false);
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
  const showInviteCopy = row.status !== "active";
  return (
    <div className="border-b border-foreground/6 last:border-b-0">
      <div className="flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 sm:flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-base font-medium text-foreground">
              {displayName}
            </p>
            {side === "vendor" ? (
              <VendorStatusBadge
                row={row}
                complianceSummary={complianceSummary}
              />
            ) : (
              <RelationshipStatusBadge status={row.status} />
            )}
          </div>
          {showInviteCopy || org?.website ? (
            <p className="mt-1 text-label text-muted-foreground">
              {showInviteCopy
                ? row.relationshipLabel ||
                  (side === "vendor" ? "Vendor access" : "Client access")
                : null}
              {showInviteCopy && org?.website ? " · " : ""}
              {org?.website ?? ""}
            </p>
          ) : null}
          {showInviteCopy && row.note ? (
            <p className="mt-1 line-clamp-2 text-label text-muted-foreground/80">
              {row.note}
            </p>
          ) : null}
          {side === "vendor" && row.status === "active" && complianceSummary ? (
            <p className="mt-2 text-label text-muted-foreground">
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
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
          {side === "vendor" && row.status === "active" && complianceSummary ? (
            <PillButton
              size="compact"
              variant="secondary"
              onClick={() => setExpanded((value) => !value)}
            >
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
              />
              Checklist
            </PillButton>
          ) : null}
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
            <PillButton
              size="compact"
              onClick={() => onApprove(relationshipId)}
            >
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
      {expanded && complianceSummary ? (
        <VendorComplianceChecklist summary={complianceSummary} />
      ) : null}
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
  const vendorRows = useCachedQuery(
    "connectedOrgs.listVendors",
    connectedOrgsApi.connectedOrgs.listVendors,
    currentOrg?.orgId ? { orgId: currentOrg.orgId } : "skip",
  ) as ConnectedOrgRow[] | undefined;
  const clientRows = useCachedQuery(
    "connectedOrgs.listClients",
    connectedOrgsApi.connectedOrgs.listClients,
    currentOrg?.orgId ? { orgId: currentOrg.orgId } : "skip",
  ) as ConnectedOrgRow[] | undefined;
  const vendorCompliance = useCachedQuery(
    "compliance.listVendorCompliance",
    connectedOrgsApi.compliance.listVendorCompliance,
    currentOrg?.orgId ? { clientOrgId: currentOrg.orgId } : "skip",
  ) as VendorComplianceSummary[] | undefined;
  const updateVendorRows = useUpdateCachedQuery<
    ConnectedOrgRow[],
    { orgId: Id<"organizations"> }
  >("connectedOrgs.listVendors");
  const updateClientRows = useUpdateCachedQuery<
    ConnectedOrgRow[],
    { orgId: Id<"organizations"> }
  >("connectedOrgs.listClients");
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
          <p className="text-base text-muted-foreground">
            Enter a vendor contact email. If they already have an account, we’ll
            send the request to their org; otherwise we’ll send an invite link
            so they can create an account and approve access.
          </p>
          <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
            Vendor email
            <Input
              value={vendorEmail}
              onChange={(e) => setVendorEmail(e.target.value)}
              placeholder="risk@vendor.com"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
            Relationship label
            <Input
              value={relationshipLabel}
              onChange={(e) => setRelationshipLabel(e.target.value)}
              placeholder="e.g. Required subcontractor coverage"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-label font-medium text-muted-foreground">
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
      const updateRows = page === "vendors" ? updateVendorRows : updateClientRows;
      if (currentOrg?.orgId) {
        await updateRows({ orgId: currentOrg.orgId }, (current) =>
          current.map((row) =>
            row.relationshipId === id || row._id === id
              ? {
                  ...row,
                  status: "active",
                  invitationStatus: row.invitationStatus === "pending"
                    ? "accepted"
                    : row.invitationStatus,
                  updatedAt: dayjs().valueOf(),
                }
              : row,
          ),
        );
      }
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
      const updateRows = page === "vendors" ? updateVendorRows : updateClientRows;
      if (currentOrg?.orgId) {
        await updateRows({ orgId: currentOrg.orgId }, (current) =>
          current.map((row) =>
            row.relationshipId === id || row._id === id
              ? {
                  ...row,
                  status: "revoked",
                  invitationStatus: row.invitationStatus === "pending"
                    ? "revoked"
                    : row.invitationStatus,
                  updatedAt: dayjs().valueOf(),
                }
              : row,
          ),
        );
      }
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

  if (
    rows === undefined ||
    (page === "vendors" && vendorCompliance === undefined)
  ) {
    return <div className="min-h-32" aria-hidden="true" />;
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
    <OperationalPanel as="div">
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
    </OperationalPanel>
  );
}
