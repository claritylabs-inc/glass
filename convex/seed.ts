// convex/seed.ts
//
// Deterministic seed: 1 broker org + 2 client orgs.
// Run with: npx convex run seed:seed
// WARNING: this wipes all existing organizations and their memberships.

import { internalMutation, action } from "./_generated/server";
import { internal } from "./_generated/api";

export const seed = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.seed.wipeDemoOrgs);
    const result = await ctx.runMutation(internal.seed.insertDemoData);
    return result;
  },
});

export const wipeDemoOrgs = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Remove all demo-flagged orgs and their memberships
    const orgs = await ctx.db.query("organizations").collect();
    const demoOrgs = orgs.filter(
      (o) => o.name.startsWith("[DEMO]") || o.slug?.startsWith("demo-"),
    );
    for (const org of demoOrgs) {
      const memberships = await ctx.db
        .query("orgMemberships")
        .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
        .collect();
      for (const m of memberships) await ctx.db.delete(m._id);
      await ctx.db.delete(org._id);
    }
    return { wiped: demoOrgs.length };
  },
});

export const insertDemoData = internalMutation({
  args: {},
  handler: async (ctx) => {
    // --- Broker org ---
    const brokerOrgId = await ctx.db.insert("organizations", {
      name: "[DEMO] Acme Insurance Brokers",
      type: "broker",
      slug: "demo-acme",
      brandingColor: "#4F46E5",
      agentDisplayName: "Acme Agent",
      agentHandle: "acme-demo",
      website: "https://acme-brokers.example.com",
      context: "A demo broker organization for testing the Glass platform.",
    });

    const brokerUserId = await ctx.db.insert("users", {
      email: "broker-admin@demo.glass",
      name: "Broker Admin",
      emailVerificationTime: Date.now(),
    });

    await ctx.db.insert("orgMemberships", {
      orgId: brokerOrgId,
      userId: brokerUserId,
      role: "admin",
    });

    // --- Client org 1 ---
    const client1OrgId = await ctx.db.insert("organizations", {
      name: "[DEMO] Techflow Inc",
      type: "client",
      brokerOrgId,
      website: "https://techflow.example.com",
      context: "A mid-size SaaS company requiring tech E&O and GL coverage.",
      industry: "Technology",
      industryVertical: "SaaS",
    });

    const client1UserId = await ctx.db.insert("users", {
      email: "client1-admin@demo.glass",
      name: "Alice (Techflow)",
      emailVerificationTime: Date.now(),
    });

    await ctx.db.insert("orgMemberships", {
      orgId: client1OrgId,
      userId: client1UserId,
      role: "admin",
    });

    // --- Client org 2 ---
    const client2OrgId = await ctx.db.insert("organizations", {
      name: "[DEMO] Green Leaf Consulting",
      type: "client",
      brokerOrgId,
      website: "https://greenleaf.example.com",
      context: "Management consulting firm needing professional liability coverage.",
      industry: "Professional Services",
      industryVertical: "Management Consulting",
    });

    const client2UserId = await ctx.db.insert("users", {
      email: "client2-admin@demo.glass",
      name: "Bob (Green Leaf)",
      emailVerificationTime: Date.now(),
    });

    await ctx.db.insert("orgMemberships", {
      orgId: client2OrgId,
      userId: client2UserId,
      role: "admin",
    });

    return {
      brokerOrgId,
      client1OrgId,
      client2OrgId,
      summary: "Seeded: 1 broker org (Acme), 2 client orgs (Techflow, Green Leaf)",
    };
  },
});
