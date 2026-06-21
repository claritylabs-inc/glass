import type { FunctionReference } from "convex/server";
import type { Id } from "../_generated/dataModel";

export type DeletePolicyRowsMutation = FunctionReference<
  "mutation",
  "internal",
  { policyId: Id<"policies"> },
  { deleted: number }
>;

type DeletePolicyRowsCtx = {
  runMutation(
    mutationRef: DeletePolicyRowsMutation,
    args: { policyId: Id<"policies"> },
  ): Promise<{ deleted: number }>;
};

export async function deletePolicyRowsInBatches(
  ctx: DeletePolicyRowsCtx,
  mutationRef: DeletePolicyRowsMutation,
  policyId: Id<"policies">,
) {
  let totalDeleted = 0;
  for (;;) {
    const result = await ctx.runMutation(mutationRef, { policyId });
    totalDeleted += result.deleted;
    if (result.deleted === 0) return totalDeleted;
  }
}
