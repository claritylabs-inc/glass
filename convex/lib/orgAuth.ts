// convex/lib/orgAuth.ts
//
// Compatibility shim — all new code should import from convex/lib/access.ts.
// This file re-exports the old surface so existing callers continue to compile
// while they are migrated one file at a time.

import { getAuthUserId } from "@convex-dev/auth/server";
import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id, Doc } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

export type OrgAccess = {
  userId: Id<"users">;
  orgId: Id<"organizations">;
  role: "admin" | "member";
  org: Doc<"organizations">;
};

/** @deprecated Use getOrgAccess from convex/lib/access.ts */
export async function requireOrgAccess(ctx: Ctx): Promise<OrgAccess> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");

  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (!membership) throw new Error("No organization membership");

  const org = await ctx.db.get(membership.orgId);
  if (!org) throw new Error("Organization not found");

  return { userId, orgId: membership.orgId, role: membership.role, org };
}

/** @deprecated Use getOrgAccess from convex/lib/access.ts */
export async function getOrgAccess(ctx: Ctx): Promise<OrgAccess | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;

  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (!membership) return null;

  const org = await ctx.db.get(membership.orgId);
  if (!org) return null;

  return { userId, orgId: membership.orgId, role: membership.role, org };
}

/** @deprecated Use getOrgAccess from convex/lib/access.ts */
export async function requireOrgAdmin(ctx: Ctx): Promise<OrgAccess> {
  const access = await requireOrgAccess(ctx);
  if (access.role !== "admin") throw new Error("Admin access required");
  return access;
}

/** @deprecated */
export async function getOrgForUser(
  ctx: Ctx,
  userId: Id<"users">,
): Promise<{ orgId: Id<"organizations">; org: Doc<"organizations"> } | null> {
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (!membership) return null;
  const org = await ctx.db.get(membership.orgId);
  if (!org) return null;
  return { orgId: membership.orgId, org };
}
