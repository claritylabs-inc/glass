"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDistanceToNow } from "date-fns";
import { useEntityPreview } from "@/hooks/use-entity-preview";

export default function ClientPoliciesPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const { openPreview } = useEntityPreview();
  const policies = useQuery(
    api.policies.listForOrg,
    clientOrgId ? { orgId: clientOrgId as Id<"organizations"> } : "skip",
  );

  const policyList = policies?.filter((p) => p.documentType !== "quote") ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card divide-y">
        {policies === undefined ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : policyList.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No policies yet.</div>
        ) : (
          policyList.map((p) => (
            <button
              key={p._id}
              className="flex items-center gap-4 px-4 py-3 w-full text-left hover:bg-muted/50 transition-colors"
              onClick={() => openPreview({ type: "policy", id: p._id })}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {(p as { carrier?: string }).carrier} — {(p as { policyNumber?: string }).policyNumber}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(p as { effectiveDate?: string }).effectiveDate} → {(p as { expirationDate?: string }).expirationDate}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(p._creationTime), { addSuffix: true })}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
