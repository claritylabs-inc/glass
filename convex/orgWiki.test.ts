/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  acceptProposal,
  appendFacts,
  get as getWiki,
  getForMcp,
  getForOperator,
  readOrgWiki,
  reconcileExtractedCompanyFacts,
  upsertSection,
  upsertSectionForMcp,
  upsertSectionForOperator,
} from "./orgWiki";
import {
  insert as insertConversationTurn,
  listByConversation,
} from "./conversationTurns";

const modules = import.meta.glob("./**/*.ts");
const acceptProposalFn = acceptProposal as any;
const appendFactsFn = appendFacts as any;
const getWikiFn = getWiki as any;
const getForMcpFn = getForMcp as any;
const getForOperatorFn = getForOperator as any;
const upsertSectionFn = upsertSection as any;
const upsertSectionForMcpFn = upsertSectionForMcp as any;
const upsertSectionForOperatorFn = upsertSectionForOperator as any;
const insertConversationTurnFn = insertConversationTurn as any;
const listByConversationFn = listByConversation as any;

function sessionFor(userId: Id<"users">) {
  return { subject: `${userId}|session` };
}

async function clientOrg(t: ReturnType<typeof convexTest>, name = "Clarity Labs Inc.") {
  return await t.run(async (ctx) =>
    ctx.db.insert("organizations", { name, type: "client" }),
  );
}

