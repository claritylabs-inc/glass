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

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        {groupQuestions.map((q) => {
          const repeating = (q as any).repeating as
            | { collectionKey: string; itemLabel: string; dependsOnQuestionId?: Id<"applicationQuestions"> }
            | undefined;
          const qFlags = flags.filter((f) => f.questionId === q._id);
          const dependencyQuestion = repeating?.dependsOnQuestionId
            ? questions.find((dq) => String(dq._id) === String(repeating.dependsOnQuestionId))
            : null;
          const rowCount = repeating ? repeatingCount(q) : 1;

          return (
            <div key={q._id} className="space-y-1 border-b border-foreground/5 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium">{q.prompt}</div>
                {repeating ? (
                  <Badge variant="outline" className="text-[11px]">Repeats ({rowCount})</Badge>
                ) : null}
                {dependencyQuestion ? (
                  <Badge variant="outline" className="text-[11px]">Depends on: {dependencyQuestion.prompt}</Badge>
                ) : null}
              </div>

              {!repeating ? (
                (() => {
                  const answer = answerMap[`${String(q._id)}:`];
                  return (
                    <>
                      <div className="text-sm text-muted-foreground bg-muted/30 rounded px-2 py-1">
                        {answer?.value !== undefined && answer?.value !== null
                          ? String(answer.value)
                          : <span className="italic text-xs">No answer</span>}
                      </div>
                      {answer?.source && answer.source !== "manual" && (
                        <div className="text-xs text-muted-foreground">Source: {answer.source}</div>
                      )}
                      <QuestionFieldBadges flags={qFlags as any} />
                    </>
                  );
                })()
              ) : (
                <div className="space-y-2">
                  {Array.from({ length: rowCount }).map((_, idx) => {
                    const rowKey = `${repeating.collectionKey}:${idx}`;
                    const answer = answerMap[`${String(q._id)}:${rowKey}`];
                    const rowFlags = qFlags.filter((f) => (f.rowKey ?? "") === rowKey);
                    return (
                      <div key={rowKey} className="rounded-md border border-foreground/10 px-3 py-2">
                        <div className="text-xs font-medium text-muted-foreground mb-1">
                          {titleCase(repeating.itemLabel)} {idx + 1}
                        </div>
                        <div className="text-sm text-muted-foreground bg-muted/30 rounded px-2 py-1">
                          {answer?.value !== undefined && answer?.value !== null
                            ? String(answer.value)
                            : <span className="italic text-xs">No answer</span>}
                        </div>
                        {answer?.source && answer.source !== "manual" && (
                          <div className="text-xs text-muted-foreground mt-1">Source: {answer.source}</div>
                        )}
                        <QuestionFieldBadges flags={rowFlags as any} />
                      </div>
                    );
                  })}
                </div>
              )}

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
