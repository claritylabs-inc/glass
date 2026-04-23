"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";
import { PillButton } from "@/components/ui/pill-button";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";

type Props = { applicationId: Id<"applications"> };

const STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  returned: "Needs updates",
  submitted: "Submitted",
  accepted: "Approved",
};

const STATUS_TONE: Record<string, string> = {
  not_started: "text-muted-foreground",
  in_progress: "text-foreground",
  returned: "text-amber-600 dark:text-amber-400",
  submitted: "text-foreground",
  accepted: "text-emerald-600 dark:text-emerald-400",
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

  const allComplete =
    sortedGroups.length > 0 &&
    sortedGroups.every(
      (g) => g.status === "submitted" || g.status === "accepted",
    );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {sortedGroups.map((g, idx) => (
          <button
            key={g._id}
            className="w-full flex items-center justify-between gap-4 rounded-lg border border-foreground/6 bg-white px-4 py-3.5 text-left transition-colors hover:bg-accent/30 hover:border-foreground/10"
            onClick={() => router.push(`/applications/${applicationId}/groups/${g._id}`)}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <p className="text-sm font-medium truncate">{g.title}</p>
              </div>
              {g.description ? (
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                  {g.description}
                </p>
              ) : null}
            </div>
            <span
              className={cn(
                "text-xs whitespace-nowrap",
                STATUS_TONE[g.status] ?? "text-muted-foreground",
              )}
            >
              {STATUS_LABELS[g.status] ?? g.status.replace(/_/g, " ")}
            </span>
          </button>
        ))}
      </div>

      <div className="pt-2">
        <PillButton
          type="button"
          variant="primary"
          disabled={!allComplete}
          onClick={() => toast.success("Application submitted to your broker.")}
          className="w-full justify-center text-sm shadow-none sm:w-auto"
        >
          Submit application
          <ArrowRight className="h-4 w-4" />
        </PillButton>
      </div>
    </div>
  );
}
