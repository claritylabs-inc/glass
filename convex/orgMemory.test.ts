/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  bulkInsert,
  create as createMemory,
  createForMcp,
  createForOperator,
  listByOrg,
  listForMcp,
  remove as removeMemory,
  removeForMcp,
  update as updateMemory,
  updateForMcp,
  updateForOperator,
  upsert,
} from "./orgMemory";
import {
  insert as insertConversationTurn,
  listByConversation,
} from "./conversationTurns";

const modules = import.meta.glob("./**/*.ts");
const bulkInsertFn = bulkInsert as any;
const createMemoryFn = createMemory as any;
const createForMcpFn = createForMcp as any;
const createForOperatorFn = createForOperator as any;
const listByOrgFn = listByOrg as any;
const listForMcpFn = listForMcp as any;
const removeMemoryFn = removeMemory as any;
const removeForMcpFn = removeForMcp as any;
const updateMemoryFn = updateMemory as any;
const updateForMcpFn = updateForMcp as any;
const updateForOperatorFn = updateForOperator as any;
const upsertFn = upsert as any;
const insertConversationTurnFn = insertConversationTurn as any;
const listByConversationFn = listByConversation as any;

function sessionFor(userId: Id<"users">) {
  return { subject: `${userId}|session` };
}

describe("orgMemory", () => {
  test("stores only stable company facts", async () => {
    const t = convexTest(schema, modules);
    const orgId = await t.run(async (ctx) =>
      ctx.db.insert("organizations", {
        name: "Clarity Labs Inc.",
        type: "client",
      }),
    );

    await t.mutation(bulkInsertFn, {
      items: [
        {
          orgId,
          type: "fact",
          content: "Clarity Labs is a Delaware C corporation.",
          source: "extraction",
        },
        {
          orgId,
          type: "fact",
          content: "Clarity Labs has policy SPS-TPC-2026-00481-04.",
          source: "imessage",
        },
        {
          orgId,
          type: "observation",
          content: "Clarity Labs prefers annual renewals.",
          source: "chat",
        },
        {
          orgId,
          type: "fact",
          content: "The user requested the complete policy PDF.",
          source: "chat",
        },
      ],
    });

    const memories = await t.query(listByOrgFn, { orgId });
    expect(
      memories.map((memory: { content: string }) => memory.content),
    ).toEqual(["Clarity Labs is a Delaware C corporation."]);
  });

  test("rejects explicit policy notes", async () => {
    const t = convexTest(schema, modules);
    const { orgId, policyId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Clarity Labs Inc.",
        type: "client",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Carrier",
        policyNumber: "POL-1",
        linesOfBusiness: ["OLIB"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        isRenewal: false,
        coverages: [],
        insuredName: "Clarity Labs Inc.",
        extractionDataStage: "final",
      });
      return { orgId, policyId };
    });

    const result = await t.mutation(upsertFn, {
      orgId,
      type: "fact",
      content: "Clarity Labs has a $2,000,000 aggregate limit.",
      source: "chat",
      policyId,
    });

    expect(result).toBeNull();
    expect(await t.query(listByOrgFn, { orgId })).toEqual([]);
  });

  test("stores typed server-derived facts that contain insurance homonyms", async () => {
    const t = convexTest(schema, modules);
    const orgId = await t.run((ctx) =>
      ctx.db.insert("organizations", {
        name: "Clarity Labs Inc.",
        type: "client",
      }),
    );

    const memoryId = await t.mutation(upsertFn, {
      orgId,
      type: "fact",
      content: "Clarity Labs operates a carrier integration support team.",
      source: "extraction",
      provenance: {
        kind: "organization_fact",
        derivation: "company_profile_extraction",
        schemaVersion: "organization-fact-v1",
      },
    });

    expect(memoryId).not.toBeNull();
    expect(await t.query(listByOrgFn, { orgId })).toMatchObject([
      {
        content: "Clarity Labs operates a carrier integration support team.",
        provenance: {
          kind: "organization_fact",
          derivation: "company_profile_extraction",
          schemaVersion: "organization-fact-v1",
        },
      },
    ]);
  });

  test("lets org admins edit and delete memory", async () => {
    const t = convexTest(schema, modules);
    const { adminUserId, memoryId, orgId } = await t.run(async (ctx) => {
      const adminUserId = await ctx.db.insert("users", {
        email: "admin@example.com",
      });
      const orgId = await ctx.db.insert("organizations", {
        name: "Clarity Labs Inc.",
        type: "client",
      });
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId: adminUserId,
        role: "admin",
      });
      const memoryId = await ctx.db.insert("orgMemory", {
        orgId,
        type: "fact",
        content: "Clarity Labs is a Delaware corporation.",
        source: "analysis",
        createdAt: 1,
        updatedAt: 1,
      });
      return { adminUserId, memoryId, orgId };
    });

    await t.withIdentity(sessionFor(adminUserId)).mutation(updateMemoryFn, {
      id: memoryId,
      content: "Clarity Labs is a Delaware C corporation.",
    });
    expect(await t.query(listByOrgFn, { orgId })).toMatchObject([
      { content: "Clarity Labs is a Delaware C corporation." },
    ]);

    await t.withIdentity(sessionFor(adminUserId)).mutation(removeMemoryFn, {
      id: memoryId,
    });
    expect(await t.query(listByOrgFn, { orgId })).toEqual([]);
  });

  test("lets admins create memory while members remain read-only", async () => {
    const t = convexTest(schema, modules);
    const { adminUserId, memberUserId, orgId } = await t.run(async (ctx) => {
      const adminUserId = await ctx.db.insert("users", {
        email: "admin@example.com",
      });
      const memberUserId = await ctx.db.insert("users", {
        email: "member@example.com",
      });
      const orgId = await ctx.db.insert("organizations", {
        name: "Cove",
        type: "client",
      });
      await Promise.all([
        ctx.db.insert("orgMemberships", {
          orgId,
          userId: adminUserId,
          role: "admin",
        }),
        ctx.db.insert("orgMemberships", {
          orgId,
          userId: memberUserId,
          role: "member",
        }),
      ]);
      return { adminUserId, memberUserId, orgId };
    });

    const created = await t
      .withIdentity(sessionFor(adminUserId))
      .mutation(createMemoryFn, {
        orgId,
        content: "Cove is incorporated in Delaware.",
      });
    expect(created).toMatchObject({ source: "manual", type: "fact" });
    await expect(
      t.withIdentity(sessionFor(memberUserId)).mutation(createMemoryFn, {
        orgId,
        content: "Cove operates from New York.",
      }),
    ).rejects.toThrow("ORG_ADMIN_REQUIRED");
    await expect(
      t.withIdentity(sessionFor(memberUserId)).mutation(updateMemoryFn, {
        id: created._id,
        content: "Cove is a Delaware corporation.",
      }),
    ).rejects.toThrow("ORG_ADMIN_REQUIRED");
  });

  test("revalidates MCP admin membership and exact token organization", async () => {
    const t = convexTest(schema, modules);
    const { adminUserId, memberUserId, orgId, otherOrgId } = await t.run(
      async (ctx) => {
        const adminUserId = await ctx.db.insert("users", {
          email: "admin@example.com",
        });
        const memberUserId = await ctx.db.insert("users", {
          email: "member@example.com",
        });
        const orgId = await ctx.db.insert("organizations", {
          name: "Cove",
          type: "client",
        });
        const otherOrgId = await ctx.db.insert("organizations", {
          name: "Harbor",
          type: "client",
        });
        await Promise.all([
          ctx.db.insert("orgMemberships", {
            orgId,
            userId: adminUserId,
            role: "admin",
          }),
          ctx.db.insert("orgMemberships", {
            orgId,
            userId: memberUserId,
            role: "member",
          }),
          ctx.db.insert("orgMemberships", {
            orgId: otherOrgId,
            userId: adminUserId,
            role: "admin",
          }),
        ]);
        return { adminUserId, memberUserId, orgId, otherOrgId };
      },
    );

    const created = await t.mutation(createForMcpFn, {
      orgId,
      userId: adminUserId,
      content: "Cove operates in New York.",
    });
    expect(created).toMatchObject({ source: "mcp" });
    await expect(
      t.mutation(createForMcpFn, {
        orgId,
        userId: memberUserId,
        content: "Cove operates in California.",
      }),
    ).rejects.toThrow("ORG_ADMIN_REQUIRED");
    await expect(
      t.mutation(updateForMcpFn, {
        orgId: otherOrgId,
        userId: adminUserId,
        id: created._id,
        content: "Harbor operates in New York.",
      }),
    ).rejects.toThrow("Memory item not found");

    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("orgMemberships")
        .withIndex("organization_user", (q) =>
          q.eq("orgId", orgId).eq("userId", adminUserId),
        )
        .first();
      if (membership) await ctx.db.delete(membership._id);
    });
    await expect(
      t.mutation(removeForMcpFn, {
        orgId,
        userId: adminUserId,
        id: created._id,
      }),
    ).rejects.toThrow("ORG_ADMIN_REQUIRED");
  });

  test("filters unsafe and expired legacy rows from MCP reads", async () => {
    const t = convexTest(schema, modules);
    const { userId, orgId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "user@example.com",
      });
      const orgId = await ctx.db.insert("organizations", {
        name: "Cove",
        type: "client",
      });
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId,
        role: "member",
      });
      await Promise.all([
        ctx.db.insert("orgMemory", {
          orgId,
          type: "fact",
          content: "Cove is incorporated in Delaware.",
          source: "analysis",
          createdAt: 1,
          updatedAt: 1,
        }),
        ctx.db.insert("orgMemory", {
          orgId,
          type: "fact",
          content: "The user requested a certificate of insurance.",
          source: "chat",
          createdAt: 1,
          updatedAt: 1,
        }),
        ctx.db.insert("orgMemory", {
          orgId,
          type: "fact",
          content: "Cove operates in California.",
          source: "analysis",
          expiresAt: 1,
          createdAt: 1,
          updatedAt: 1,
        }),
      ]);
      return { userId, orgId };
    });
    const memories = await t.query(listForMcpFn, { orgId, userId });
    expect(
      memories.map((memory: { content: string }) => memory.content),
    ).toEqual(["Cove is incorporated in Delaware."]);
  });

  test("allows direct operator memory management and blocks impersonation", async () => {
    const t = convexTest(schema, modules);
    const { brokerOrgId, operatorUserId, orgId } = await t.run(async (ctx) => {
      const operatorUserId = await ctx.db.insert("users", {
        email: "operator@example.com",
        accountKind: "operator",
      });
      await ctx.db.insert("operatorProfiles", {
        userId: operatorUserId,
        email: "operator@example.com",
        role: "operator",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const orgId = await ctx.db.insert("organizations", {
        name: "Cove",
        type: "client",
      });
      const brokerOrgId = await ctx.db.insert("organizations", {
        name: "Montgomery Risk",
        type: "broker",
      });
      return { brokerOrgId, operatorUserId, orgId };
    });
    const operator = t.withIdentity(sessionFor(operatorUserId));
    const created = await operator.mutation(createForOperatorFn, {
      orgId,
      content: "Cove is incorporated in Delaware.",
    });
    expect(created).toMatchObject({ source: "operator" });
    await expect(
      operator.mutation(createForOperatorFn, {
        orgId: brokerOrgId,
        content: "Montgomery Risk operates in New York.",
      }),
    ).rejects.toThrow("Client organization not found");
    const updated = await operator.mutation(updateForOperatorFn, {
      id: created._id,
      content: "Cove is a Delaware C corporation.",
    });
    expect(updated).toMatchObject({ source: "operator" });
    expect(updated).not.toHaveProperty("sourceRef");

    await t.run((ctx) =>
      ctx.db.insert("operatorImpersonationSessions", {
        operatorUserId,
        targetOrgId: orgId,
        targetRole: "admin",
        status: "active",
        createdAt: 2,
      }),
    );
    await expect(
      operator.mutation(createForOperatorFn, {
        orgId,
        content: "Cove operates in New York.",
      }),
    ).rejects.toThrow("IMPERSONATION_READ_ONLY");
  });

  test("rejects unsafe memory edits", async () => {
    const t = convexTest(schema, modules);
    const { adminUserId, memoryId } = await t.run(async (ctx) => {
      const adminUserId = await ctx.db.insert("users", {
        email: "admin@example.com",
      });
      const orgId = await ctx.db.insert("organizations", {
        name: "Clarity Labs Inc.",
        type: "client",
      });
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId: adminUserId,
        role: "admin",
      });
      const memoryId = await ctx.db.insert("orgMemory", {
        orgId,
        type: "fact",
        content: "Clarity Labs is a Delaware C corporation.",
        source: "analysis",
        createdAt: 1,
        updatedAt: 1,
      });
      return { adminUserId, memoryId };
    });

    await expect(
      t.withIdentity(sessionFor(adminUserId)).mutation(updateMemoryFn, {
        id: memoryId,
        content: "Clarity Labs has a $2,000,000 aggregate limit.",
      }),
    ).rejects.toThrow("Memory must be a stable company fact");
  });

  test("deduplicates normalized facts while retaining email provenance", async () => {
    const t = convexTest(schema, modules);
    const orgId = await t.run((ctx) =>
      ctx.db.insert("organizations", {
        name: "Clarity Labs Inc.",
        type: "client",
      }),
    );

    const firstId = await t.mutation(upsertFn, {
      orgId,
      type: "fact",
      content: "Clarity Labs is a Delaware C corporation.",
      source: "email",
      sourceRef: "connected-email:message-1:fact-1",
      confidence: 0.92,
      observedAt: 10,
    });
    const duplicateId = await t.mutation(upsertFn, {
      orgId,
      type: "fact",
      content: "Clarity Labs is a Delaware C corporation!",
      source: "email",
      sourceRef: "connected-email:message-2:fact-1",
      confidence: 0.98,
      observedAt: 20,
    });

    expect(duplicateId).toBe(firstId);
    const memories = await t.query(listByOrgFn, { orgId });
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({
      source: "email",
      sourceRef: "connected-email:message-1:fact-1",
      confidence: 0.98,
      observedAt: 20,
    });
  });

  test("does not persist raw conversation turns", async () => {
    const t = convexTest(schema, modules);
    const orgId = await t.run(async (ctx) =>
      ctx.db.insert("organizations", {
        name: "Clarity Labs Inc.",
        type: "client",
      }),
    );

    await t.mutation(insertConversationTurnFn, {
      orgId,
      conversationId: "thread-1",
      role: "user",
      content: "Please remember this one-off request.",
      embedding: [0, 1, 2],
      createdAt: 1,
    });

    expect(
      await t.query(listByConversationFn, {
        conversationId: "thread-1",
      }),
    ).toEqual([]);
  });
});
