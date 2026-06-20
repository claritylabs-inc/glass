/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { listForAgentInternal } from "./policyChanges";

const modules = import.meta.glob("./**/*.ts");
const listForAgentInternalFn = listForAgentInternal as any;

async function seedPolicyChangeCases(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Clarity Labs",
      type: "client",
    });
    const otherOrgId = await ctx.db.insert("organizations", {
      name: "Other Client",
      type: "client",
    });
    const userId = await ctx.db.insert("users", {
      name: "Terry",
      email: "terry@example.com",
    });
    const activeCaseId = await ctx.db.insert("policyChangeCases", {
      orgId,
      requestText: "Change the mailing address on the cyber policy.",
      sourceKind: "imessage",
      status: "needs_info",
      summary: "Change the mailing address",
      pendingQuestions: ["What effective date should the address change use?"],
      missingInfoQuestions: [
        {
          code: "effective_date_required",
          question: "What effective date should the address change use?",
        },
      ],
      brokerSubmission: {
        routingStatus: "needs_broker_contact",
        needsRecipient: true,
      },
      createdAt: 1000,
      updatedAt: 3000,
    });
    const completedCaseId = await ctx.db.insert("policyChangeCases", {
      orgId,
      requestText: "Completed named insured endorsement.",
      sourceKind: "chat",
      status: "completed",
      summary: "Completed named insured endorsement",
      createdAt: 900,
      updatedAt: 2000,
    });
    await ctx.db.insert("policyChangeCases", {
      orgId: otherOrgId,
      requestText: "Do not leak this case across org scopes.",
      sourceKind: "chat",
      status: "submitted",
      summary: "Other org case",
      createdAt: 1100,
      updatedAt: 4000,
    });
    const threadId = await ctx.db.insert("threads", {
      orgId,
      title: "Policy change status",
      createdBy: userId,
      lastMessageAt: 1300,
      originChannel: "imessage",
    });
    await ctx.db.insert("threadMessages", {
      threadId,
      orgId,
      channel: "imessage",
      role: "agent",
      content: "Policy change request created.",
      policyChangeCaseId: activeCaseId,
    });
    const applicationIntakeId = await ctx.db.insert("applicationIntakes", {
      orgId,
      title: "Cyber renewal application",
      sourceKind: "web",
      status: "collecting",
      normalizedAnswers: [],
      missingQuestions: [],
      contextProposalCount: 0,
      createdAt: 1200,
      updatedAt: 1200,
      lastActivityAt: 1200,
    });

    return {
      orgId,
      activeCaseId,
      completedCaseId,
      applicationIntakeId,
      threadId,
    };
  });
}

describe("policyChanges.listForAgentInternal", () => {
  test("lists active policy change cases in scope", async () => {
    const t = convexTest(schema, modules);
    const { orgId, activeCaseId } = await seedPolicyChangeCases(t);

    const rows = await t.query(listForAgentInternalFn, {
      orgIds: [orgId],
      limit: 10,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].caseId).toBe(activeCaseId);
    expect(rows[0].status).toBe("needs_info");
    expect(rows[0].pendingQuestions).toEqual([
      "What effective date should the address change use?",
    ]);
  });

  test("does not resolve an application-intake ID as a policy change case", async () => {
    const t = convexTest(schema, modules);
    const { orgId, applicationIntakeId, threadId } =
      await seedPolicyChangeCases(t);

    const rows = await t.query(listForAgentInternalFn, {
      orgIds: [orgId],
      caseId: String(applicationIntakeId),
      threadId,
      limit: 10,
    });

    expect(rows).toEqual([]);
  });

  test("returns a completed policy change case for an explicit case ID", async () => {
    const t = convexTest(schema, modules);
    const { orgId, completedCaseId, threadId } = await seedPolicyChangeCases(t);

    const rows = await t.query(listForAgentInternalFn, {
      orgIds: [orgId],
      caseId: String(completedCaseId),
      threadId,
      limit: 10,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].caseId).toBe(completedCaseId);
    expect(rows[0].status).toBe("completed");
  });
});
