"use client";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { QuestionGroupView } from "./question-group-view";
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

  const { groups, questions, answers, flags } = data as any;

  const group = groups.find((g: any) => g._id === groupId);
  if (!group) return <div className="p-4 text-muted-foreground">Group not found.</div>;

  const groupQuestions = questions.filter((q: any) => q.groupId === groupId);

  async function handleAnswerChange(
    questionId: Id<"applicationQuestions">,
    value: unknown,
    source: "manual" | "integration" | undefined,
    rowKey: string,
  ) {
    const existing = answers.find(
      (a: any) => a.questionId === questionId && a.rowKey === (rowKey || undefined),
    );
    const isIntegrationSource = existing?.source === "integration" && source === "manual";

    await upsertAnswer({
      applicationId,
      questionId,
      rowKey: rowKey || undefined,
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
    <QuestionGroupView
      applicationId={applicationId}
      group={group}
      questions={groupQuestions}
      answers={answers}
      flags={flags}
      mode="fill"
      onAnswerChange={handleAnswerChange}
      onSubmit={handleSubmit}
    />
  );
}
