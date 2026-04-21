"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ReviewGroupPane } from "./review-group-pane";
import { Badge } from "@/components/ui/badge";
import type { Id, Doc } from "@/convex/_generated/dataModel";

type Props = { applicationId: Id<"applications"> };

const STATUS_CONFIG = {
  not_started: { label: "Not Started", color: "text-muted-foreground" },
  in_progress:  { label: "In Progress", color: "text-blue-600" },
  returned:     { label: "Returned",    color: "text-amber-600" },
  submitted:    { label: "Submitted",   color: "text-green-600" },
  accepted:     { label: "Accepted",    color: "text-emerald-600" },
} as const;

export function ReviewKanban({ applicationId }: Props) {
  const data = useQuery((api as any).applications.get, { applicationId }) as {
    app: Doc<"applications">;
    groups: Doc<"applicationGroups">[];
    questions: Doc<"applicationQuestions">[];
    answers: Doc<"applicationAnswers">[];
    flags: Doc<"applicationQuestionFlags">[];
  } | null | undefined;

  const [selectedGroupId, setSelectedGroupId] = useState<Id<"applicationGroups"> | null>(null);

  if (!data) return <div className="p-4 text-muted-foreground">Loading…</div>;

  const { app, groups, questions, answers, flags } = data;
  const selectedGroup = groups.find((g) => g._id === selectedGroupId);

  return (
    <div className="flex gap-6 h-full">
      {/* Kanban columns */}
      <div className="flex-1 grid grid-cols-5 gap-3 min-w-0">
        {(Object.keys(STATUS_CONFIG) as Array<keyof typeof STATUS_CONFIG>).map((status) => (
          <div key={status} className="space-y-2">
            <h3 className={`text-xs font-semibold uppercase tracking-wide ${STATUS_CONFIG[status].color}`}>
              {STATUS_CONFIG[status].label}
            </h3>
            {groups
              .filter((g) => g.status === status)
              .map((g) => {
                const openFlagCount = flags.filter(
                  (f) => f.groupId === g._id && f.status === "open",
                ).length;
                return (
                  <button
                    key={g._id}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedGroupId === g._id
                        ? "border-primary bg-primary/5"
                        : "border-foreground/10 bg-card hover:bg-accent"
                    }`}
                    onClick={() => setSelectedGroupId(g._id)}
                  >
                    <div className="font-medium text-sm truncate">{g.title}</div>
                    {openFlagCount > 0 && (
                      <Badge variant="outline" className="mt-1 text-xs border-amber-400 text-amber-700 bg-amber-50">
                        {openFlagCount} flag{openFlagCount > 1 ? "s" : ""}
                      </Badge>
                    )}
                  </button>
                );
              })}
          </div>
        ))}
      </div>

      {/* Side pane */}
      {selectedGroup && (
        <div className="w-96 shrink-0 border-l border-foreground/10 pl-6">
          <ReviewGroupPane
            applicationId={applicationId}
            group={selectedGroup}
            questions={questions}
            answers={answers}
            flags={flags}
            onClose={() => setSelectedGroupId(null)}
          />
        </div>
      )}
    </div>
  );
}
