/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  createClientOrg,
  ensurePrimaryInsuranceContact,
  removeMember,
} from "./orgs";

const modules = import.meta.glob("./**/*.ts");
const createClientOrgFn = createClientOrg as any;
const ensurePrimaryContactFn = ensurePrimaryInsuranceContact as any;
const removeMemberFn = removeMember as any;

describe("org primary insurance contact", () => {
  test("sets a newly-created single-member client org primary contact", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "solo@example.com",
      }),
    );

    const orgId = await t
      .withIdentity({ subject: `${userId}|session` })
      .mutation(createClientOrgFn, {
        name: "Solo Client",
      });

    const org = await t.run((ctx) =>
      ctx.db.get(orgId as Id<"organizations">),
    );
    expect(org?.primaryInsuranceContactId).toBe(userId);
  });

  test("repairs an existing one-member org without a primary contact", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Existing Client",
        type: "client",
      });
      const userId = await ctx.db.insert("users", {
        email: "existing@example.com",
      });
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId,
        role: "admin",
      });
      return { orgId, userId };
    });

    const result = await t
      .withIdentity({ subject: `${userId}|session` })
      .mutation(ensurePrimaryContactFn, {});
    const org = await t.run((ctx) => ctx.db.get(orgId));

    expect(result).toMatchObject({ userId, updated: true });
    expect(org?.primaryInsuranceContactId).toBe(userId);
  });

  test("moves primary contact to the only remaining member when removing the current primary", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const adminUserId = await ctx.db.insert("users", {
        email: "admin@example.com",
      });
      const memberUserId = await ctx.db.insert("users", {
        email: "member@example.com",
      });
      const orgId = await ctx.db.insert("organizations", {
        name: "Two Person Client",
        type: "client",
        primaryInsuranceContactId: memberUserId,
      });
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId: adminUserId,
        role: "admin",
      });
      const memberMembershipId = await ctx.db.insert("orgMemberships", {
        orgId,
        userId: memberUserId,
        role: "member",
      });
      return { adminUserId, orgId, memberMembershipId };
    });

    await t
      .withIdentity({ subject: `${seeded.adminUserId}|session` })
      .mutation(removeMemberFn, {
        membershipId: seeded.memberMembershipId,
      });

    const org = await t.run((ctx) => ctx.db.get(seeded.orgId));
    expect(org?.primaryInsuranceContactId).toBe(seeded.adminUserId);
  });
});
