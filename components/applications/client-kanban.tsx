"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Props = { applicationId: Id<"applications"> };

const STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  returned: "Needs updates",
  submitted: "Submitted",
  accepted: "Accepted",
};

export function ClientKanban({ applicationId }: Props) {
  const data = useQuery((api as any).applications.get, { applicationId }) as {
    app: { status: string };
    groups: Array<{
      _id: Id<"applicationGroups">;
      order: number;
      title: string;
      description?: string;
      status: string;
    }>;
  } | null | undefined;

  const router = useRouter();

  const sortedGroups = useMemo(
    () => (data ? [...data.groups].sort((a, b) => a.order - b.order) : []),
    [data],
  );

  if (!data) return null;

  const nextGroup =
    sortedGroups.find((g) => g.status === "returned") ??
    sortedGroups.find((g) => g.status === "in_progress") ??
    sortedGroups.find((g) => g.status === "not_started") ??
    sortedGroups[0];
  const completedCount = sortedGroups.filter((g) => g.status === "accepted").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-foreground/10 bg-background/40 px-4 py-3">
        <p className="text-sm text-muted-foreground">
          {completedCount} of {sortedGroups.length} sections approved
        </p>
        {nextGroup ? (
          <Button
            size="sm"
            onClick={() => router.push(`/applications/${applicationId}/groups/${nextGroup._id}`)}
          >
            Continue
          </Button>
        ) : null}
      </div>

      <div className="space-y-3">
        {sortedGroups.map((g, idx) => (
          <button
            key={g._id}
            className="w-full rounded-xl border border-foreground/10 bg-card px-4 py-4 text-left transition-colors hover:bg-accent/30"
            onClick={() => router.push(`/applications/${applicationId}/groups/${g._id}`)}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground">Section {idx + 1}</p>
                <p className="text-sm font-medium">{g.title}</p>
              </div>
              <Badge variant="outline" className="text-xs">
                {STATUS_LABELS[g.status] ?? g.status.replace(/_/g, " ")}
              </Badge>
            </div>
            {g.description ? (
              <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{g.description}</p>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
