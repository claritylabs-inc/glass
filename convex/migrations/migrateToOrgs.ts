import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Step 1: RETIRED — migration has already run; user-level company fields are removed from schema.
 */
export const migrateUsersToOrgs = internalMutation({
  args: {},
  handler: async (_ctx) => {
    return { created: 0, skipped: 0, note: "Migration already complete; schema fields removed." };
  },
});

/**
 * Step 1b: RETIRED — migration has already run; user-level company fields are removed from schema.
 */
export const migrateRemainingUsers = internalMutation({
  args: {},
  handler: async (_ctx) => {
    return { created: 0, skipped: 0, note: "Migration already complete; schema fields removed." };
  },
});

/**
 * Step 2: Backfill orgId on all existing records.
 * Run this after migrateUsersToOrgs.
 */
export const backfillOrgId = internalMutation({
  args: {},
  handler: async (ctx) => {
    const counts = {
      emailConnections: 0,
      emails: 0,
      policies: 0,
      agentConversations: 0,
      policyAuditLog: 0,
    };

    // Build userId -> orgId lookup
    const memberships = await ctx.db.query("orgMemberships").collect();
    const userOrgMap = new Map<string, string>();
    for (const m of memberships) {
      userOrgMap.set(m.userId, m.orgId);
    }

    // Backfill emailConnections
    const connections = await ctx.db.query("emailConnections").collect();
    for (const conn of connections) {
      if (conn.orgId) continue;
      const orgId = conn.userId ? userOrgMap.get(conn.userId) : undefined;
      if (orgId) {
        await ctx.db.patch(conn._id, { orgId: orgId as unknown as never });
        counts.emailConnections++;
      }
    }

    // Backfill emails
    const emails = await ctx.db.query("emails").collect();
    for (const email of emails) {
      if ((email as unknown as Record<string, unknown>).orgId) continue;
      const orgId = email.userId ? userOrgMap.get(email.userId) : undefined;
      if (orgId) {
        await ctx.db.patch(email._id, { orgId: orgId as unknown as never });
        counts.emails++;
      }
    }

    // Backfill policies
    const policies = await ctx.db.query("policies").collect();
    for (const policy of policies) {
      if (policy.orgId) continue;
      const orgId = policy.userId ? userOrgMap.get(policy.userId) : undefined;
      if (orgId) {
        await ctx.db.patch(policy._id, { orgId: orgId as unknown as never });
        counts.policies++;
      }
    }

    // Backfill agentConversations
    const conversations = await ctx.db.query("agentConversations").collect();
    for (const conv of conversations) {
      if ((conv as unknown as Record<string, unknown>).orgId) continue;
      const orgId = userOrgMap.get(conv.userId);
      if (orgId) {
        await ctx.db.patch(conv._id, { orgId: orgId as unknown as never });
        counts.agentConversations++;
      }
    }

    // Backfill policyAuditLog
    const auditLogs = await ctx.db.query("policyAuditLog").collect();
    for (const log of auditLogs) {
      if ((log as unknown as Record<string, unknown>).orgId) continue;
      const orgId = userOrgMap.get(log.userId);
      if (orgId) {
        await ctx.db.patch(log._id, { orgId: orgId as unknown as never });
        counts.policyAuditLog++;
      }
    }

    return counts;
  },
});

/**
 * Verification query: confirm all records have orgId set.
 */
export const verifyMigration = internalQuery({
  args: {},
  handler: async (ctx) => {
    const missing = {
      emailConnections: 0,
      emails: 0,
      policies: 0,
      agentConversations: 0,
      policyAuditLog: 0,
    };

    const connections = await ctx.db.query("emailConnections").collect();
    missing.emailConnections = connections.filter((c) => !c.orgId).length;

    const emails = await ctx.db.query("emails").collect();
    missing.emails = emails.filter((e) => !(e as unknown as Record<string, unknown>).orgId).length;

    const policies = await ctx.db.query("policies").collect();
    missing.policies = policies.filter((p) => !p.orgId).length;

    const conversations = await ctx.db.query("agentConversations").collect();
    missing.agentConversations = conversations.filter((c) => !(c as unknown as Record<string, unknown>).orgId).length;

    const auditLogs = await ctx.db.query("policyAuditLog").collect();
    missing.policyAuditLog = auditLogs.filter((l) => !(l as unknown as Record<string, unknown>).orgId).length;

    const total = Object.values(missing).reduce((sum, n) => sum + n, 0);

    return { missing, total, ok: total === 0 };
  },
});
