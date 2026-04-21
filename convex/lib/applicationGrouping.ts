import type { Id } from "../_generated/dataModel";

export type QuestionRow = {
  _id: Id<"applicationQuestions">;
  applicationId: Id<"applications">;
  groupId: Id<"applicationGroups">;
  order: number;
  prompt: string;
  answerType: string;
  required: boolean;
  createdAt: number;
  existingAnswerId?: string; // if set, question is considered answered
};

export type GroupingOutput = {
  groups: {
    title: string;
    description: string | undefined;
    questionIds: string[];
    order: number;
  }[];
};

export type ApplyGroupingResult = {
  groupInserts: { title: string; description?: string; order: number }[];
  questionPatches: { id: Id<"applicationQuestions">; groupId: Id<"applicationGroups">; order: number }[];
};

export function applyGroupingOutput(
  questions: QuestionRow[],
  output: GroupingOutput,
  opts: { existingGroupIdByTitle: Record<string, Id<"applicationGroups">> },
): ApplyGroupingResult {
  const answeredIds = new Set(
    questions.filter((q) => q.existingAnswerId).map((q) => String(q._id)),
  );

  // Build group title → ID map (prefer existing groups)
  const groupInserts: ApplyGroupingResult["groupInserts"] = [];
  const titleToId: Record<string, Id<"applicationGroups">> = { ...opts.existingGroupIdByTitle };

  for (const g of output.groups) {
    if (!titleToId[g.title]) {
      // Will be inserted; use a sentinel that the caller replaces with the real DB ID
      const sentinel = `new:${g.title}` as Id<"applicationGroups">;
      titleToId[g.title] = sentinel;
      groupInserts.push({ title: g.title, description: g.description, order: g.order });
    }
  }

  const questionPatches: ApplyGroupingResult["questionPatches"] = [];

  for (const g of output.groups) {
    const groupId = titleToId[g.title];
    g.questionIds.forEach((qId, idx) => {
      if (answeredIds.has(qId)) {
        // Mid-flight rule: answered questions keep their original group/order
        const original = questions.find((q) => String(q._id) === qId);
        if (original) {
          questionPatches.push({ id: original._id, groupId: original.groupId, order: original.order });
        }
      } else {
        const q = questions.find((q) => String(q._id) === qId);
        if (q) {
          questionPatches.push({ id: q._id, groupId, order: idx });
        }
      }
    });
  }

  return { groupInserts, questionPatches };
}
