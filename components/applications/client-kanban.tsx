"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRouter } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";

type Props = { applicationId: Id<"applications"> };

const COLUMNS = [
  { status: "not_started", label: "Not Started" },
  { status: "in_progress", label: "In Progress" },
  { status: "returned", label: "Returned" },
  { status: "submitted", label: "Submitted" },
  { status: "accepted", label: "Accepted" },
] as const;

export function ClientKanban({ applicationId }: Props) {
  const data = useQuery((api as any).applications.get, { applicationId }) as {
    groups: Array<{
      _id: Id<"applicationGroups">;
      title: string;
      description?: string;
      status: string;
    }>;
  } | null | undefined;

  const router = useRouter();

  if (!data) return null;

  const { groups } = data;

  return (
    <div className="grid grid-cols-5 gap-4">
      {COLUMNS.map(({ status, label }) => (
        <div key={status} className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {label}
          </h3>
          {groups
            .filter((g) => g.status === status)
            .map((g) => (
              <button
                key={g._id}
                className="w-full text-left p-3 rounded-lg border border-foreground/10 bg-card hover:bg-accent transition-colors"
                onClick={() =>
                  router.push(`/applications/${applicationId}/groups/${g._id}`)
                }
              >
                <div className="font-medium text-sm">{g.title}</div>
                {g.description && (
                  <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {g.description}
                  </div>
                )}
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}
