import { query } from "./_generated/server";
import { requireOperator } from "./lib/operatorIdentity";

export const auditLegacyNarrowing = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const [clients, policies, outreaches, settings, rules, jobs, attempts] =
      await Promise.all([
        ctx.db
          .query("organizations")
          .withIndex("type", (q) => q.eq("type", "client"))
          .collect(),
        ctx.db.query("policies").collect(),
        ctx.db.query("procurementBrokerOutreaches").collect(),
        ctx.db.query("policyDeliverySettings").collect(),
        ctx.db.query("policyDeliveryRules").collect(),
        ctx.db.query("policyDeliveryJobs").collect(),
        ctx.db.query("policyDeliveryAttempts").collect(),
      ]);
    const brokerOwnedClients = clients.filter((client) => client.brokerOrgId);
    const brokerUploadedPolicies = policies.filter(
      (policy) =>
        policy.uploadedBySide === "broker" || policy.uploadedByBrokerOrgId,
    );
    const unlinkedOutreaches = outreaches.filter(
      (outreach) => !outreach.brokerOrgId,
    );
    const blockers = {
      brokerOwnedClients: brokerOwnedClients.length,
      brokerUploadedPolicies: brokerUploadedPolicies.length,
      unlinkedOutreaches: unlinkedOutreaches.length,
    };
    return {
      safe: Object.values(blockers).every((count) => count === 0),
      blockers,
      samples: {
        brokerOwnedClientIds: brokerOwnedClients
          .slice(0, 25)
          .map((row) => row._id),
        brokerUploadedPolicyIds: brokerUploadedPolicies
          .slice(0, 25)
          .map((row) => row._id),
        unlinkedOutreachIds: unlinkedOutreaches
          .slice(0, 25)
          .map((row) => row._id),
      },
      purgeCounts: {
        settings: settings.length,
        rules: rules.length,
        jobs: jobs.length,
        attempts: attempts.length,
      },
    };
  },
});
