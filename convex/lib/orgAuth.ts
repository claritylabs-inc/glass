import { requireUser } from "./auth";
import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id, Doc } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

export type OrgAccess = {
  userId: Id<"users">;
  orgId: Id<"organizations">;
  role: "admin" | "member";
  org: Doc<"organizations">;
};

/**
 * Require authenticated user with org membership.
 * Used by all public queries/mutations that need org scoping.
 */
export async function requireOrgAccess(ctx: Ctx): Promise<OrgAccess> {
  const { userId } = await requireUser(ctx);

  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();

  if (!membership) {
    throw new Error("No organization membership");
  }

  const org = await ctx.db.get(membership.orgId);
  if (!org) {
    throw new Error("Organization not found");
  }

  return { userId, orgId: membership.orgId, role: membership.role, org };
}

/**
 * Like requireOrgAccess but returns null instead of throwing when user has no org.
 * Use for queries that may be called during onboarding before org exists.
 */
export async function getOrgAccess(ctx: Ctx): Promise<OrgAccess | null> {
  let userId: Id<"users">;
  try {
    ({ userId } = await requireUser(ctx));
  } catch {
    return null;
  }

  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();

  if (!membership) return null;

  const org = await ctx.db.get(membership.orgId);
  if (!org) return null;

  return { userId, orgId: membership.orgId, role: membership.role, org };
}

/**
 * Require authenticated user with admin role in their org.
 */
export async function requireOrgAdmin(ctx: Ctx): Promise<OrgAccess> {
  const access = await requireOrgAccess(ctx);
  if (access.role !== "admin") {
    throw new Error("Admin access required");
  }
  return access;
}

/**
 * Get org for a given userId. Used by internal functions that receive userId as arg.
 * Returns null if user has no org membership.
 */
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
