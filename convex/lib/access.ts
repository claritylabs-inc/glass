// convex/lib/access.ts
//
// Dual-org permission layer for Glass.
// Every public Convex function that takes an orgId calls getOrgAccess()
// then one or more assertCan* helpers before touching any data.

import { getAuthUserId } from "@convex-dev/auth/server";
import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id, Doc } from "../_generated/dataModel";
import { getActiveOperatorImpersonation, getActiveOperatorProfile } from "./operatorIdentity";

type Ctx = QueryCtx | MutationCtx;

export type OrgAccess = {
  userId: Id<"users">;
  org: Doc<"organizations">;
  orgType: "broker" | "client" | "partner";
  accessType: "member" | "broker_of_client" | "connected_client";
  role: "admin" | "member" | undefined;
  brokerOrgId: Id<"organizations"> | undefined;
  connectedClientOrgId?: Id<"organizations">;
};

export type CurrentOrgAccess = OrgAccess & {
  orgId: Id<"organizations">;
  accessType: "member";
  role: "admin" | "member";
  brokerOrgId: undefined;
};

type PolicyWithOrg = Doc<"policies"> & { orgId: Id<"organizations"> };
type PolicyAccessForQuery = { policy: PolicyWithOrg; access: OrgAccess };

function policyHasOrg(policy: Doc<"policies"> | null): policy is PolicyWithOrg {
  return !!policy?.orgId;
}

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

  const orgType: "broker" | "client" | "partner" =
    (org.type as "broker" | "client" | "partner") ?? "client";

  const impersonation = await getActiveOperatorImpersonation(ctx);
  if (impersonation) {
    const targetOrgType: "broker" | "client" | "partner" =
      (impersonation.targetOrg.type as "broker" | "client" | "partner") ?? "client";
    if (impersonation.session.targetOrgId === orgId) {
      return {
        userId,
        org,
        orgType,
        accessType: "member",
        role: impersonation.session.targetRole,
        brokerOrgId: undefined,
      };
    }
    if (
      targetOrgType === "broker" &&
      orgType === "client" &&
      org.brokerOrgId === impersonation.session.targetOrgId
    ) {
      return {
        userId,
        org,
        orgType: "client",
        accessType: "broker_of_client",
        role: undefined,
        brokerOrgId: impersonation.session.targetOrgId,
      };
    }
  }

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

  // 3. Connected client/vendor access: org members of a client/customer org
  // can read an approved vendor's selected insurance data. This is intentionally
  // one-hop and read-only; vendor access does not imply access to any vendors of
  // that vendor or to its broker portal capabilities.
  const activeRelationships = await ctx.db
    .query("connectedOrgRelationships")
    .withIndex("by_vendorOrgId_status", (q) =>
      q.eq("vendorOrgId", orgId).eq("status", "active"),
    )
    .collect();

  for (const relationship of activeRelationships) {
    const clientMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", relationship.clientOrgId).eq("userId", userId),
      )
      .first();
    if (clientMembership) {
      return {
        userId,
        org,
        orgType,
        accessType: "connected_client",
        role: undefined,
        brokerOrgId: undefined,
        connectedClientOrgId: relationship.clientOrgId,
      };
    }
  }

  throw new Error("Unauthorized");
}

function errorHasMessage(error: unknown, message: string) {
  return error instanceof Error && error.message === message;
}

async function shouldSuppressOperatorTeardownUnauthorized(ctx: Ctx, error: unknown) {
  if (!errorHasMessage(error, "Unauthorized")) return false;
  const [operator, impersonation] = await Promise.all([
    getActiveOperatorProfile(ctx),
    getActiveOperatorImpersonation(ctx),
  ]);
  return !!operator && !impersonation;
}

export async function getOrgAccessForQuery(
  ctx: Ctx,
  orgId: Id<"organizations">,
): Promise<OrgAccess | null> {
  try {
    return await getOrgAccess(ctx, orgId);
  } catch (error) {
    if (await shouldSuppressOperatorTeardownUnauthorized(ctx, error)) return null;
    throw error;
  }
}

function toCurrentOrgAccess(access: OrgAccess): CurrentOrgAccess {
  if (access.accessType !== "member" || !access.role) {
    throw new Error("No organization membership");
  }
  return {
    ...access,
    orgId: access.org._id,
    accessType: "member",
    role: access.role,
    brokerOrgId: undefined,
  };
}

async function getFirstOrgMembershipForUser(ctx: Ctx, userId: Id<"users">) {
  return await ctx.db
    .query("orgMemberships")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
}

async function resolveCurrentOrgAccess(
  ctx: Ctx,
  userId: Id<"users">,
  options: { requireMembership: boolean },
): Promise<CurrentOrgAccess | null> {
  const impersonation = await getActiveOperatorImpersonation(ctx);
  if (impersonation) {
    return toCurrentOrgAccess(await getOrgAccess(ctx, impersonation.session.targetOrgId));
  }

  const membership = await getFirstOrgMembershipForUser(ctx, userId);
  if (!membership) {
    if (options.requireMembership) throw new Error("No organization membership");
    return null;
  }

  try {
    return toCurrentOrgAccess(await getOrgAccess(ctx, membership.orgId));
  } catch (error) {
    if (!options.requireMembership && errorHasMessage(error, "Organization not found")) {
      return null;
    }
    throw error;
  }
}

/**
 * Resolve the viewer's current org context.
 *
 * This is the canonical helper for legacy "current org" surfaces that do not
 * take an explicit orgId. Operator impersonation is treated as current direct
 * membership in the impersonated target org.
 */
