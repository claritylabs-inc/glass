"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { QuestionFieldBadges } from "./question-field-badges";
import { toast } from "sonner";
import type { Id, Doc } from "@/convex/_generated/dataModel";

type Props = {
  applicationId: Id<"applications">;
  group: Doc<"applicationGroups">;
  questions: Doc<"applicationQuestions">[];
  answers: Doc<"applicationAnswers">[];
  flags: Doc<"applicationQuestionFlags">[];
  onClose: () => void;
};

export function ReviewGroupPane({
  applicationId,
  group,
  questions,
  answers,
  flags,
  onClose,
}: Props) {
  const [flaggingQuestion, setFlaggingQuestion] = useState<Id<"applicationQuestions"> | null>(null);
  const [flagMessage, setFlagMessage] = useState("");
  const createFlag = useMutation((api as any).applicationQuestionFlags.create);
  const acceptSection = useMutation((api as any).applicationGroups.acceptSection);
  const returnSection = useMutation((api as any).applicationGroups.returnSection);

  const answerMap = Object.fromEntries(
    answers.map((a) => [`${String(a.questionId)}:${a.rowKey ?? ""}`, a]),
  );
  const rootAnswerValueMap = Object.fromEntries(
    answers
      .filter((a) => !a.rowKey)
      .map((a) => [String(a.questionId), a.value]),
  );
  const groupQuestions = questions
    .filter((q) => q.groupId === group._id)
    .sort((a, b) => a.order - b.order);

  const toSafeCount = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return Math.floor(parsed);
    }
    return null;
  };

  const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

  const repeatingCount = (q: Doc<"applicationQuestions">): number => {
    const repeating = (q as any).repeating as
      | {
          dependsOnQuestionId?: Id<"applicationQuestions">;
          minItems?: number;
          maxItems?: number;
        }
      | undefined;
    if (!repeating) return 1;
    const minItems = Math.max(1, repeating.minItems ?? 1);
    const maxItems = Math.max(minItems, repeating.maxItems ?? 25);
    if (repeating.dependsOnQuestionId) {
      const raw = rootAnswerValueMap[String(repeating.dependsOnQuestionId)];
      const resolved = toSafeCount(raw);
      if (resolved !== null) return Math.max(minItems, Math.min(maxItems, resolved));
    }
    return minItems;
  };

  async function handleFlag(questionId: Id<"applicationQuestions">, type: "comment" | "needs_new_answer") {
    if (!flagMessage.trim()) return;
    await createFlag({
      applicationId,
      groupId: group._id,
      questionId,
      flagType: type,
      message: flagMessage.trim(),
    });
    setFlaggingQuestion(null);
    setFlagMessage("");
    toast.success("Flag added");
  }

  async function handleAccept() {
    try {
      await acceptSection({ groupId: group._id });
      toast.success("Section accepted");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to accept");
    }
  }

  async function handleReturn() {
    try {
      await returnSection({ groupId: group._id });
      toast.success("Section returned to client");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to return");
    }
  }

  // Split into non-repeating questions and repeating collections grouped by collectionKey.
  const nonRepeatingQuestions = groupQuestions.filter((q) => !(q as any).repeating);
  const repeatingCollections = (() => {
    const map = new Map<
      string,
      {
        collectionKey: string;
        itemLabel: string;
        dependsOnQuestionId?: Id<"applicationQuestions">;
        questions: Doc<"applicationQuestions">[];
        rowCount: number;
      }
    >();
    for (const q of groupQuestions) {
      const r = (q as any).repeating as
        | { collectionKey: string; itemLabel: string; dependsOnQuestionId?: Id<"applicationQuestions"> }
        | undefined;
      if (!r) continue;
      const existing = map.get(r.collectionKey);
      if (existing) {
        existing.questions.push(q);
        existing.rowCount = Math.max(existing.rowCount, repeatingCount(q));
        if (!existing.dependsOnQuestionId && r.dependsOnQuestionId) {
          existing.dependsOnQuestionId = r.dependsOnQuestionId;
        }
      } else {
        map.set(r.collectionKey, {
          collectionKey: r.collectionKey,
          itemLabel: r.itemLabel,
          dependsOnQuestionId: r.dependsOnQuestionId,
          questions: [q],
          rowCount: repeatingCount(q),
        });
      }
    }
    return Array.from(map.values());
  })();

  function renderQuestionAnswer(
    q: Doc<"applicationQuestions">,
    rowKey: string,
  ) {
    const answer = answerMap[`${String(q._id)}:${rowKey}`];
    const qFlags = flags.filter(
      (f) => f.questionId === q._id && (f.rowKey ?? "") === rowKey,
    );
    return (
      <div key={`${q._id}-${rowKey}`} className="space-y-1">
        <div className="text-sm font-medium">{q.prompt}</div>
        <div className="text-sm text-muted-foreground bg-muted/30 rounded px-2 py-1">
          {answer?.value !== undefined && answer?.value !== null ? (
            String(answer.value)
          ) : (
            <span className="italic text-xs">No answer</span>
          )}
        </div>
        {answer?.source && answer.source !== "manual" && (
          <div className="text-xs text-muted-foreground">Source: {answer.source}</div>
        )}
        <QuestionFieldBadges flags={qFlags as any} />
        {flaggingQuestion === q._id ? (
          <div className="space-y-1 mt-1">
            <Input
              placeholder="Flag message…"
              value={flagMessage}
              onChange={(e) => setFlagMessage(e.target.value)}
              autoFocus
              size={1}
            />
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => handleFlag(q._id, "comment")}
              >
                Comment
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs border-red-300 text-red-600"
                onClick={() => handleFlag(q._id, "needs_new_answer")}
              >
                Needs new answer
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={() => {
                  setFlaggingQuestion(null);
                  setFlagMessage("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setFlaggingQuestion(q._id)}
          >
            + Add flag
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        {nonRepeatingQuestions.map((q) => (
          <div key={q._id} className="space-y-1 border-b border-foreground/5 pb-3">
            {renderQuestionAnswer(q, "")}
          </div>
        ))}

        {repeatingCollections.map((collection) => {
          const dependencyQuestion = collection.dependsOnQuestionId
            ? questions.find((dq) => String(dq._id) === String(collection.dependsOnQuestionId))
            : null;
          return (
            <div
              key={collection.collectionKey}
              className="space-y-3 rounded-xl border border-foreground/10 bg-card p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium">
                  {titleCase(collection.itemLabel)} details
                </div>
                <Badge variant="outline" className="text-[11px]">
                  Repeating chunk ({collection.rowCount})
                </Badge>
                {dependencyQuestion ? (
                  <Badge variant="outline" className="text-[11px]">
                    Depends on: {dependencyQuestion.prompt}
                  </Badge>
                ) : null}
              </div>

              <div className="space-y-4">
                {Array.from({ length: collection.rowCount }).map((_, idx) => {
                  const rowKey = `${collection.collectionKey}:${idx}`;
                  return (
                    <div
                      key={rowKey}
                      className="space-y-3 rounded-lg border border-foreground/10 p-3"
                    >
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {titleCase(collection.itemLabel)} {idx + 1}
                      </div>
                      {collection.questions.map((q) =>
                        renderQuestionAnswer(q, rowKey),
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {group.status === "submitted" && (
        <div className="flex gap-2 pt-2 border-t border-foreground/10">
          <Button variant="outline" className="flex-1" onClick={handleReturn}>
            Return to client
          </Button>
          <Button className="flex-1" onClick={handleAccept}>
            Accept section
          </Button>
        </div>
      )}
    </div>
  );
}
