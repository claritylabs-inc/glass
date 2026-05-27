import { v } from "convex/values";
import { query, internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getOrgAccess, assertBrokerOrg } from "./lib/access";

function isEmailLike(value: string | undefined): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

async function getClientDetailRecord(ctx: QueryCtx, clientOrgId: Id<"organizations">) {
  const org = await ctx.db.get(clientOrgId);
  if (!org || org.type !== "client") return null;

  const firstMembership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_orgId", (q) => q.eq("orgId", clientOrgId))
    .first();
  const primaryUser = firstMembership ? await ctx.db.get(firstMembership.userId) : null;

  return {
    clientOrgId: org._id,
    name: org.name?.trim() || "Client",
    legalName: org.name,
    website: org.website,
    industry: org.industry,
    context: org.context,
    onboardingComplete: !!org.onboardingComplete,
    primaryContactName: primaryUser?.name,
    primaryContactEmail: primaryUser?.email,
  };
}

async function listRowsForBroker(ctx: QueryCtx, brokerOrgId: Id<"organizations">) {
  const clientOrgs = await ctx.db
    .query("organizations")
    .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", brokerOrgId))
    .collect();

  const pendingInvitations = await ctx.db
    .query("clientInvitations")
    .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", brokerOrgId))
    .collect();
  // Legacy invites created without a pre-existing client org.
  const activeInvites = pendingInvitations.filter((i) => i.status === "pending" && !i.clientOrgId);

  // Drafts + invited-but-not-accepted orgs are surfaced as their own rows.
  const draftOrgs = clientOrgs.filter((o) => o.inviteStatus === "draft" || o.inviteStatus === "invited");
  const acceptedOrgs = clientOrgs.filter((o) => !o.inviteStatus);

  const draftRows = draftOrgs.map((org) => {
    const policiesCountPromise = ctx.db
      .query("policies")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect()
      .then((r) => r.filter((p) => !p.deletedAt).length);
    return { org, policiesCountPromise };
  });

  const clientRows = await Promise.all(
    acceptedOrgs.map(async (org) => {
      const [activePolicies, lastActivityEvent, assignments] = await Promise.all([
        ctx.db
          .query("policies")
          .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
          .filter((q) =>
            q.and(
              q.eq(q.field("documentType"), "policy"),
              q.eq(q.field("pipelineStatus"), "complete"),
            ),
          )
          .collect()
          .then((r) => r.length),
        ctx.db
          .query("brokerActivity")
          .withIndex("by_brokerOrgId_clientOrgId_createdAt", (q) =>
            q.eq("brokerOrgId", brokerOrgId).eq("clientOrgId", org._id),
          )
          .order("desc")
          .first(),
        ctx.db
          .query("brokerClientAssignments")
          .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", org._id))
          .collect(),
      ]);

      const firstMembership = await ctx.db
        .query("orgMemberships")
        .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
        .first();
      const primaryUser = firstMembership ? await ctx.db.get(firstMembership.userId) : null;

      const onboardingStatus: "onboarding" | "active" = org.onboardingComplete ? "active" : "onboarding";

      const orgName = org.name?.trim();
      const displayName =
        orgName && !isEmailLike(orgName) ? orgName : "Client organization";
      const primaryContactName = primaryUser?.name;
      const primaryAssignment =
        assignments.find((assignment) => assignment.role === "primary") ?? assignments[0];

      return {
        clientOrgId: org._id,
        name: displayName,
        primaryContactName,
        primaryContactEmail: primaryUser?.email,
        onboardingStatus,
        createdAt: org._creationTime,
        lastActivityAt: lastActivityEvent?.createdAt,
        activePoliciesCount: activePolicies,
        assignedProducerIds: assignments.map((a) => a.producerId),
        primaryBrokerContactId: primaryAssignment?.producerId,
      };
    }),
  );

  const resolvedDraftRows = await Promise.all(
    draftRows.map(async ({ org, policiesCountPromise }) => {
      const policiesCount = await policiesCountPromise;
      const status = org.inviteStatus === "invited" ? "invited" : "draft";
      return {
        clientOrgId: org._id,
        name: org.name,
        primaryContactName: org.primaryContactName,
        primaryContactEmail: org.primaryContactEmail,
        onboardingStatus: status as "invited" | "draft",
        createdAt: org._creationTime,
        lastActivityAt: undefined,
        activePoliciesCount: policiesCount,
        assignedProducerIds: [] as string[],
      };
    }),
  );

  const inviteRows = activeInvites.map((inv) => ({
    invitationId: inv._id,
    name: inv.clientOrgName ?? "Invited client",
    primaryContactName: inv.primaryContactName,
    primaryContactEmail: inv.primaryContactEmail,
    onboardingStatus: "invited" as const,
    createdAt: inv.createdAt,
    lastActivityAt: undefined,
    activePoliciesCount: 0,
    assignedProducerIds: [] as string[],
  }));

  return [...clientRows, ...resolvedDraftRows, ...inviteRows].sort((a, b) => {
    const aTime = a.lastActivityAt ?? a.createdAt;
    const bTime = b.lastActivityAt ?? b.createdAt;
    return bTime - aTime;
  });
}

async function assertBrokerMembership(ctx: QueryCtx, brokerOrgId: Id<"organizations">, userId: Id<"users">) {
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_orgId_userId", (q) => q.eq("orgId", brokerOrgId).eq("userId", userId))
    .first();
  if (!membership) throw new Error("Unauthorized");

  const org = await ctx.db.get(brokerOrgId);
  if (!org || org.type !== "broker") throw new Error("Expected a broker organization");
}

export const listForBroker = query({
  args: { brokerOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.brokerOrgId);
    assertBrokerOrg(access);
    return await listRowsForBroker(ctx, args.brokerOrgId);
  },
});

export const listForBrokerInternal = internalQuery({
  args: { brokerOrgId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, args) => {
    await assertBrokerMembership(ctx, args.brokerOrgId, args.userId);
    return await listRowsForBroker(ctx, args.brokerOrgId);
  },
});

export const getDetail = query({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    let access;
    try {
      access = await getOrgAccess(ctx, args.clientOrgId);
    } catch {
      return null;
    }
    if (access.orgType !== "client") throw new Error("Expected a client organization");
    return await getClientDetailRecord(ctx, args.clientOrgId);
  },
});

export const getDetailInternal = internalQuery({
  args: {
    brokerOrgId: v.id("organizations"),
    clientOrgId: v.id("organizations"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await assertBrokerMembership(ctx, args.brokerOrgId, args.userId);
    const clientOrg = await ctx.db.get(args.clientOrgId);
    if (!clientOrg || clientOrg.type !== "client" || clientOrg.brokerOrgId !== args.brokerOrgId) {
      return null;
    }
    return await getClientDetailRecord(ctx, args.clientOrgId);
  },
});
