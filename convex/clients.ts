import { v } from "convex/values";
import { query } from "./_generated/server";
import { getOrgAccess, assertBrokerOrg } from "./lib/access";

export const listForBroker = query({
  args: { brokerOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.brokerOrgId);
    assertBrokerOrg(access);

    // 1. Accepted clients: client orgs whose brokerOrgId matches
    const clientOrgs = await ctx.db
      .query("organizations")
      .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", args.brokerOrgId))
      .collect();

    // 2. Pending invitations: clientInvitations with no clientOrgId set yet
    const pendingInvitations = await ctx.db
      .query("clientInvitations")
      .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", args.brokerOrgId))
      .collect();
    const activeInvites = pendingInvitations.filter(
      (i) => i.status === "pending" && !i.clientOrgId,
    );

    // 3. Per-client aggregation
    const clientRows = await Promise.all(
      clientOrgs.map(async (org) => {
        const [openApps, activePolicies, docs, lastActivityEvent, assignments] =
          await Promise.all([
            // applicationSessions retired — open apps now from applications v2
            ctx.db
              .query("applications")
              .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", org._id))
              .filter((q) =>
                q.and(
                  q.neq(q.field("status"), "complete"),
                  q.neq(q.field("status"), "cancelled"),
                ),
              )
              .collect()
              .then((r) => r.length),
            ctx.db
              .query("policies")
              .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
              .filter((q) =>
                q.and(
                  q.eq(q.field("documentType"), "policy"),
                  q.eq(q.field("extractionStatus"), "complete"),
                ),
              )
              .collect()
              .then((r) => r.length),
            ctx.db
              .query("orgDocuments")
              .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
              .collect()
              .then((r) => r.length),
            ctx.db
              .query("brokerActivity")
              .withIndex("by_brokerOrgId_clientOrgId_createdAt", (q) =>
                q
                  .eq("brokerOrgId", args.brokerOrgId)
                  .eq("clientOrgId", org._id),
              )
              .order("desc")
              .first(),
            ctx.db
              .query("brokerClientAssignments")
              .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", org._id))
              .collect(),
          ]);

        // Determine primary contact from memberships
        const firstMembership = await ctx.db
          .query("orgMemberships")
          .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
          .first();
        const primaryUser = firstMembership
          ? await ctx.db.get(firstMembership.userId)
          : null;

        const onboardingStatus: "onboarding" | "active" =
          org.onboardingComplete ? "active" : "onboarding";

        return {
          clientOrgId: org._id,
          name: org.name,
          primaryContactName: primaryUser?.name,
          primaryContactEmail: primaryUser?.email,
          onboardingStatus,
          createdAt: org._creationTime,
          lastActivityAt: lastActivityEvent?.createdAt,
          openApplicationsCount: openApps,
          activePoliciesCount: activePolicies,
          documentsCount: docs,
          assignedProducerIds: assignments.map((a) => a.producerId),
        };
      }),
    );

    // 4. Pending invite rows (no detail page)
    const inviteRows = activeInvites.map((inv) => ({
      invitationId: inv._id,
      name: inv.clientOrgName ?? "Invited client",
      primaryContactName: inv.primaryContactName,
      primaryContactEmail: inv.primaryContactEmail,
      onboardingStatus: "invited" as const,
      createdAt: inv.createdAt,
      lastActivityAt: undefined,
      openApplicationsCount: 0,
      activePoliciesCount: 0,
      documentsCount: 0,
      assignedProducerIds: [] as string[],
      linkType: inv.linkType,
    }));

    // Sort: lastActivityAt desc, then createdAt desc
    const allRows = [...clientRows, ...inviteRows].sort((a, b) => {
      const aTime = a.lastActivityAt ?? a.createdAt;
      const bTime = b.lastActivityAt ?? b.createdAt;
      return bTime - aTime;
    });

    return allRows;
  },
});