export async function requireCurrentOrgAccess(ctx: Ctx): Promise<CurrentOrgAccess> {
  const { userId } = await requireAuth(ctx);
  const access = await resolveCurrentOrgAccess(ctx, userId, { requireMembership: true });
  if (!access) throw new Error("No organization membership");
  return access;
}

/**
 * Non-throwing current-org lookup for query surfaces that can render an empty
 * state while auth or operator impersonation is tearing down.
 */
export async function getCurrentOrgAccess(ctx: Ctx): Promise<CurrentOrgAccess | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await resolveCurrentOrgAccess(ctx, userId, { requireMembership: false });
}

export async function requireCurrentOrgAdmin(ctx: Ctx): Promise<CurrentOrgAccess> {
  const access = await requireCurrentOrgAccess(ctx);
  if (access.role !== "admin") throw new Error("Admin access required");
  return access;
}

// ── Capability helpers ──────────────────────────────────────────────────────

export function assertBrokerOrg(access: OrgAccess): void {
  if (access.orgType !== "broker") throw new Error("Expected a broker organization");
}

export function assertClientOrg(access: OrgAccess): void {
  if (access.orgType !== "client") throw new Error("Expected a client organization");
}

export function assertPartnerOrg(access: OrgAccess): void {
  if (access.orgType !== "partner") throw new Error("Expected a partner organization");
}

export function assertCanReadPassport(_access: OrgAccess): void {
  // member OR broker_of_client OR connected_client
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

export function assertCanReadBrokerVisibleThreads(_access: OrgAccess): void {
  // member OR broker_of_client OR connected_client — no restriction beyond having access
}

export function assertCanReadPolicies(_access: OrgAccess): void {
  // member OR broker_of_client OR connected_client
}

export function assertCanUploadPolicy(access: OrgAccess): void {
  if (access.accessType === "connected_client") {
    throw new Error("Connected clients have read-only vendor access");
  }
  // member OR broker_of_client
}

export function assertCanEditPolicyExtractedFields(access: OrgAccess): void {
  if (access.accessType === "broker_of_client") return;
  if (access.accessType === "member" && access.orgType === "broker") return;
  throw new Error("Only brokers can edit extracted policy fields");
}

export function assertCanDeletePolicy(
  access: OrgAccess,
  policy: { uploadedBySide?: string; uploadedByBrokerOrgId?: Id<"organizations"> },
): void {
  if (access.accessType === "connected_client") {
    throw new Error("Connected clients have read-only vendor access");
  }
  if (access.accessType === "broker_of_client") {
    // Broker can only delete policies they uploaded
    if (
      policy.uploadedBySide !== "broker" ||
      policy.uploadedByBrokerOrgId !== access.brokerOrgId
    ) {
      throw new Error("Not authorized to delete this policy");
    }
  }
  // members can delete any policy in their org
}

export function assertCanReadPolicy(_access: OrgAccess): void {
  // member OR broker_of_client OR connected_client
}

export async function getPolicyAccessForQuery(
  ctx: Ctx,
  policyId: Id<"policies">,
): Promise<PolicyAccessForQuery | null> {
  const result = await resolvePolicyAccessForQuery(ctx, policyId);
  if (!result) return null;
  assertCanReadPolicy(result.access);
  return result;
}

async function resolvePolicyAccessForQuery(
  ctx: Ctx,
  policyId: Id<"policies">,
): Promise<PolicyAccessForQuery | null> {
  const policy = await ctx.db.get(policyId);
  if (!policyHasOrg(policy)) return null;
  const access = await getOrgAccessForQuery(ctx, policy.orgId);
  if (!access) return null;
  return { policy, access };
}

/**
 * Require broker-of-client access to a specific clientOrgId.
 * Returns an OrgAccess with accessType="broker_of_client".
 */
export async function requireBrokerAccessToClient(
  ctx: Ctx,
  clientOrgId: Id<"organizations">,
): Promise<OrgAccess & { brokerOrgId: Id<"organizations"> }> {
  const access = await getOrgAccess(ctx, clientOrgId);
  if (
    access.accessType !== "broker_of_client" ||
    access.orgType !== "client" ||
    !access.brokerOrgId
  ) {
    throw new Error("Broker access required for this client");
  }

  return {
    ...access,
    brokerOrgId: access.brokerOrgId,
  };
}

export async function getBrokerAccessToClientForQuery(
  ctx: Ctx,
  clientOrgId: Id<"organizations">,
): Promise<(OrgAccess & { brokerOrgId: Id<"organizations"> }) | null> {
  try {
    return await requireBrokerAccessToClient(ctx, clientOrgId);
  } catch (error) {
    if (await shouldSuppressOperatorTeardownUnauthorized(ctx, error)) return null;
    throw error;
  }
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

// ── Integration capability helpers ─────────────────────────────────────────

/** member OR broker_of_client */
export function assertCanReadIntegrationsList(_access: OrgAccess): void {
  // no restriction beyond having org access
}

/** member only — creating connections requires being in the client org */
export function assertCanConnectIntegration(access: OrgAccess): void {
  if (access.accessType !== "member") {
    throw new Error("Only org members can connect integrations");
  }
}

/** member only */
export function assertCanDisconnectIntegration(access: OrgAccess): void {
  if (access.accessType !== "member") {
    throw new Error("Only org members can disconnect integrations");
  }
}

/** broker_of_client only — requesting a connection from the client */
export function assertCanRequestIntegration(access: OrgAccess): void {
  if (access.accessType !== "broker_of_client") {
    throw new Error("Only broker users can request integrations from a client");
  }
}

/** member only — raw integration values are never exposed directly to brokers */
export function assertCanReadRawIntegrationData(access: OrgAccess): void {
  if (access.accessType !== "member") {
    throw new Error("Raw integration data is restricted to org members");
  }
}
