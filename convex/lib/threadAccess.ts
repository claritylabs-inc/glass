import type { Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { requireCurrentOrgAccess as requireOrgAccess } from "./access";

type ThreadLike = {
  orgId: Id<"organizations">;
  createdBy: Id<"users">;
  visibility?: "broker_visible" | "client_internal" | "user_private";
};
type ClientOrgLike = { _id: Id<"organizations"> };

export function isUserPrivateThread(thread: ThreadLike): boolean {
  return thread.visibility === "user_private";
}

export function evaluateThreadAccess(args: {
  userId: Id<"users">;
  userOrgId: Id<"organizations">;
  thread: ThreadLike;
  clientOrg: ClientOrgLike | null | undefined;
}): "allow" | "deny" {
  if (isUserPrivateThread(args.thread)) {
    return args.userOrgId === args.thread.orgId &&
      args.userId === args.thread.createdBy
      ? "allow"
      : "deny";
  }
  if (args.userOrgId === args.thread.orgId) return "allow";
  return "deny";
}

export function canAccessThread(args: {
  userId: Id<"users">;
  userOrgId: Id<"organizations">;
  thread: ThreadLike;
  clientOrg?: ClientOrgLike | null;
}): boolean {
  return (
    evaluateThreadAccess({ ...args, clientOrg: args.clientOrg }) === "allow"
  );
}

export async function requireThreadAccess(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"threads">,
) {
  const { userId, orgId: userOrgId } = await requireOrgAccess(ctx);
  const thread = await ctx.db.get(threadId);
  if (!thread) throw new Error("Thread not found");
  const verdict = evaluateThreadAccess({
    userId,
    userOrgId,
    thread,
    clientOrg: null,
  });
  if (verdict === "deny") throw new Error("Thread not found");
  return {
    userId,
    userOrgId,
    thread,
    role: "owner" as const,
  };
}
