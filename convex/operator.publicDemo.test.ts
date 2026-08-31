/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedPublicDemoLead() {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      name: "Demo Operator",
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
    const customerUserId = await ctx.db.insert("users", {
      name: "Customer",
      email: "customer@example.com",
      accountKind: "customer",
    });
    const conversationId = await ctx.db.insert("publicDemoConversations", {
      channel: "email",
      senderHash: "sender-hash",
      senderContact: "lead@example.com",
      leadEmail: "lead@example.com",
      stage: "engaged",
      ctaStatus: "not_shown",
      turnCount: 1,
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const logIds = await Promise.all([
      ctx.db.insert("publicDemoChatLogs", {
        conversationId,
        channel: "email",
        direction: "inbound",
        content: "I need help understanding Spot.",
        createdAt: now,
      }),
      ctx.db.insert("publicDemoChatLogs", {
        conversationId,
        channel: "email",
        direction: "outbound",
        content: "Happy to help.",
        createdAt: now + 1,
      }),
    ]);
    const transcriptId = await ctx.db.insert("publicDemoSalesTranscripts", {
      conversationId,
      channel: "email",
      senderContact: "lead@example.com",
      leadEmail: "lead@example.com",
      stage: "engaged",
      ctaStatus: "not_shown",
      summary: "A demo lead",
      objections: [],
      nextStep: "Continue the conversation",
      curatedTurns: [],
      createdAt: now,
      lastUpdatedAt: now,
    });
    return {
      operatorUserId,
      customerUserId,
      conversationId,
      transcriptId,
      logIds,
    };
  });

  return { t, ...ids };
}

describe("operator public demo leads", () => {
  test("only operators can permanently delete a lead and all of its chat data", async () => {
    const fixture = await seedPublicDemoLead();
    const customer = fixture.t.withIdentity({
      subject: `${fixture.customerUserId}|session`,
    });
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });

    await expect(
      customer.mutation(api.operator.deletePublicDemoSalesTranscript, {
        id: fixture.transcriptId,
      }),
    ).rejects.toThrow();

    await expect(
      operator.mutation(api.operator.deletePublicDemoSalesTranscript, {
        id: fixture.transcriptId,
      }),
    ).resolves.toEqual({ deleted: true, deletedLogs: 2 });

    const persisted = await fixture.t.run(async (ctx) => ({
      conversation: await ctx.db.get(fixture.conversationId),
      transcript: await ctx.db.get(fixture.transcriptId),
      logs: await Promise.all(fixture.logIds.map((id) => ctx.db.get(id))),
      audits: await ctx.db
        .query("operatorAuditEvents")
        .withIndex("operator_created", (q) =>
          q.eq("operatorUserId", fixture.operatorUserId),
        )
        .collect(),
    }));

    expect(persisted).toMatchObject({
      conversation: null,
      transcript: null,
      logs: [null, null],
    });
    expect(persisted.audits).toEqual([
      expect.objectContaining({
        type: "demo_lead_deleted",
        metadata: expect.objectContaining({
          conversationId: fixture.conversationId,
          transcriptId: fixture.transcriptId,
          deletedLogs: 2,
        }),
      }),
    ]);
  });
});
