import type { Id, Doc } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { requireOrgAccess } from "./orgAuth";

type ThreadLike = { orgId: Id<"organizations"> };
type ClientOrgLike = { _id: Id<"organizations">; brokerOrgId?: Id<"organizations"> };

export function evaluateThreadAccess(args: {
  userOrgId: Id<"organizations">;
  thread: ThreadLike;
  clientOrg: ClientOrgLike | null | undefined;
}): "allow" | "deny" {
  if (args.userOrgId === args.thread.orgId) return "allow";
  if (args.clientOrg && args.clientOrg.brokerOrgId === args.userOrgId) return "allow";
  return "deny";
}

export async function requireThreadAccess(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"threads">,
) {
  const { userId, orgId: userOrgId } = await requireOrgAccess(ctx);
  const thread = await ctx.db.get(threadId);
  if (!thread) throw new Error("Thread not found");
  const clientOrg = (await ctx.db.get(thread.orgId)) as Pick<
    Doc<"organizations">,
    "_id" | "brokerOrgId"
  > | null;
  const verdict = evaluateThreadAccess({ userOrgId, thread, clientOrg });
  if (verdict === "deny") throw new Error("Thread not found");
  return {
    userId,
    userOrgId,
    thread,
    role: userOrgId === thread.orgId ? ("owner" as const) : ("broker" as const),
  };
}
