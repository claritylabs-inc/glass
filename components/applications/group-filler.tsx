"use client";
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

  if (!data) return <div className="p-4 text-muted-foreground">Loading…</div>;

  const { groups, questions, answers, flags } = data as {
    groups: Array<{ _id: Id<"applicationGroups">; title: string; description?: string; status: string }>;
    questions: Array<{ _id: Id<"applicationQuestions">; groupId: Id<"applicationGroups">; order: number; prompt: string; answerType: string; required: boolean; conditional?: unknown; helpText?: string; intentKey?: string; selectOptions?: { value: string; label: string }[]; createdAt: number; placedByAi?: boolean }>;
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

  async function handleChange(questionId: Id<"applicationQuestions">, value: unknown, source?: "manual") {
    const existing = answers.find((a) => a.questionId === questionId);
    const isIntegrationSource = existing?.source === "integration" && source === "manual";

    await upsertAnswer({
      applicationId,
      questionId,
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

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{group.title}</h1>
        {group.description && (
          <p className="text-muted-foreground">{group.description}</p>
        )}
      </div>

      <div className="space-y-6">
        {visibleQuestions.map((q) => {
          const answer = answers.find((a) => a.questionId === q._id);
          const questionFlags = flags.filter(
            (f) => f.questionId === q._id && f.status === "open",
          );
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
