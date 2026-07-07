/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  bulkInsert,
  listByOrg,
  remove as removeMemory,
  update as updateMemory,
  upsert,
} from "./orgMemory";
import { insert as insertConversationTurn, listByConversation } from "./conversationTurns";

const modules = import.meta.glob("./**/*.ts");
const bulkInsertFn = bulkInsert as any;
const listByOrgFn = listByOrg as any;
const removeMemoryFn = removeMemory as any;
const updateMemoryFn = updateMemory as any;
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
      })
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
    expect(memories.map((memory: { content: string }) => memory.content)).toEqual([
      "Clarity Labs is a Delaware C corporation.",
    ]);
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
        policyTypes: ["cyber"],
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

  test("does not persist raw conversation turns", async () => {
    const t = convexTest(schema, modules);
    const orgId = await t.run(async (ctx) =>
      ctx.db.insert("organizations", {
        name: "Clarity Labs Inc.",
        type: "client",
      })
    );

    await t.mutation(insertConversationTurnFn, {
      orgId,
      conversationId: "thread-1",
      role: "user",
      content: "Please remember this one-off request.",
      embedding: [0, 1, 2],
      createdAt: 1,
    });

    expect(await t.query(listByConversationFn, {
      conversationId: "thread-1",
    })).toEqual([]);
  });
});