describe("company wiki", () => {
  test("accepts stable company facts and rejects workflow noise", async () => {
    const t = convexTest(schema, modules);
    const orgId = await clientOrg(t);

    await t.mutation(appendFactsFn, {
      orgId,
      key: "profile",
      source: "extraction",
      facts: [
        "Clarity Labs is a Delaware C corporation.",
        "Clarity Labs is a Delaware C corporation.",
        "The agent cannot send that email.",
        "Clarity Labs policy number CL-1234-5678 renews in March.",
      ],
    });

    const wiki = await t.run((ctx) => ctx.db.query("orgWikiSections").collect());
    expect(wiki).toEqual([
      expect.objectContaining({
        key: "profile",
        body: "- Clarity Labs is a Delaware C corporation.",
      }),
    ]);
  });

  test("assembles every section into one ordered document", async () => {
    const t = convexTest(schema, modules);
    const orgId = await clientOrg(t);
    await t.mutation(appendFactsFn, {
      orgId, key: "operations", source: "extraction", trusted: true,
      facts: ["Clarity Labs runs two Portland warehouses."],
    });
    await t.mutation(appendFactsFn, {
      orgId, key: "profile", source: "extraction", trusted: true,
      facts: ["Clarity Labs is a Delaware C corporation."],
    });

    const wiki = await t.run((ctx) => readOrgWiki(ctx, orgId));
    expect(wiki.markdown).toEqual(
      "## Company profile\n\n- Clarity Labs is a Delaware C corporation.\n\n## Operations\n\n- Clarity Labs runs two Portland warehouses.",
    );
    expect(wiki.gaps.map((gap) => gap.key)).toEqual([
      "scale",
      "compliance",
      "preferences",
      "notes",
    ]);
  });

  test("lets an org admin write while a member stays read-only", async () => {
    const t = convexTest(schema, modules);
    const { adminUserId, memberUserId, orgId } = await t.run(async (ctx) => {
      const adminUserId = await ctx.db.insert("users", { email: "admin@example.com" });
      const memberUserId = await ctx.db.insert("users", { email: "member@example.com" });
      const orgId = await ctx.db.insert("organizations", { name: "Cove", type: "client" });
      await Promise.all([
        ctx.db.insert("orgMemberships", { orgId, userId: adminUserId, role: "admin" }),
        ctx.db.insert("orgMemberships", { orgId, userId: memberUserId, role: "member" }),
      ]);
      return { adminUserId, memberUserId, orgId };
    });

    const admin = t.withIdentity(sessionFor(adminUserId));
    const wiki = await admin.mutation(upsertSectionFn, {
      orgId,
      key: "profile",
      body: "- Cove is incorporated in Delaware.",
    });
    expect(wiki.markdown).toEqual("## Company profile\n\n- Cove is incorporated in Delaware.");

    const member = t.withIdentity(sessionFor(memberUserId));
    await expect(
      member.query(getWikiFn, { orgId }),
    ).resolves.toMatchObject({ markdown: expect.stringContaining("Cove") });
    await expect(
      member.mutation(upsertSectionFn, {
        orgId,
        key: "profile",
        body: "- Cove is incorporated in Nevada.",
      }),
    ).rejects.toThrow("ORG_ADMIN_REQUIRED");
  });

  test("revalidates MCP admin membership against the token organization", async () => {
    const t = convexTest(schema, modules);
    const { adminUserId, memberUserId, orgId, otherOrgId } = await t.run(async (ctx) => {
      const adminUserId = await ctx.db.insert("users", { email: "admin@example.com" });
      const memberUserId = await ctx.db.insert("users", { email: "member@example.com" });
      const orgId = await ctx.db.insert("organizations", { name: "Cove", type: "client" });
      const otherOrgId = await ctx.db.insert("organizations", { name: "Harbor", type: "client" });
      await Promise.all([
        ctx.db.insert("orgMemberships", { orgId, userId: adminUserId, role: "admin" }),
        ctx.db.insert("orgMemberships", { orgId, userId: memberUserId, role: "member" }),
        ctx.db.insert("orgMemberships", { orgId: otherOrgId, userId: adminUserId, role: "admin" }),
      ]);
      return { adminUserId, memberUserId, orgId, otherOrgId };
    });

    const written = await t.mutation(upsertSectionForMcpFn, {
      orgId,
      userId: adminUserId,
      key: "operations",
      body: "- Cove operates in New York.",
    });
    expect(written.markdown).toContain("Cove operates in New York.");
    await expect(
      t.mutation(upsertSectionForMcpFn, {
        orgId,
        userId: memberUserId,
        key: "operations",
        body: "- Cove operates in California.",
      }),
    ).rejects.toThrow("ORG_ADMIN_REQUIRED");
    await expect(
      t.query(getForMcpFn, { orgId: otherOrgId, userId: memberUserId }),
    ).rejects.toThrow("ORG_ACCESS_REQUIRED");
  });

  test("allows direct operator writes and blocks impersonated ones", async () => {
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
      const orgId = await ctx.db.insert("organizations", { name: "Cove", type: "client" });
      const brokerOrgId = await ctx.db.insert("organizations", {
        name: "Montgomery Risk",
        type: "broker",
      });
      return { brokerOrgId, operatorUserId, orgId };
    });

    const operator = t.withIdentity(sessionFor(operatorUserId));
    const written = await operator.mutation(upsertSectionForOperatorFn, {
      orgId,
      key: "profile",
      body: "- Cove is incorporated in Delaware.",
    });
    expect(written.sections[0]).toMatchObject({ source: "operator" });
    await expect(
      operator.query(getForOperatorFn, { orgId: brokerOrgId }),
    ).rejects.toThrow("Client organization not found");

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
      operator.mutation(upsertSectionForOperatorFn, {
        orgId,
        key: "profile",
        body: "- Cove operates in New York.",
      }),
    ).rejects.toThrow("IMPERSONATION_READ_ONLY");
  });

  test("merges appended facts into a section without losing what is there", async () => {
    const t = convexTest(schema, modules);
    const orgId = await clientOrg(t, "Cove");
    await t.mutation(appendFactsFn, {
      orgId, key: "scale", source: "email", trusted: true,
      sourceRefs: ["connected-email:message-1"],
      facts: ["Cove employs 40 people."],
    });
    await t.mutation(appendFactsFn, {
      orgId, key: "scale", source: "imessage", trusted: true,
      sourceRefs: ["imessage:thread-2"],
      facts: ["Cove employs 40 people.", "Cove reported $12M in 2025 revenue."],
    });

    const section = await t.run((ctx) => ctx.db.query("orgWikiSections").unique());
    expect(section).toMatchObject({
      body: "- Cove employs 40 people.\n- Cove reported $12M in 2025 revenue.",
      sourceRefs: ["connected-email:message-1", "imessage:thread-2"],
    });
  });

  test("reconcile leaves conversational facts alone in a section it has nothing to say about", async () => {
    const t = convexTest(schema, modules);
    const orgId = await clientOrg(t, "Cove");
    await t.mutation(appendFactsFn, {
      orgId, key: "operations", source: "chat", trusted: true,
      facts: ["Cove operates a commercial vehicle fleet."],
    });

    await t.run((ctx) =>
      reconcileExtractedCompanyFacts(ctx, {
        orgId,
        source: "extraction",
        facts: [
          { key: "profile", content: "Cove is a Delaware LLC.", sourceRef: "client-file:1" },
        ],
      }),
    );

    const wiki = await t.run((ctx) => readOrgWiki(ctx, orgId));
    expect(wiki.markdown).toContain("Cove operates a commercial vehicle fleet.");
    expect(wiki.markdown).toContain("Cove is a Delaware LLC.");
  });

  test("reconcile retracts its own facts without touching lines other writers added", async () => {
    const t = convexTest(schema, modules);
    const orgId = await clientOrg(t, "Cove");
    await t.mutation(appendFactsFn, {
      orgId, key: "profile", source: "chat", trusted: true,
      facts: ["Cove is family owned."],
    });
    await t.run((ctx) =>
      reconcileExtractedCompanyFacts(ctx, {
        orgId,
        source: "extraction",
        facts: [
          { key: "profile", content: "Cove is a Delaware LLC.", sourceRef: "client-file:1" },
        ],
      }),
    );
    expect((await t.run((ctx) => readOrgWiki(ctx, orgId))).markdown).toContain(
      "Cove is a Delaware LLC.",
    );

    // The source that carried the LLC fact is gone, so reconcile drops it and
    // keeps the chat-written line.
    await t.run((ctx) =>
      reconcileExtractedCompanyFacts(ctx, { orgId, source: "extraction", facts: [] }),
    );
    const wiki = await t.run((ctx) => readOrgWiki(ctx, orgId));
    expect(wiki.markdown).toBe("## Company profile\n\n- Cove is family owned.");
  });

  test("proposes rather than overwrites a manually edited section", async () => {
    const t = convexTest(schema, modules);
    const { adminUserId, orgId } = await t.run(async (ctx) => {
      const adminUserId = await ctx.db.insert("users", { email: "admin@example.com" });
      const orgId = await ctx.db.insert("organizations", { name: "Cove", type: "client" });
      await ctx.db.insert("orgMemberships", { orgId, userId: adminUserId, role: "admin" });
      return { adminUserId, orgId };
    });
    const admin = t.withIdentity(sessionFor(adminUserId));
    await admin.mutation(upsertSectionFn, {
      orgId,
      key: "operations",
      body: "- Cove runs a single Portland warehouse.",
    });

    await t.run(async (ctx) => {
      await reconcileExtractedCompanyFacts(ctx, {
        orgId,
        source: "extraction",
        facts: [
          {
            key: "operations",
            content: "Cove runs two Portland warehouses.",
            sourceRef: "client-file:1",
          },
        ],
      });
    });

    const proposed = await admin.query(getWikiFn, { orgId });
    expect(proposed.sections[0]).toMatchObject({
      body: "- Cove runs a single Portland warehouse.",
      proposedBody: "- Cove runs two Portland warehouses.",
    });

    const accepted = await admin.mutation(acceptProposalFn, { orgId, key: "operations" });
    expect(accepted.markdown).toEqual(
      "## Operations\n\n- Cove runs two Portland warehouses.",
    );
  });

  test("does not persist raw conversation turns", async () => {
    const t = convexTest(schema, modules);
    const orgId = await clientOrg(t);

    await t.mutation(insertConversationTurnFn, {
      orgId,
      conversationId: "thread-1",
      role: "user",
      content: "Please remember this one-off request.",
      embedding: [0, 1, 2],
      createdAt: 1,
    });

    expect(
      await t.query(listByConversationFn, { conversationId: "thread-1" }),
    ).toEqual([]);
  });
});
