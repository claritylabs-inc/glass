"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";

const STATUS_LABELS: Record<string, string> = {
  extracting_fields: "Extracting",
  filling_known: "Filling",
  asking_questions: "Asking",
  pending_confirmation: "Pending",
  confirmed: "Confirmed",
  complete: "Complete",
  cancelled: "Cancelled",
  failed: "Failed",
};

export default function ClientApplicationsPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const sessions = useQuery(
    api.applicationSessions.listForOrg,
    clientOrgId ? { orgId: clientOrgId as Id<"organizations"> } : "skip",
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
        Applications — read-only (v1)
      </p>
      <div className="rounded-lg border bg-card divide-y">
        {sessions === undefined ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No applications yet.</div>
        ) : (
          sessions.map((s) => (
            <div key={s._id} className="flex items-center gap-4 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {(s as { applicationTitle?: string }).applicationTitle ?? (s as { sourceFileName?: string }).sourceFileName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(s._creationTime), { addSuffix: true })}
                </p>
              </div>
              <Badge variant="outline">
                {STATUS_LABELS[s.status] ?? s.status}
              </Badge>
            </div>
          ))
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Full applications UI arrives in Subsystem 4.
      </p>
    </div>
  );
}
