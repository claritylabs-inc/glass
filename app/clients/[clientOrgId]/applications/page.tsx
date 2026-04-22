"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCurrentOrg } from "@/lib/hooks/use-current-org";
import { PillButton } from "@/components/ui/pill-button";
import { Badge } from "@/components/ui/badge";
import { Plus, FileText } from "lucide-react";
import { CreateApplicationDrawer } from "@/components/applications/create-drawer";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";

const STATUS_COLORS: Record<string, string> = {
  draft:            "bg-gray-100 text-gray-600",
  sent:             "bg-blue-100 text-blue-700",
  in_progress:      "bg-amber-100 text-amber-700",
  awaiting_review:  "bg-purple-100 text-purple-700",
  complete:         "bg-green-100 text-green-700",
  cancelled:        "bg-red-100 text-red-600",
};

export default function ClientApplicationsPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const orgCtx = useCurrentOrg();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const applications = useQuery(
    (api as any).applications.listForBroker,
    orgCtx ? { brokerOrgId: orgCtx.orgId, clientOrgId: clientOrgId as Id<"organizations"> } : "skip",
  ) as Array<{ _id: Id<"applications">; title: string; status: string; createdAt: number; lineOfBusiness?: string }> | undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
          Applications
        </p>
        <PillButton
          type="button"
          size="compact"
          variant="primary"
          onClick={() => setDrawerOpen(true)}
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </PillButton>
      </div>

      {applications === undefined ? (
        <div className="py-16 text-center">
          <p className="text-sm text-muted-foreground/60">Loading…</p>
        </div>
      ) : applications.length === 0 ? (
        <EmptyStateCard
          icon={<FileText className="w-5 h-5" />}
          title="No applications yet"
          description="Create an application to start collecting coverage info from this client."
          actionLabel="New application"
          onAction={() => setDrawerOpen(true)}
        />
      ) : (
        <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden divide-y divide-foreground/6">
          {applications.map((app) => (
            <Link
              key={app._id}
              href={`/clients/${clientOrgId}/applications/${app._id}`}
              className="flex items-center gap-4 px-4 py-3 hover:bg-accent transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{app.title}</p>
                {app.lineOfBusiness && (
                  <p className="text-xs text-muted-foreground">{app.lineOfBusiness}</p>
                )}
              </div>
              <Badge variant="outline" className={`text-xs ${STATUS_COLORS[app.status] ?? ""}`}>
                {app.status.replace(/_/g, " ")}
              </Badge>
            </Link>
          ))}
        </div>
      )}

      {orgCtx && (
        <CreateApplicationDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          clientOrgId={clientOrgId as Id<"organizations">}
        />
      )}
    </div>
  );
}
