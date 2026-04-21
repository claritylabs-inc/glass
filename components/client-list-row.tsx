"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
      <div className="flex items-center gap-4 px-4 py-3 border-b last:border-0 opacity-60 hover:opacity-80 transition-opacity">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{row.name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {row.primaryContactEmail ?? "No email"}
          </p>
        </div>
        <Badge variant={STATUS_VARIANTS[row.onboardingStatus]}>
          {STATUS_LABELS[row.onboardingStatus]}
        </Badge>
        <span className="text-xs text-muted-foreground w-28 text-right">
          {formatDistanceToNow(new Date(row.createdAt), { addSuffix: true })}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={async () => {
              await revokeInvite({ invitationId: row.invitationId, orgId: row.brokerOrgId });
              toast.success("Invite revoked");
            }}
          >
            Revoke
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Link
      href={`/clients/${row.clientOrgId}`}
      className="flex items-center gap-4 px-4 py-3 border-b last:border-0 hover:bg-muted/50 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{row.name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {row.primaryContactName
            ? `${row.primaryContactName}${row.primaryContactEmail ? ` · ${row.primaryContactEmail}` : ""}`
            : row.primaryContactEmail ?? "No contact"}
        </p>
      </div>
      <Badge variant={STATUS_VARIANTS[row.onboardingStatus]}>
        {STATUS_LABELS[row.onboardingStatus]}
      </Badge>
      <span className="text-xs text-muted-foreground w-28 text-right hidden md:block">
        {activityLabel}
      </span>
      <div className="hidden lg:flex gap-4 text-xs text-muted-foreground">
        <span title="Open applications">{row.openApplicationsCount} apps</span>
        <span title="Active policies">{row.activePoliciesCount} policies</span>
        <span title="Documents">{row.documentsCount} docs</span>
      </div>
    </Link>
  );
}
