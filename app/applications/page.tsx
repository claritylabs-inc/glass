"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCurrentOrg } from "@/lib/hooks/use-current-org";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { FileText } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  draft:            "bg-gray-100 text-gray-600",
  sent:             "bg-blue-100 text-blue-700",
  in_progress:      "bg-amber-100 text-amber-700",
  awaiting_review:  "bg-purple-100 text-purple-700",
  complete:         "bg-green-100 text-green-700",
  cancelled:        "bg-red-100 text-red-600",
};

type Application = {
  _id: Id<"applications">;
  title: string;
  status: string;
  lineOfBusiness?: string;
};

function ApplicationsLoadingSkeleton() {
  return (
    <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between px-4 py-3 border-t border-foreground/4 first:border-t-0"
        >
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-5 w-20 hidden sm:block" />
        </div>
      ))}
    </div>
  );
}

export default function ApplicationsPage() {
  const orgCtx = useCurrentOrg();

  const applications = useQuery(
    (api as any).applications.listForClient,
    orgCtx ? { clientOrgId: orgCtx.orgId } : "skip",
  ) as Application[] | undefined;

  const isLoading = applications === undefined;

  return (
    <AppShell>
      <div className="space-y-4">
        {isLoading ? (
          <ApplicationsLoadingSkeleton />
        ) : applications.length === 0 ? (
          <EmptyStateCard
            icon={<FileText className="w-5 h-5" />}
            title="No applications yet"
            description="Your broker will send you an application when they're ready to gather coverage info."
          />
        ) : (
          <div className="rounded-lg border border-foreground/6 bg-card overflow-hidden">
            {applications.map((app) => (
              <Link
                key={app._id}
                href={`/applications/${app._id}`}
                className="flex items-center justify-between px-4 py-3 border-t border-foreground/4 first:border-t-0 hover:bg-muted/40 transition-colors"
              >
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-medium truncate">{app.title}</p>
                  {app.lineOfBusiness && (
                    <p className="text-xs text-muted-foreground">{app.lineOfBusiness}</p>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className={`text-xs shrink-0 ${STATUS_COLORS[app.status] ?? ""}`}
                >
                  {app.status.replace(/_/g, " ")}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
