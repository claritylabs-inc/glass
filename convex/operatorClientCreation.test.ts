/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("creates a client without provisioning users", async () => {
  const t = convexTest(schema, modules);
  const operatorUserId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "operator@glass.insure",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId,
      email: "operator@glass.insure",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    return userId;
  });
  const operator = t.withIdentity({ subject: `${operatorUserId}|session` });

  const result = await operator.action(api.operator.createSoloClient, {
    name: "Client Without Users",
    users: [],
  });

  const state = await t.run(async (ctx) => {
    const client = await ctx.db.get(result.clientOrgId);
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("organization", (q) => q.eq("orgId", result.clientOrgId))
      .collect();
    const authAccounts = await ctx.db.query("authAccounts").collect();
    const audit = await ctx.db
      .query("operatorAuditEvents")
      .withIndex("target_created", (q) =>
        q.eq("targetOrgId", result.clientOrgId),
      )
      .unique();
    return { client, memberships, authAccounts, audit };
  });

  expect(state.client).toMatchObject({
    name: "Client Without Users",
    type: "client",
    operatorStatus: "onboarding",
    allowedEmails: [],
  });
  expect(state.client).not.toHaveProperty("primaryInsuranceContactId");
  expect(state.memberships).toEqual([]);
  expect(state.authAccounts).toEqual([]);
  expect(state.audit).toMatchObject({
    type: "client_created",
    metadata: expect.objectContaining({ userCount: 0, adminCount: 0 }),
  });
  expect(state.audit?.targetUserId).toBeUndefined();
});
