/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import { startImpersonation } from "./operator";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const startImpersonationFn = startImpersonation as any;

async function seedOperator() {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const fixture = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      name: "Operator",
      email: "operator@example.com",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const firstClientOrgId = await ctx.db.insert("organizations", {
      name: "First client",
      type: "client",
    });
    const secondClientOrgId = await ctx.db.insert("organizations", {
      name: "Second client",
      type: "client",
    });
    return { operatorUserId, firstClientOrgId, secondClientOrgId };
  });

  return {
    t,
    ...fixture,
    operatorSession: t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    }),
  };
}

describe("operator impersonation lifecycle", () => {
  test("reuses the active session when a start request is retried", async () => {
    const { t, operatorSession, firstClientOrgId } = await seedOperator();

    const first = await operatorSession.mutation(startImpersonationFn, {
      targetOrgId: firstClientOrgId,
      targetRole: "admin",
    });
    const retry = await operatorSession.mutation(startImpersonationFn, {
      targetOrgId: firstClientOrgId,
      targetRole: "admin",
    });

    expect(first).toMatchObject({ reused: false });
    expect(retry).toEqual({ sessionId: first.sessionId, reused: true });

    const persisted = await t.run(async (ctx) => ({
      sessions: await ctx.db.query("operatorImpersonationSessions").collect(),
      audits: await ctx.db.query("operatorAuditEvents").collect(),
    }));
    expect(persisted.sessions).toHaveLength(1);
    expect(persisted.sessions[0]).toMatchObject({
      _id: first.sessionId,
      targetOrgId: firstClientOrgId,
      status: "active",
    });
    expect(
      persisted.audits.filter((event) => event.type === "impersonation_started"),
    ).toHaveLength(1);
  });

  test("ends the old session when the operator switches targets", async () => {
    const { t, operatorSession, firstClientOrgId, secondClientOrgId } =
      await seedOperator();

    const first = await operatorSession.mutation(startImpersonationFn, {
      targetOrgId: firstClientOrgId,
      targetRole: "admin",
    });
    const second = await operatorSession.mutation(startImpersonationFn, {
      targetOrgId: secondClientOrgId,
      targetRole: "admin",
    });

    const sessions = await t.run((ctx) =>
      ctx.db.query("operatorImpersonationSessions").collect(),
    );
    const sessionById = new Map(
      sessions.map((session) => [session._id as Id<"operatorImpersonationSessions">, session]),
    );
    expect(sessionById.get(first.sessionId)).toMatchObject({ status: "ended" });
    expect(sessionById.get(second.sessionId)).toMatchObject({
      targetOrgId: secondClientOrgId,
      status: "active",
    });
  });
});
