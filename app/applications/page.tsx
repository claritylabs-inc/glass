"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCurrentOrg } from "@/lib/hooks/use-current-org";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { ClientKanban } from "@/components/applications/client-kanban";
import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";

const STATUS_COLORS: Record<string, string> = {
  draft:            "bg-gray-100 text-gray-600",
  sent:             "bg-blue-100 text-blue-700",
  in_progress:      "bg-amber-100 text-amber-700",
  awaiting_review:  "bg-purple-100 text-purple-700",
  complete:         "bg-green-100 text-green-700",
  cancelled:        "bg-red-100 text-red-600",
};

export default function ApplicationsPage() {
  const orgCtx = useCurrentOrg();

  const applications = useQuery(
    (api as any).applications.listForClient,
    orgCtx ? { clientOrgId: orgCtx.orgId } : "skip",
  ) as Array<{ _id: Id<"applications">; title: string; status: string; lineOfBusiness?: string }> | undefined;

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
        <h1 className="text-2xl font-semibold">Applications</h1>

        <div className="space-y-2">
          {applications === undefined ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : applications.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No applications yet. Your broker will send you one when ready.
            </div>
          ) : (
            applications.map((app) => (
              <Link
                key={app._id}
                href={`/applications/${app._id}`}
                className="flex items-center gap-4 p-4 rounded-lg border border-foreground/10 bg-card hover:bg-accent transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{app.title}</p>
                  {app.lineOfBusiness && (
                    <p className="text-xs text-muted-foreground">{app.lineOfBusiness}</p>
                  )}
                </div>
                <Badge variant="outline" className={`text-xs shrink-0 ${STATUS_COLORS[app.status] ?? ""}`}>
                  {app.status.replace(/_/g, " ")}
                </Badge>
              </Link>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
