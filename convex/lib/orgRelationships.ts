import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./userFacingErrors";

type Ctx = QueryCtx | MutationCtx;

/**
 * Asserts that brokerOrgId is a broker of clientOrgId (i.e., an assignment exists).
 * Throws if no relationship is found.
 */
export async function assertBrokerOfClient(
  ctx: Ctx,
  brokerOrgId: Id<"organizations">,
  clientOrgId: Id<"organizations">,
): Promise<void> {
  const assignment = await ctx.db
    .query("brokerClientAssignments")
    .withIndex("by_orgId_clientOrgId", (q) =>
      q.eq("orgId", brokerOrgId).eq("clientOrgId", clientOrgId),
    )
    .first();
  if (assignment) return;

  // Fallback: legacy implicit relationship via organizations.brokerOrgId
  const clientOrg = await ctx.db.get(clientOrgId);
  if (clientOrg?.brokerOrgId === brokerOrgId) return;

  throwUserFacingError(
    userFacingErrorCodes.orgAccessRequired,
    "This brokerage is not authorized to access the selected client.",
  );
}

/**
 * Returns true if a broker–client relationship exists.
 */
export async function hasBrokerClientRelationship(
  ctx: Ctx,
  brokerOrgId: Id<"organizations">,
  clientOrgId: Id<"organizations">,
): Promise<boolean> {
  const assignment = await ctx.db
    .query("brokerClientAssignments")
    .withIndex("by_orgId_clientOrgId", (q) =>
      q.eq("orgId", brokerOrgId).eq("clientOrgId", clientOrgId),
    )
    .first();
  return assignment !== null;
}
