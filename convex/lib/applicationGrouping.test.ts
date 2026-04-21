import { describe, it, expect } from "vitest";
import { applyGroupingOutput, type GroupingOutput, type QuestionRow } from "./applicationGrouping";

const makeQuestion = (id: string, answerId?: string): QuestionRow => ({
  _id: id as Parameters<typeof applyGroupingOutput>[0][0]["_id"],
  prompt: `Q ${id}`,
  answerType: "text",
  required: true,
  order: 0,
  groupId: "old-group" as Parameters<typeof applyGroupingOutput>[0][0]["groupId"],
  applicationId: "app1" as Parameters<typeof applyGroupingOutput>[0][0]["applicationId"],
  createdAt: 0,
  existingAnswerId: answerId,
});

describe("applyGroupingOutput — mid-flight regrouping rule", () => {
  it("answered questions keep their original groupId and order", () => {
    const questions: QuestionRow[] = [
      makeQuestion("q1", "ans1"), // answered
      makeQuestion("q2"),         // unanswered
    ];
    const output: GroupingOutput = {
      groups: [
        { title: "Group A", description: undefined, questionIds: ["q2", "q1"], order: 0 },
      ],
    };
    const result = applyGroupingOutput(questions, output, {
      existingGroupIdByTitle: {},
    });
    // q1 is answered — its groupId stays "old-group"
    const q1 = result.questionPatches.find((p) => p.id === "q1");
    expect(q1?.groupId).toBe("old-group");
    // q2 is unanswered — it gets placed into the new group
    const q2 = result.questionPatches.find((p) => p.id === "q2");
    expect(q2?.groupId).toBeDefined();
    expect(q2?.groupId).not.toBe("old-group");
  });

  it("creates a new group row for each distinct title in AI output", () => {
    const questions: QuestionRow[] = [makeQuestion("q1")];
    const output: GroupingOutput = {
      groups: [{ title: "Financials", description: "Money stuff", questionIds: ["q1"], order: 0 }],
    };
    const result = applyGroupingOutput(questions, output, { existingGroupIdByTitle: {} });
    expect(result.groupInserts).toHaveLength(1);
    expect(result.groupInserts[0].title).toBe("Financials");
  });

  it("reuses an existing group when title already exists", () => {
    const questions: QuestionRow[] = [makeQuestion("q1")];
    const output: GroupingOutput = {
      groups: [{ title: "Financials", description: undefined, questionIds: ["q1"], order: 0 }],
    };
    const result = applyGroupingOutput(questions, output, {
      existingGroupIdByTitle: { Financials: "existing-group-id" as Parameters<typeof applyGroupingOutput>[0][0]["groupId"] },
    });
    expect(result.groupInserts).toHaveLength(0);
    const q1 = result.questionPatches.find((p) => p.id === "q1");
    expect(q1?.groupId).toBe("existing-group-id");
  });
});
