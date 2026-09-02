import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Canonical requirements outlive a procurement project. Any edit to one must
// invalidate every proposal review whose project references it.
export async function invalidateProcurementReviewsForRequirement(
  ctx: MutationCtx,
  requirementId: Id<"insuranceRequirements">,
  updatedByUserId: Id<"users">,
  updatedAt: number,
) {
  const links = await ctx.db
    .query("procurementRequestRequirements")
    .withIndex("requirement", (q) => q.eq("requirementId", requirementId))
    .collect();
  for (const link of links) {
    const request = await ctx.db.get(link.requestId);
    if (!request) continue;
    await ctx.db.patch(request._id, {
      requirementRevision: (request.requirementRevision ?? 0) + 1,
      updatedByUserId,
      updatedAt,
    });
  }
  return links.length;
}
