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
      openApplicationsCount: number;
      activePoliciesCount: number;
      documentsCount: number;
    }
  | {
      kind: "invite";
      brokerOrgId: Id<"organizations">;
      invitationId: Id<"clientInvitations">;
      name: string;
      primaryContactName?: string;
      primaryContactEmail?: string;
      onboardingStatus: "invited";
      createdAt: number;
      lastActivityAt?: undefined;
      openApplicationsCount: 0;
      activePoliciesCount: 0;
      documentsCount: 0;
    };

const STATUS_LABELS: Record<string, string> = {
  invited: "Invited",
  onboarding: "Onboarding",
  active: "Active",
};

const STATUS_VARIANTS: Record<string, "secondary" | "outline" | "default"> = {
  invited: "outline",
  onboarding: "secondary",
  active: "default",
};

export function ClientListRow({ row }: { row: ClientRow }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revokeInvite = useMutation((api as any).clientInvitations.revoke);

  const activityLabel = row.lastActivityAt
    ? formatDistanceToNow(new Date(row.lastActivityAt), { addSuffix: true })
    : row.onboardingStatus === "invited"
      ? "—"
      : "No activity yet";

  if (row.kind === "invite") {
    return (
      <div className="flex items-center gap-4 px-4 py-3 border-b border-foreground/6 last:border-0 opacity-70 hover:opacity-100 transition-opacity">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{row.name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {row.primaryContactEmail ?? "No email"}
          </p>
        </div>
        <Badge variant={STATUS_VARIANTS[row.onboardingStatus]} className="shrink-0">
          {STATUS_LABELS[row.onboardingStatus]}
        </Badge>
        <span className="hidden sm:block text-xs text-muted-foreground shrink-0 whitespace-nowrap tabular-nums">
          {formatDistanceToNow(new Date(row.createdAt), { addSuffix: true })}
        </span>
        <PillButton
          type="button"
          size="compact"
          variant="destructive"
          className="shrink-0"
          onClick={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await revokeInvite({ invitationId: row.invitationId, orgId: row.brokerOrgId });
            toast.success("Invite revoked");
          }}
        >
          Revoke
        </PillButton>
      </div>
    );
  }

  return (
    <Link
      href={`/clients/${row.clientOrgId}`}
      className="flex items-center gap-4 px-4 py-3 border-b border-foreground/6 last:border-0 hover:bg-muted/50 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{row.name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {row.primaryContactName
            ? `${row.primaryContactName}${row.primaryContactEmail ? ` · ${row.primaryContactEmail}` : ""}`
            : row.primaryContactEmail ?? "No contact"}
        </p>
      </div>
      <Badge variant={STATUS_VARIANTS[row.onboardingStatus]} className="shrink-0">
        {STATUS_LABELS[row.onboardingStatus]}
      </Badge>
      <span className="hidden sm:block text-xs text-muted-foreground shrink-0 whitespace-nowrap tabular-nums">
        {activityLabel}
      </span>
    </Link>
  );
}
