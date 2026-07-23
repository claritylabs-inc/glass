/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { connect } from "./actions/connectedEmail";
import {
  listAutomationEligibleInternal,
  updateScope,
} from "./connectedEmail";

const imapMock = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>,
}));

vi.mock("imapflow", () => ({
  ImapFlow: class {
    constructor(options: Record<string, unknown>) {
      imapMock.options.push(options);
    }

    async connect() {}
    async mailboxOpen() {}
    async logout() {}
  },
}));

const modules = import.meta.glob("./**/*.ts");
const connectFn = connect as any;
const listAutomationEligibleFn = listAutomationEligibleInternal as any;
const updateScopeFn = updateScope as any;

function sessionFor(userId: Id<"users">) {
  return { subject: `${userId}|session` };
}

async function seedOrgWithUsers() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Acme",
      type: "client",
    });
    const adminUserId = await ctx.db.insert("users", {
      email: "admin@example.com",
    });
    const memberUserId = await ctx.db.insert("users", {
      email: "member@example.com",
    });
    await ctx.db.insert("orgMemberships", {
      orgId,
      userId: adminUserId,
      role: "admin",
    });
    await ctx.db.insert("orgMemberships", {
      orgId,
      userId: memberUserId,
      role: "member",
    });
    return { orgId, adminUserId, memberUserId };
  });
  return { t, ...ids };
}

describe("connected email org scope", () => {
  beforeEach(() => {
    imapMock.options = [];
    process.env.EMAIL_CONNECTIONS_ENCRYPTION_KEY = "test-email-key";
  });

  test("blocks members from creating organization-scoped mailboxes before opening a socket", async () => {
    const { t, orgId, memberUserId } = await seedOrgWithUsers();

    await expect(
      t.withIdentity(sessionFor(memberUserId)).action(connectFn, {
        orgId,
        scope: "org",
        emailAddress: "member@example.com",
        host: "8.8.8.8",
        port: 993,
        secure: true,
        username: "member@example.com",
        password: "secret",
      }),
    ).rejects.toThrow(
      "Only an organization admin can connect a shared mailbox.",
    );
    expect(imapMock.options).toHaveLength(0);
  });

  test("allows admins to create organization-scoped mailboxes after destination validation", async () => {
    const { t, orgId, adminUserId } = await seedOrgWithUsers();

    const accountId = await t.withIdentity(sessionFor(adminUserId)).action(connectFn, {
      orgId,
      scope: "org",
      emailAddress: "admin@example.com",
      host: "8.8.8.8",
      port: 993,
      secure: true,
      username: "admin@example.com",
      password: "secret",
    });

    const account = await t.run((ctx) =>
      ctx.db.get(accountId as Id<"connectedEmailAccounts">),
    );
    expect(account).toMatchObject({
      orgId,
      userId: adminUserId,
      scope: "org",
      host: "8.8.8.8",
      port: 993,
      status: "active",
    });
    expect(imapMock.options[0]).toMatchObject({
      host: "8.8.8.8",
      port: 993,
      secure: true,
    });
  });

  test("keeps personal mailboxes owner-only and requires an admin owner for org scope", async () => {
    const { t, orgId, adminUserId, memberUserId } = await seedOrgWithUsers();
    const accountId = await t.run(async (ctx) =>
      ctx.db.insert("connectedEmailAccounts", {
        orgId,
        userId: memberUserId,
        scope: "user",
        emailAddress: "member@example.com",
        host: "imap.example.com",
        port: 993,
        secure: true,
        username: "member@example.com",
        encryptedPassword: "encrypted",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    await expect(
      t.withIdentity(sessionFor(memberUserId)).mutation(updateScopeFn, {
        accountId,
        scope: "org",
      }),
    ).rejects.toThrow(
      "Only an organization admin can make a mailbox available to the organization.",
    );

    await expect(
      t.withIdentity(sessionFor(adminUserId)).mutation(updateScopeFn, {
        accountId,
        scope: "org",
      }),
    ).rejects.toThrow("Only the mailbox owner can manage a personal mailbox.");

    const adminAccountId = await t.run(async (ctx) =>
      ctx.db.insert("connectedEmailAccounts", {
        orgId,
        userId: adminUserId,
        scope: "user",
        emailAddress: "admin@example.com",
        host: "imap.example.com",
        port: 993,
        secure: true,
        username: "admin@example.com",
        encryptedPassword: "encrypted",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await t.withIdentity(sessionFor(adminUserId)).mutation(updateScopeFn, {
      accountId: adminAccountId,
      scope: "org",
    });
    const adminAccount = await t.run((ctx) => ctx.db.get(adminAccountId));
    expect(adminAccount?.scope).toBe("org");
  });

  test("keeps legacy org mailboxes alert-only eligible without enabling personal mailboxes", async () => {
    const { t, orgId, adminUserId, memberUserId } = await seedOrgWithUsers();
    const accountIds = await t.run(async (ctx) => {
      const base = {
        orgId,
        host: "imap.example.com",
        port: 993,
        secure: true,
        encryptedPassword: "encrypted",
        status: "active" as const,
        createdAt: 1,
        updatedAt: 1,
      };
      const legacyOrg = await ctx.db.insert("connectedEmailAccounts", {
        ...base,
        userId: adminUserId,
        scope: "org",
        emailAddress: "org@example.com",
        username: "org@example.com",
      });
      const legacyUser = await ctx.db.insert("connectedEmailAccounts", {
        ...base,
        userId: memberUserId,
        scope: "user",
        emailAddress: "member@example.com",
        username: "member@example.com",
      });
      const configuredUser = await ctx.db.insert("connectedEmailAccounts", {
        ...base,
        userId: memberUserId,
        scope: "user",
        emailAddress: "automation@example.com",
        username: "automation@example.com",
        automation: {
          policyImports: true,
          requirementImports: false,
          companyMemory: false,
        },
      });
      const disabledOrg = await ctx.db.insert("connectedEmailAccounts", {
        ...base,
        userId: adminUserId,
        scope: "org",
        emailAddress: "disabled@example.com",
        username: "disabled@example.com",
        automation: {
          policyImports: false,
          requirementImports: false,
          companyMemory: false,
        },
      });
      return { legacyOrg, legacyUser, configuredUser, disabledOrg };
    });

    const eligible = await t.query(listAutomationEligibleFn, {});
    const eligibleIds = new Set(
      eligible.map((account: { _id: Id<"connectedEmailAccounts"> }) => account._id),
    );
    expect(eligibleIds.has(accountIds.legacyOrg)).toBe(true);
    expect(eligibleIds.has(accountIds.configuredUser)).toBe(true);
    expect(eligibleIds.has(accountIds.legacyUser)).toBe(false);
    expect(eligibleIds.has(accountIds.disabledOrg)).toBe(false);
  });
});
