"use client";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { QuestionGroupView } from "./question-group-view";
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
  const createFlag = useMutation((api as any).applicationQuestionFlags.create);
  const acceptSection = useMutation((api as any).applicationGroups.acceptSection);
  const returnSection = useMutation((api as any).applicationGroups.returnSection);

  async function handleCreateFlag(
    questionId: Id<"applicationQuestions">,
    rowKey: string,
    type: "comment" | "needs_new_answer",
    message: string,
  ) {
    await createFlag({
      applicationId,
      groupId: group._id,
      questionId,
      flagType: type,
      message,
      ...(rowKey ? { rowKey } : {}),
    });
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
    <QuestionGroupView
      applicationId={applicationId}
      group={group}
      questions={questions}
      answers={answers}
      flags={flags}
      mode="review"
      onCreateFlag={handleCreateFlag}
      onAccept={handleAccept}
      onReturn={handleReturn}
    />
  );
}
