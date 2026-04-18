import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Step 1: Create organizations for all onboarded users and link them as admin members.
 */
export const migrateUsersToOrgs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    let created = 0;
    let skipped = 0;

    for (const user of users) {
      // Skip users without company info or onboarding
      if (!user.companyName && !user.onboardingComplete) {
        skipped++;
        continue;
      }

      // Check if user already has an org membership
      const existing = await ctx.db
        .query("orgMemberships")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .first();
      if (existing) {
        skipped++;
        continue;
      }

      // Create organization from user's company data
      const orgId = await ctx.db.insert("organizations", {
        name: user.companyName || "My Organization",
        website: user.companyWebsite,
        context: user.companyContext,
        industry: user.industry,
        industryVertical: user.industryVertical,
        insuranceBroker: user.insuranceBroker,
        brokerContactName: user.brokerContactName,
        brokerContactEmail: user.brokerContactEmail,
        coiHandling: user.coiHandling === "user" ? "member" : user.coiHandling,
        agentHandle: user.agentHandle,
        primaryInsuranceContactId: user._id,
        onboardingComplete: user.onboardingComplete,
      });

      // Create admin membership
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId: user._id,
        role: "admin",
      });

      created++;
    }

    return { created, skipped };
  },
});

/**
 * Step 1b: Create orgs for any remaining users who were skipped (no companyName / not onboarded).
 * This ensures every user with records gets an org.
 */
export const migrateRemainingUsers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    let created = 0;
    let skipped = 0;

    for (const user of users) {
      const existing = await ctx.db
        .query("orgMemberships")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .first();
      if (existing) {
        skipped++;
        continue;
      }

      const orgId = await ctx.db.insert("organizations", {
        name: user.companyName || user.name || "My Organization",
        website: user.companyWebsite,
        context: user.companyContext,
        industry: user.industry,
        industryVertical: user.industryVertical,
        insuranceBroker: user.insuranceBroker,
        brokerContactName: user.brokerContactName,
        brokerContactEmail: user.brokerContactEmail,
        coiHandling: user.coiHandling === "user" ? "member" : user.coiHandling,
        agentHandle: user.agentHandle,
        primaryInsuranceContactId: user._id,
        onboardingComplete: user.onboardingComplete,
      });

      await ctx.db.insert("orgMemberships", {
        orgId,
        userId: user._id,
        role: "admin",
      });

      created++;
    }

    return { created, skipped };
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
