/*
 * BACKUP of original convex/lib/auth.ts (before WorkOS migration):
 *
 * import { getAuthUserId } from "@convex-dev/auth/server";
 * import { QueryCtx, MutationCtx } from "../_generated/server";
 * import { Id } from "../_generated/dataModel";
 *
 * type Ctx = QueryCtx | MutationCtx;
 *
 * export async function requireAuth(ctx: Ctx): Promise<Id<"users">> {
 *   const userId = await getAuthUserId(ctx);
 *   if (!userId) {
 *     throw new Error("Not authenticated");
 *   }
 *   return userId;
 * }
 */

import { QueryCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

export type ResolvedUser = {
  userId: Id<"users">;
  orgId: Id<"organizations"> | null;
  onboardingComplete: boolean;
  membershipStatus: "active" | "pending" | null;
};

/**
 * Read-path helper. Returns the current user's resolved state without mutating.
 * Use in queries. Throws if unauthenticated OR if the user row has not yet been
 * materialized (first-call-after-login must go through ensureCurrentUser).
 */
export async function requireUser(ctx: QueryCtx): Promise<ResolvedUser> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const workosUserId = identity.subject;
  const user = await ctx.db
    .query("users")
    .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
    .first();
  if (!user) throw new Error("User not yet initialized — call ensureCurrentUser first");
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .first();
  return {
    userId: user._id,
    orgId: membership?.orgId ?? null,
    onboardingComplete: user.onboardingComplete ?? false,
    membershipStatus: membership?.status ?? null,
  };
}
