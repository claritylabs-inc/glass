// convex/lib/access.ts
//
// Dual-org permission layer for Glass.
// Every public Convex function that takes an orgId calls getOrgAccess()
// then one or more assertCan* helpers before touching any data.

import { getAuthUserId } from "@convex-dev/auth/server";
import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id, Doc } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

export type OrgAccess = {
  userId: Id<"users">;
  org: Doc<"organizations">;
  orgType: "broker" | "client";
  accessType: "member" | "broker_of_client";
  role: "admin" | "member" | undefined;
  brokerOrgId: Id<"organizations"> | undefined;
};

// ── Auth primitive ──────────────────────────────────────────────────────────

/** Require an authenticated session. Throws if not logged in. */
export async function requireAuth(ctx: Ctx): Promise<{ userId: Id<"users"> }> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  return { userId };
}

// ── Core access resolver ────────────────────────────────────────────────────

/**
 * Resolve the calling user's access to `orgId`.
 *
 * Resolution order:
 * 1. Direct org membership       → accessType = "member"
 * 2. Broker-of-client            → accessType = "broker_of_client"
 *    (user is a member of the broker org that manages this client org)
 * 3. No access                   → throws "Unauthorized"
 */
export async function getOrgAccess(ctx: Ctx, orgId: Id<"organizations">): Promise<OrgAccess> {
  const { userId } = await requireAuth(ctx);

  const org = await ctx.db.get(orgId);
  if (!org) throw new Error("Organization not found");

  const orgType: "broker" | "client" = (org.type as "broker" | "client") ?? "client";

  // 1. Direct membership
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_orgId_userId", (q) => q.eq("orgId", orgId).eq("userId", userId))
    .first();

  if (membership) {
    return {
      userId,
      org,
      orgType,
      accessType: "member",
      role: membership.role,
      brokerOrgId: undefined,
    };
  }

  // 2. Broker-of-client: only applicable when target org is a client with a brokerOrgId
  if (orgType === "client" && org.brokerOrgId) {
    const brokerMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", org.brokerOrgId!).eq("userId", userId),
      )
      .first();

    if (brokerMembership) {
      return {
        userId,
        org,
        orgType: "client",
        accessType: "broker_of_client",
        role: undefined,
        brokerOrgId: org.brokerOrgId,
      };
    }
  }

  throw new Error("Unauthorized");
}

// ── Capability helpers ──────────────────────────────────────────────────────

export function assertBrokerOrg(access: OrgAccess): void {
  if (access.orgType !== "broker") throw new Error("Expected a broker organization");
}

export function assertClientOrg(access: OrgAccess): void {
  if (access.orgType !== "client") throw new Error("Expected a client organization");
}

export function assertCanReadPassport(access: OrgAccess): void {
  // member OR broker_of_client
}

export function assertCanEditPassport(access: OrgAccess): void {
  if (access.accessType !== "member") throw new Error("Only org members can edit the passport");
}

export function assertCanReadEmails(access: OrgAccess): void {
  if (access.accessType !== "member") throw new Error("Email access is restricted to org members");
}

export function assertCanReadInternalThreads(access: OrgAccess): void {
  if (access.accessType !== "member") throw new Error("Internal thread access is restricted to org members");
}

export function assertCanReadBrokerVisibleThreads(access: OrgAccess): void {
  // member OR broker_of_client — no restriction beyond having access
}

export function assertCanReadPolicies(access: OrgAccess): void {
  // member OR broker_of_client
}

export function assertCanUploadPolicy(access: OrgAccess): void {
  // member OR broker_of_client
}

export function assertCanSendApplication(access: OrgAccess): void {
  if (access.accessType !== "broker_of_client") {
    throw new Error("Only broker users can send applications to a client");
  }
}

export function assertCanCompleteApplication(access: OrgAccess): void {
  if (access.accessType !== "member") {
    throw new Error("Only client org members can complete applications");
  }
}

/**
 * Returns an optional source filter for broker-of-client viewers.
 * Broker viewers must not see intelligence derived from emails or chat.
 */
export function assertCanReadIntelligence(
  access: OrgAccess,
): { sourceFilter?: (entry: { source: string }) => boolean } {
  if (access.accessType === "broker_of_client") {
    return {
      sourceFilter: (entry) => entry.source !== "email" && entry.source !== "chat",
    };
  }
  return {};
}

export function assertCanManageBroker(access: OrgAccess): void {
  assertBrokerOrg(access);
  if (access.role !== "admin") throw new Error("Admin role required to manage broker settings");
}

export function assertCanInviteClient(access: OrgAccess): void {
  assertBrokerOrg(access);
  if (access.accessType !== "member") throw new Error("Must be a broker org member to invite clients");
}

export function assertCanInviteTeammate(access: OrgAccess): void {
  if (access.role !== "admin") throw new Error("Admin role required to invite teammates");
}
