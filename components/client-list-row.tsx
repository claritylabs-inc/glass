"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { PillButton } from "@/components/ui/pill-button";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";

export type ClientRow =
  | {
      kind: "client";
      clientOrgId: Id<"organizations">;
      name: string;
      primaryContactName?: string;
      primaryContactEmail?: string;
      onboardingStatus: "onboarding" | "active";
      createdAt: number;
      lastActivityAt?: number;
      activePoliciesCount: number;
      primaryBrokerContactId?: Id<"users">;
      brokerMembers: Array<{
        userId: Id<"users">;
        name?: string;
        email?: string;
      }>;
    }
  | {
      kind: "draft";
      clientOrgId: Id<"organizations">;
      name: string;
      primaryContactName?: string;
      primaryContactEmail?: string;
      onboardingStatus: "draft" | "invited";
      createdAt: number;
      activePoliciesCount: number;
      onResume: (clientOrgId: Id<"organizations">) => void;
    }
  | {
      kind: "invite";
      partnerOrgId: Id<"organizations">;
      invitationId: Id<"clientInvitations">;
      name: string;
      primaryContactName?: string;
      primaryContactEmail?: string;
      onboardingStatus: "invited";
      createdAt: number;
    };

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  invited: "Invited",
  onboarding: "Onboarding",
  active: "Active",
};

const STATUS_VARIANTS: Record<string, "secondary" | "outline" | "default"> = {
  draft: "outline",
  invited: "outline",
  onboarding: "secondary",
  active: "default",
};

export function ClientListRow({ row }: { row: ClientRow }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revokeInvite = useMutation((api as any).clientInvitations.revoke);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deleteDraft = useMutation((api as any).clientInvitations.deleteDraftClient);

  const rowClass =
    "flex items-center gap-4 px-4 py-3 border-b border-foreground/6 last:border-0 hover:bg-muted/50 transition-colors";

  const nameBlock = (
    <div className="flex-1 min-w-0">
      <div className="flex flex-col gap-0.5 md:flex-row md:items-center md:gap-2">
        <p className="text-sm font-medium text-foreground truncate">{row.name}</p>
        <p className="text-sm text-muted-foreground truncate">
          {row.kind === "client"
            ? (row.primaryContactName ?? "No primary contact")
            : (row.primaryContactEmail ?? "No email")}
        </p>
      </div>
    </div>
  );

  const badge = (
    <Badge variant={STATUS_VARIANTS[row.onboardingStatus]} className="shrink-0">
      {STATUS_LABELS[row.onboardingStatus]}
    </Badge>
  );

  const timestamp = (label: string) => (
    <span className="hidden sm:block text-xs text-muted-foreground shrink-0 whitespace-nowrap tabular-nums">
      {label}
    </span>
  );

  if (row.kind === "invite") {
    return (
      <div className={rowClass}>
        {nameBlock}
        {badge}
        {timestamp(formatDistanceToNow(new Date(row.createdAt), { addSuffix: true }))}
        <PillButton
          type="button"
          size="compact"
          variant="destructive"
          className="shrink-0"
          onClick={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await revokeInvite({ invitationId: row.invitationId, orgId: row.partnerOrgId });
            toast.success("Invite revoked");
          }}
        >
          Delete
        </PillButton>
      </div>
    );
  }

  if (row.kind === "draft") {
    return (
      <div className={rowClass}>
        {nameBlock}
        {badge}
        {timestamp(formatDistanceToNow(new Date(row.createdAt), { addSuffix: true }))}
        <PillButton
          type="button"
          size="compact"
          variant="secondary"
          className="shrink-0"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            row.onResume(row.clientOrgId);
          }}
        >
          {row.onboardingStatus === "draft" ? "Resume" : "View"}
        </PillButton>
        <PillButton
          type="button"
          size="compact"
          variant="destructive"
          className="shrink-0"
          onClick={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!confirm(`Delete ${row.name}? This cannot be undone.`)) return;
            try {
              await deleteDraft({ clientOrgId: row.clientOrgId });
              toast.success("Deleted");
            } catch (err) {
              toast.error(String(err));
            }
          }}
        >
          Delete
        </PillButton>
      </div>
    );
  }

  const activityLabel = row.lastActivityAt
    ? formatDistanceToNow(new Date(row.lastActivityAt), { addSuffix: true })
    : "No activity yet";
  const brokerContact = row.brokerMembers.find(
    (member) => member.userId === row.primaryBrokerContactId,
  );
  const brokerContactLabel =
    brokerContact?.name ?? brokerContact?.email ?? "No broker contact";

  return (
    <Link href={`/clients/${row.clientOrgId}`} className={rowClass}>
      {nameBlock}
      <span className="hidden max-w-40 truncate text-label-sm text-muted-foreground lg:block">
        {brokerContactLabel}
      </span>
      {badge}
      {timestamp(activityLabel)}
      <PillButton type="button" size="compact" variant="secondary" className="shrink-0">
        View
      </PillButton>
    </Link>
  );
}
