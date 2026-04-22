"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { QuestionField } from "./question-field";
import { QuestionFieldBadges } from "./question-field-badges";
import { evaluateConditional } from "@/lib/applicationConditionals";
import type { Id, Doc } from "@/convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type ApplicationQuestion = Doc<"applicationQuestions">;
type ApplicationAnswer = Doc<"applicationAnswers">;
type ApplicationFlag = Doc<"applicationQuestionFlags">;

export type QuestionGroupViewProps = {
  applicationId: Id<"applications">;
  group: {
    _id: Id<"applicationGroups">;
    title: string;
    description?: string;
    status: string;
  };
  questions: ApplicationQuestion[];
  answers: ApplicationAnswer[];
  flags: ApplicationFlag[];
  mode: "fill" | "review";

  // fill-mode only
  onAnswerChange?: (
    questionId: Id<"applicationQuestions">,
    value: unknown,
    source: "manual" | "integration" | undefined,
    rowKey: string,
  ) => Promise<void> | void;
  onSubmit?: () => Promise<void> | void;

  // review-mode only
  onCreateFlag?: (
    questionId: Id<"applicationQuestions">,
    rowKey: string,
    type: "comment" | "needs_new_answer",
    message: string,
  ) => Promise<void> | void;
  onAccept?: () => Promise<void> | void;
  onReturn?: () => Promise<void> | void;
};

// ---------------------------------------------------------------------------
// Helpers (private to this file)
// ---------------------------------------------------------------------------

function toSafeCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return null;
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

type RepeatingMeta = {
  collectionKey: string;
  itemLabel: string;
  dependsOnQuestionId?: Id<"applicationQuestions">;
  minItems: number;
  maxItems: number;
};

