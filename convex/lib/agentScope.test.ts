/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import { resolveForAction, validateOperatorInitiatedForAction } from "./agentScope";

const modules = import.meta.glob("../**/*.ts");
const resolveForActionFn = resolveForAction as any;
const validateOperatorInitiatedForActionFn = validateOperatorInitiatedForAction as any;

async function seedOperatorChatFixture() {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    const operatorUserId = await ctx.db.insert("users", {
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
    const impersonationSessionId = await ctx.db.insert("operatorImpersonationSessions", {
      operatorUserId,
      targetOrgId: orgId,
      targetRole: "admin",
      status: "active",
      createdAt: now,
    });
    const threadId = await ctx.db.insert("threads", {
      orgId,
      title: "Support test",
      createdBy: operatorUserId,
      lastMessageAt: now,
      originChannel: "chat",
    });
    const userMessageId = await ctx.db.insert("threadMessages", {
      threadId,
      orgId,
      channel: "chat",
      role: "user",
      userId: operatorUserId,
      userName: "operator@example.com",
      content: "Can you add a named insured?",
      operatorInitiated: {
        operatorUserId,
        operatorEmail: "operator@example.com",
        impersonationSessionId,
        targetOrgId: orgId,
        targetOrgName: "Cove",
        targetRole: "admin",
        displayLabel: "Clarity Labs on behalf of Cove",
        initiatedAt: now,
      },
    });
    return { orgId, operatorUserId, userMessageId };
  });
  return { t, ...ids };
}

describe("agent operator impersonation scope", () => {
  test("allows an operator only through the tagged impersonated chat message", async () => {
    const { t, orgId, operatorUserId, userMessageId } = await seedOperatorChatFixture();

    await expect(
      t.query(resolveForActionFn, {
        orgId,
        userId: operatorUserId,
        surface: "web",
      }),
    ).rejects.toThrow("Unauthorized");

    await expect(
      t.query(validateOperatorInitiatedForActionFn, {
        orgId,
        userId: operatorUserId,
        userMessageId,
      }),
    ).resolves.toMatchObject({
      allowed: true,
      operatorInitiated: {
        displayLabel: "Clarity Labs on behalf of Cove",
      },
    });

    await expect(
      t.query(resolveForActionFn, {
        orgId,
        userId: operatorUserId,
        surface: "web",
        operatorInitiatedUserMessageId: userMessageId,
      }),
    ).resolves.toMatchObject({
      mode: "client",
      primaryOrgId: orgId,
      operatorInitiated: {
        displayLabel: "Clarity Labs on behalf of Cove",
      },
    });
  });
});
