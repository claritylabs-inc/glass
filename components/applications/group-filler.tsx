"use client";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { QuestionField } from "./question-field";
import { evaluateConditional } from "@/lib/applicationConditionals";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";

type Props = {
  applicationId: Id<"applications">;
  groupId: Id<"applicationGroups">;
};

export function GroupFiller({ applicationId, groupId }: Props) {
  const data = useQuery((api as any).applications.get, { applicationId });
  const upsertAnswer = useMutation((api as any).applicationAnswers.upsert);
  const submitGroup = useMutation((api as any).applicationGroups.submit);
  const [manualCountByCollection, setManualCountByCollection] = useState<Record<string, number>>({});

  if (!data) return <div className="p-4 text-muted-foreground">Loading…</div>;

  const { groups, questions, answers, flags } = data as {
    groups: Array<{ _id: Id<"applicationGroups">; title: string; description?: string; status: string }>;
    questions: Array<{ _id: Id<"applicationQuestions">; groupId: Id<"applicationGroups">; order: number; prompt: string; answerType: string; required: boolean; conditional?: unknown; repeating?: { collectionKey: string; itemLabel: string; dependsOnQuestionId?: Id<"applicationQuestions">; minItems?: number; maxItems?: number }; helpText?: string; intentKey?: string; selectOptions?: { value: string; label: string }[]; createdAt: number; placedByAi?: boolean }>;
    answers: Array<{ _id: Id<"applicationAnswers">; questionId: Id<"applicationQuestions">; value?: unknown; source: string; rowKey?: string; sourceRef?: string; overrideOfIntegration?: { connectorKey: string; syncedValue: unknown; syncedAt: number; overriddenAt: number }; status: string; answeredAt: number; answeredByUserId?: Id<"users"> }>;
    flags: Array<{ _id: Id<"applicationQuestionFlags">; questionId: Id<"applicationQuestions">; flagType: string; message: string; status: string; groupId: Id<"applicationGroups">; applicationId: Id<"applications">; authorUserId: Id<"users">; rowKey?: string; createdAt: number; resolvedAt?: number }>;
  };

  const group = groups.find((g) => g._id === groupId);
  if (!group) return <div className="p-4 text-muted-foreground">Group not found.</div>;

  const groupQuestions = questions
    .filter((q) => q.groupId === groupId)
    .sort((a, b) => a.order - b.order);

  const answerValueMap: Record<string, unknown> = {};
  for (const a of answers) {
    answerValueMap[String(a.questionId)] = a.value;
  }

  const visibleQuestions = groupQuestions.filter((q) => {
    if (!q.conditional) return true;
    return evaluateConditional(q.conditional as Parameters<typeof evaluateConditional>[0], answerValueMap);
  });

  async function handleChange(questionId: Id<"applicationQuestions">, value: unknown, source?: "manual", rowKey?: string) {
    const existing = answers.find((a) => a.questionId === questionId && a.rowKey === rowKey);
    const isIntegrationSource = existing?.source === "integration" && source === "manual";

    await upsertAnswer({
      applicationId,
      questionId,
      rowKey,
      value,
      source: source ?? "manual",
      overrideOfIntegration:
        isIntegrationSource && existing?.overrideOfIntegration === undefined
          ? {
              connectorKey: existing.sourceRef ?? "integration",
              syncedValue: existing.value,
              syncedAt: existing.answeredAt,
              overriddenAt: Date.now(),
            }
          : existing?.overrideOfIntegration,
    });
  }

  async function handleSubmit() {
    try {
      await submitGroup({ groupId });
      toast.success("Section submitted!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit");
    }
  }

  const toSafeCount = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return Math.floor(parsed);
    }
    return null;
  };

  const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

  const nonRepeatingQuestions = visibleQuestions.filter((q) => !q.repeating);
  const repeatingCollections = useMemo(() => {
    const map = new Map<
      string,
      {
        collectionKey: string;
        itemLabel: string;
        dependsOnQuestionId?: Id<"applicationQuestions">;
        minItems: number;
        maxItems: number;
        questions: typeof visibleQuestions;
      }
    >();
    for (const q of visibleQuestions) {
      if (!q.repeating) continue;
      const key = q.repeating.collectionKey;
      const existing = map.get(key);
      if (existing) {
        existing.questions.push(q);
        existing.minItems = Math.max(existing.minItems, q.repeating.minItems ?? 1);
        existing.maxItems = Math.max(existing.maxItems, q.repeating.maxItems ?? 25);
        if (!existing.dependsOnQuestionId && q.repeating.dependsOnQuestionId) {
          existing.dependsOnQuestionId = q.repeating.dependsOnQuestionId;
        }
      } else {
        map.set(key, {
          collectionKey: key,
          itemLabel: q.repeating.itemLabel,
          dependsOnQuestionId: q.repeating.dependsOnQuestionId,
          minItems: Math.max(1, q.repeating.minItems ?? 1),
          maxItems: Math.max(1, q.repeating.maxItems ?? 25),
          questions: [q] as typeof visibleQuestions,
        });
      }
    }
    return Array.from(map.values()).map((c) => ({
      ...c,
      questions: [...c.questions].sort((a, b) => a.order - b.order),
    }));
  }, [visibleQuestions]);

  const resolvedCountByCollection = useMemo(() => {
    const result: Record<string, number> = {};
    for (const collection of repeatingCollections) {
      let dependencyCount = collection.minItems;
      if (collection.dependsOnQuestionId) {
        const depRaw = answerValueMap[String(collection.dependsOnQuestionId)];
        const parsed = toSafeCount(depRaw);
        if (parsed !== null) {
          dependencyCount = Math.max(collection.minItems, Math.min(collection.maxItems, parsed));
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

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{group.title}</h1>
        {group.description && (
          <p className="text-muted-foreground">{group.description}</p>
        )}
      </div>

      <div className="space-y-6">
        {nonRepeatingQuestions.map((q) => {
          const questionFlags = flags.filter(
            (f) => f.questionId === q._id && f.status === "open",
          );
          const answer = answers.find((a) => a.questionId === q._id && !a.rowKey);
          return (
            <QuestionField
              key={q._id}
              question={q as any}
              answer={answer as any}
              flags={questionFlags as any}
              onChange={(v, src) => handleChange(q._id, v, src)}
            />
          );
        })}

        {repeatingCollections.map((collection) => {
          const count = resolvedCountByCollection[collection.collectionKey] ?? 1;
          const dependencyQuestion = collection.dependsOnQuestionId
            ? questions.find((dq) => String(dq._id) === String(collection.dependsOnQuestionId))
            : null;
          return (
            <div key={collection.collectionKey} className="space-y-4 rounded-xl border border-foreground/10 bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">{titleCase(collection.itemLabel)} details</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full border border-foreground/15 px-2 py-0.5">Repeating chunk ({count})</span>
                    {dependencyQuestion ? (
                      <span className="rounded-full border border-foreground/15 px-2 py-0.5">
                        Depends on: {dependencyQuestion.prompt}
                      </span>
                    ) : null}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setManualCountByCollection((prev) => ({
                      ...prev,
                      [collection.collectionKey]: Math.min(collection.maxItems, count + 1),
                    }))
                  }
                  disabled={count >= collection.maxItems}
                >
                  Add {collection.itemLabel}
                </Button>
              </div>

              <div className="space-y-5">
                {Array.from({ length: count }).map((_, idx) => {
                  const rowKey = `${collection.collectionKey}:${idx}`;
                  return (
                    <div key={rowKey} className="space-y-3 rounded-lg border border-foreground/10 p-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        {titleCase(collection.itemLabel)} {idx + 1}
                      </p>
                      {collection.questions.map((q) => {
                        const questionFlags = flags.filter(
                          (f) =>
                            f.questionId === q._id &&
                            f.status === "open" &&
                            (f.rowKey ?? "") === rowKey,
                        );
                        const answer = answers.find((a) => a.questionId === q._id && a.rowKey === rowKey);
                        return (
                          <QuestionField
                            key={`${q._id}-${rowKey}`}
                            question={q as any}
                            answer={answer as any}
                            flags={questionFlags as any}
                            inputName={`${q._id}-${rowKey}`}
                            onChange={(v, src) => handleChange(q._id, v, src, rowKey)}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-4 flex justify-end">
        <Button
          onClick={handleSubmit}
          disabled={group.status === "accepted" || group.status === "submitted"}
          size="lg"
        >
          Submit Section
        </Button>
      </div>
    </div>
  );
}