function buildRepeatingCollections(
  visibleQuestions: ApplicationQuestion[],
): Array<RepeatingMeta & { questions: ApplicationQuestion[] }> {
  const map = new Map<string, RepeatingMeta & { questions: ApplicationQuestion[] }>();

  for (const q of visibleQuestions) {
    const r = (q as any).repeating as
      | {
          collectionKey: string;
          itemLabel: string;
          dependsOnQuestionId?: Id<"applicationQuestions">;
          minItems?: number;
          maxItems?: number;
        }
      | undefined;
    if (!r) continue;
    const existing = map.get(r.collectionKey);
    if (existing) {
      existing.questions.push(q);
      existing.minItems = Math.max(existing.minItems, r.minItems ?? 1);
      existing.maxItems = Math.max(existing.maxItems, r.maxItems ?? 25);
      if (!existing.dependsOnQuestionId && r.dependsOnQuestionId) {
        existing.dependsOnQuestionId = r.dependsOnQuestionId;
      }
    } else {
      map.set(r.collectionKey, {
        collectionKey: r.collectionKey,
        itemLabel: r.itemLabel,
        dependsOnQuestionId: r.dependsOnQuestionId,
        minItems: Math.max(1, r.minItems ?? 1),
        maxItems: Math.max(1, r.maxItems ?? 25),
        questions: [q],
      });
    }
  }

  return Array.from(map.values()).map((c) => ({
    ...c,
    questions: [...c.questions].sort((a, b) => a.order - b.order),
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QuestionGroupView({
  applicationId,
  group,
  questions,
  answers,
  flags,
  mode,
  onAnswerChange,
  onSubmit,
  onCreateFlag,
  onAccept,
  onReturn,
}: QuestionGroupViewProps) {
  // fill-mode: track manually added rows per collection
  const [manualCountByCollection, setManualCountByCollection] = useState<Record<string, number>>(
    {},
  );

  // review-mode: one question/row flagged at a time
  const [flaggingState, setFlaggingState] = useState<{
    questionId: Id<"applicationQuestions">;
    rowKey: string;
  } | null>(null);
  const [flagMessage, setFlagMessage] = useState("");

  // ----- Conditional visibility -----
  const answerValueMap = useMemo(() => {
    const map: Record<string, unknown> = {};
    for (const a of answers) {
      map[String(a.questionId)] = a.value;
    }
    return map;
  }, [answers]);

  const visibleQuestions = useMemo(
    () =>
      questions
        .sort((a, b) => a.order - b.order)
        .filter((q) => {
          if (!(q as any).conditional) return true;
          return evaluateConditional(
            (q as any).conditional as Parameters<typeof evaluateConditional>[0],
            answerValueMap,
          );
        }),
    [questions, answerValueMap],
  );

  // ----- Collection grouping -----
  const nonRepeatingQuestions = useMemo(
    () => visibleQuestions.filter((q) => !(q as any).repeating),
    [visibleQuestions],
  );

  const repeatingCollections = useMemo(
    () => buildRepeatingCollections(visibleQuestions),
    [visibleQuestions],
  );

  // ----- Row count resolution -----
  const resolvedCountByCollection = useMemo(() => {
    const result: Record<string, number> = {};
    for (const collection of repeatingCollections) {
      let dependencyCount = collection.minItems;
      if (collection.dependsOnQuestionId) {
        const depRaw = answerValueMap[String(collection.dependsOnQuestionId)];
        const parsed = toSafeCount(depRaw);
        if (parsed !== null) {
          dependencyCount = Math.max(
            collection.minItems,
            Math.min(collection.maxItems, parsed),
          );
        }
      }

      let existingCount = 0;
      for (const a of answers) {
        if (!a.rowKey || !a.rowKey.startsWith(`${collection.collectionKey}:`)) continue;
        const suffix = a.rowKey.slice(collection.collectionKey.length + 1);
        const idx = Number(suffix);
        if (!Number.isFinite(idx) || idx < 0) continue;
        existingCount = Math.max(existingCount, idx + 1);
      }

      const manual = manualCountByCollection[collection.collectionKey] ?? 0;
      const resolved = Math.max(collection.minItems, dependencyCount, existingCount, manual, 1);
      result[collection.collectionKey] = Math.min(collection.maxItems, resolved);
    }
    return result;
  }, [repeatingCollections, answers, answerValueMap, manualCountByCollection]);

  // ----- Answer lookup map for review mode -----
  const answerMap = useMemo(
    () =>
      Object.fromEntries(
        answers.map((a) => [`${String(a.questionId)}:${a.rowKey ?? ""}`, a]),
      ),
    [answers],
  );

  // ----- Renderers -----

  function renderFillQuestion(q: ApplicationQuestion, rowKey: string) {
    const questionFlags = flags.filter(
      (f) =>
        f.questionId === q._id &&
        f.status === "open" &&
        (f.rowKey ?? "") === rowKey,
    );
    const answer = answers.find(
      (a) => a.questionId === q._id && (a.rowKey ?? "") === rowKey,
    );
    const inputName = rowKey ? `${q._id}-${rowKey}` : undefined;
    return (
      <QuestionField
        key={`${q._id}-${rowKey}`}
        question={q as any}
        answer={answer as any}
        flags={questionFlags as any}
        {...(inputName ? { inputName } : {})}
        onChange={(v, src) =>
          onAnswerChange?.(q._id, v, src as "manual" | "integration" | undefined, rowKey)
        }
      />
    );
  }

  function renderReviewQuestion(q: ApplicationQuestion, rowKey: string) {
    const answer = answerMap[`${String(q._id)}:${rowKey}`];
    const qFlags = flags.filter(
      (f) => f.questionId === q._id && (f.rowKey ?? "") === rowKey,
    );
    const isFlagging =
      flaggingState?.questionId === q._id && flaggingState?.rowKey === rowKey;

    async function submitFlag(type: "comment" | "needs_new_answer") {
      if (!flagMessage.trim()) return;
      await onCreateFlag?.(q._id, rowKey, type, flagMessage.trim());
      setFlaggingState(null);
      setFlagMessage("");
    }

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
        {isFlagging ? (
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
                onClick={() => submitFlag("comment")}
              >
                Comment
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs border-red-300 text-red-600"
                onClick={() => submitFlag("needs_new_answer")}
              >
                Needs new answer
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={() => {
                  setFlaggingState(null);
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
            onClick={() => setFlaggingState({ questionId: q._id, rowKey })}
          >
            + Add flag
          </button>
        )}
      </div>
    );
  }

  function renderQuestion(q: ApplicationQuestion, rowKey: string) {
    return mode === "fill"
      ? renderFillQuestion(q, rowKey)
      : renderReviewQuestion(q, rowKey);
  }

  // ----- Layout -----

  const outerClassName =
    mode === "fill"
      ? "max-w-2xl mx-auto py-8 px-4 space-y-8"
      : "space-y-4";

  return (
    <div className={outerClassName}>
      {mode === "fill" && (
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{group.title}</h1>
          {group.description && (
            <p className="text-muted-foreground">{group.description}</p>
          )}
        </div>
      )}

      <div className={mode === "fill" ? "space-y-6" : "space-y-4"}>
        {/* Non-repeating questions */}
        {nonRepeatingQuestions.map((q) =>
          mode === "fill" ? (
            renderFillQuestion(q, "")
          ) : (
            <div key={q._id} className="space-y-1 border-b border-foreground/5 pb-3">
              {renderReviewQuestion(q, "")}
            </div>
          ),
        )}

        {/* Repeating collections */}
        {repeatingCollections.map((collection) => {
          const count = resolvedCountByCollection[collection.collectionKey] ?? 1;
          const dependencyQuestion = collection.dependsOnQuestionId
            ? questions.find(
                (dq) => String(dq._id) === String(collection.dependsOnQuestionId),
              )
            : null;

          return (
            <div
              key={collection.collectionKey}
              className={
                mode === "fill"
                  ? "space-y-4 rounded-xl border border-foreground/10 bg-card p-4"
                  : "space-y-3 rounded-xl border border-foreground/10 bg-card p-4"
              }
            >
              {/* Chunk header */}
              <div
                className={
                  mode === "fill"
                    ? "flex flex-wrap items-center justify-between gap-3"
                    : "flex flex-wrap items-center gap-2"
                }
              >
                <div className={mode === "fill" ? "space-y-1" : undefined}>
                  <p className="text-sm font-medium text-foreground">
                    {titleCase(collection.itemLabel)} details
                  </p>
                  {mode === "fill" ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded-full border border-foreground/15 px-2 py-0.5">
                        Repeating chunk ({count})
                      </span>
                      {dependencyQuestion && (
                        <span className="rounded-full border border-foreground/15 px-2 py-0.5">
                          Depends on: {dependencyQuestion.prompt}
                        </span>
                      )}
                    </div>
                  ) : (
                    <>
                      <Badge variant="outline" className="text-[11px]">
                        Repeating chunk ({count})
                      </Badge>
                      {dependencyQuestion && (
                        <Badge variant="outline" className="text-[11px]">
                          Depends on: {dependencyQuestion.prompt}
                        </Badge>
                      )}
                    </>
                  )}
                </div>
                {mode === "fill" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setManualCountByCollection((prev) => ({
                        ...prev,
                        [collection.collectionKey]: Math.min(
                          collection.maxItems,
                          count + 1,
                        ),
                      }))
                    }
                    disabled={count >= collection.maxItems}
                  >
                    Add {collection.itemLabel}
                  </Button>
                )}
              </div>

              {/* Rows */}
              <div className={mode === "fill" ? "space-y-5" : "space-y-4"}>
                {Array.from({ length: count }).map((_, idx) => {
                  const rowKey = `${collection.collectionKey}:${idx}`;
                  return (
                    <div
                      key={rowKey}
                      className="space-y-3 rounded-lg border border-foreground/10 p-3"
                    >
                      <p
                        className={
                          mode === "fill"
                            ? "text-xs font-medium text-muted-foreground"
                            : "text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                        }
                      >
                        {titleCase(collection.itemLabel)} {idx + 1}
                      </p>
                      {collection.questions.map((q) => renderQuestion(q, rowKey))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom actions */}
      {mode === "fill" && (
        <div className="sticky bottom-4 flex justify-end">
          <Button
            onClick={onSubmit}
            disabled={group.status === "accepted" || group.status === "submitted"}
            size="lg"
          >
            Submit Section
          </Button>
        </div>
      )}

      {mode === "review" && group.status === "submitted" && (
        <div className="flex gap-2 pt-2 border-t border-foreground/10">
          <Button variant="outline" className="flex-1" onClick={onReturn}>
            Return to client
          </Button>
          <Button className="flex-1" onClick={onAccept}>
            Accept section
          </Button>
        </div>
      )}
    </div>
  );
}
