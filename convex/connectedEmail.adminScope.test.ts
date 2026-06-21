/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { connect } from "./actions/connectedEmail";
import { updateScope } from "./connectedEmail";

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
    ).rejects.toThrow("Only org admins can connect organization-scoped mailboxes");
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

  test("blocks members from promoting existing mailboxes to organization scope", async () => {
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
      "Only org admins can make a mailbox available to the organization",
    );

    await t.withIdentity(sessionFor(adminUserId)).mutation(updateScopeFn, {
      accountId,
      scope: "org",
    });
    const account = await t.run((ctx) => ctx.db.get(accountId));
    expect(account?.scope).toBe("org");
  });
});
