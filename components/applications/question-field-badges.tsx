"use client";
import { Badge } from "@/components/ui/badge";
import type { Doc } from "@/convex/_generated/dataModel";

type Props = {
  flags: Doc<"applicationQuestionFlags">[];
};

export function QuestionFieldBadges({ flags }: Props) {
  const openFlags = flags.filter((f) => f.status === "open");
  if (openFlags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {openFlags.map((flag) => (
        <Badge
          key={flag._id}
          variant="outline"
          className={
            flag.flagType === "needs_new_answer"
              ? "border-red-500 text-red-600 bg-red-50"
              : "border-blue-500 text-blue-600 bg-blue-50"
          }
          title={flag.message}
        >
          {flag.flagType === "needs_new_answer" ? "Needs new answer" : "Broker note"}
        </Badge>
      ))}
    </div>
  );
}
