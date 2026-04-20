"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Clock } from "lucide-react";

/**
 * Renders an in-context pending-approval message. Only shows org name when
 * the viewerOrg data is available. Should be rendered when useMembershipStatus()
 * returns "pending".
 */
export function PendingApprovalState() {
  const orgData = useQuery(api.orgs.viewerOrg);
  const orgName = orgData?.org?.name;

  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] px-6 text-center">
      <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center mb-4">
        <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
      </div>
      <h2 className="text-body-sm font-semibold text-foreground mb-1.5">
        Pending approval{orgName ? ` to join ${orgName}` : ""}
      </h2>
      <p className="text-label-sm text-muted-foreground max-w-sm">
        Your request to join this organization is waiting for an admin to review it.
        You&apos;ll have full access once approved.
      </p>
    </div>
  );
}
