import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  deletePolicyRowsInBatches,
  type DeletePolicyRowsMutation,
} from "./deletePolicyRowsInBatches";

async function runDeleteLoop(initialRows: number) {
  let remainingRows = initialRows;
  const calls: number[] = [];
  const ctx = {
    async runMutation(
      _mutationRef: DeletePolicyRowsMutation,
      _args: { policyId: Id<"policies"> },
    ) {
      const deleted = Math.min(remainingRows, 50);
      remainingRows -= deleted;
      calls.push(deleted);
      return { deleted };
    },
  };

  const totalDeleted = await deletePolicyRowsInBatches(
    ctx,
    {} as DeletePolicyRowsMutation,
    "policy" as Id<"policies">,
  );

  return { totalDeleted, remainingRows, calls };
}

describe("deletePolicyRowsInBatches", () => {
  test.each([
    { rows: 0, calls: [0] },
    { rows: 50, calls: [50, 0] },
    { rows: 51, calls: [50, 1, 0] },
    { rows: 120, calls: [50, 50, 20, 0] },
  ])("deletes all $rows rows", async ({ rows, calls }) => {
    const result = await runDeleteLoop(rows);

    expect(result.totalDeleted).toBe(rows);
    expect(result.remainingRows).toBe(0);
    expect(result.calls).toEqual(calls);
  });
});
