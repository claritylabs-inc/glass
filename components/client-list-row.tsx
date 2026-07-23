"use client";

import Link from "next/link";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Badge } from "@/components/ui/badge";
import { PillButton } from "@/components/ui/pill-button";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { useUpdateCachedQuery } from "@/lib/sync/use-cached-query";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

dayjs.extend(relativeTime);

export type ClientRow =
  | {
      kind: "client";
      clientOrgId: Id<"organizations">;
      name: string;
      website?: string;
      iconUrl?: string | null;
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
      partnerOrgId: Id<"organizations">;
      clientOrgId: Id<"organizations">;
      name: string;
      website?: string;
      iconUrl?: string | null;
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
      website?: string;
      iconUrl?: string | null;
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
  const revokeInvite = useMutation(api.clientInvitations.revoke);
  const deleteDraft = useMutation(api.clientInvitations.deleteDraftClient);
  const updateBrokerClients = useUpdateCachedQuery<
    Array<{
      invitationId?: Id<"clientInvitations">;
      clientOrgId?: Id<"organizations">;
      [key: string]: unknown;
    }>,
    { brokerOrgId: Id<"organizations"> }
  >("clients.listForBroker");

  async function removeClientRowLocally(
    brokerOrgId: Id<"organizations">,
    match: {
      invitationId?: Id<"clientInvitations">;
      clientOrgId?: Id<"organizations">;
    },
  ) {
    await updateBrokerClients({ brokerOrgId }, (current) =>
      current.filter((item) => {
        if (match.invitationId && item.invitationId === match.invitationId) {
          return false;
        }
        if (match.clientOrgId && item.clientOrgId === match.clientOrgId) {
          return false;
        }
        return true;
      }),
    );
  }

  const rowClass =
    "flex items-center gap-4 px-4 py-3 border-b border-foreground/6 last:border-0 hover:bg-muted/50 transition-colors";

  const nameBlock = (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <OrgBrandIcon name={row.name} iconUrl={row.iconUrl} website={row.website} size="md" />
      <div className="min-w-0">
        <div className="flex flex-col gap-0.5 md:flex-row md:items-center md:gap-2">
          <p className="truncate text-base font-medium text-foreground">{row.name}</p>
          <p className="truncate text-base text-muted-foreground">
            {row.kind === "client"
              ? (row.primaryContactName ?? "No primary contact")
              : (row.primaryContactEmail ?? "No email")}
          </p>
        </div>
      </div>
    </div>
  );

  const badge = (
    <Badge variant={STATUS_VARIANTS[row.onboardingStatus]} className="shrink-0">
      {STATUS_LABELS[row.onboardingStatus]}
    </Badge>
  );

  const timestamp = (label: string) => (
    <span className="hidden sm:block text-label text-muted-foreground shrink-0 whitespace-nowrap tabular-nums">
      {label}
    </span>
  );

  if (row.kind === "invite") {
    return (
      <div className={rowClass}>
        {nameBlock}
        {badge}
        {timestamp(dayjs(row.createdAt).fromNow())}
        <PillButton
          type="button"
          size="compact"
          variant="destructive"
          className="shrink-0"
          onClick={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await revokeInvite({ invitationId: row.invitationId, orgId: row.partnerOrgId });
            await removeClientRowLocally(row.partnerOrgId, {
              invitationId: row.invitationId,
            });
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
        {timestamp(dayjs(row.createdAt).fromNow())}
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
              await removeClientRowLocally(row.partnerOrgId, {
                clientOrgId: row.clientOrgId,
              });
              toast.success("Deleted");
            } catch (err) {
              toast.error(
                getUserFacingErrorMessage(err, "Could not delete this draft."),
              );
            }
          }}
        >
          Delete
        </PillButton>
      </div>
    );
  }

  const activityLabel = row.lastActivityAt
    ? dayjs(row.lastActivityAt).fromNow()
    : "No activity yet";
  const brokerContact = row.brokerMembers.find(
    (member) => member.userId === row.primaryBrokerContactId,
  );
  const brokerContactLabel =
    brokerContact?.name ?? brokerContact?.email ?? "No broker contact";

  return (
    <Link href={`/clients/${row.clientOrgId}`} className={rowClass}>
      {nameBlock}
      <span className="hidden max-w-40 truncate text-label text-muted-foreground lg:block">
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
