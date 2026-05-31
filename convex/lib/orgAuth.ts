// convex/lib/orgAuth.ts
//
// Compatibility shim — all new code should import from convex/lib/access.ts.
// This file re-exports the old surface so existing callers continue to compile
// while they are migrated one file at a time.

import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id, Doc } from "../_generated/dataModel";
import {
  getCurrentOrgAccess,
  getCurrentOrgForUser,
  requireCurrentOrgAccess,
  requireCurrentOrgAdmin,
  type CurrentOrgAccess,
} from "./access";

type Ctx = QueryCtx | MutationCtx;

export type OrgAccess = {
  userId: Id<"users">;
  orgId: Id<"organizations">;
  role: "admin" | "member";
  org: Doc<"organizations">;
};

function toLegacyOrgAccess(access: CurrentOrgAccess): OrgAccess {
  return {
    userId: access.userId,
    orgId: access.orgId,
    role: access.role,
    org: access.org,
  };
}

/** @deprecated Use requireCurrentOrgAccess from convex/lib/access.ts */
export async function requireOrgAccess(ctx: Ctx): Promise<OrgAccess> {
  return toLegacyOrgAccess(await requireCurrentOrgAccess(ctx));
}

/** @deprecated Use getCurrentOrgAccess from convex/lib/access.ts */
export async function getOrgAccess(ctx: Ctx): Promise<OrgAccess | null> {
  const access = await getCurrentOrgAccess(ctx);
  return access ? toLegacyOrgAccess(access) : null;
}

/** @deprecated Use requireCurrentOrgAdmin from convex/lib/access.ts */
export async function requireOrgAdmin(ctx: Ctx): Promise<OrgAccess> {
  return toLegacyOrgAccess(await requireCurrentOrgAdmin(ctx));
}

/** @deprecated */
export async function getOrgForUser(
  ctx: Ctx,
  userId: Id<"users">,
): Promise<{ orgId: Id<"organizations">; org: Doc<"organizations"> } | null> {
  const access = await getCurrentOrgForUser(ctx, userId);
  return access ? { orgId: access.orgId, org: access.org } : null;
}
