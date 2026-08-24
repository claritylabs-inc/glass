/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import { listInbox, markRead } from "./notifications";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const listInboxFn = listInbox as any;
const markReadFn = markRead as any;

function sessionFor(userId: Id<"users">) {
  return { subject: `${userId}|session` };
}

test("keeps user-targeted notifications private inside an organization", async () => {
  const t = convexTest(schema, modules);
  const { orgId, aliceId, bobId, notificationId } = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Acme",
      type: "client",
    });
    const aliceId = await ctx.db.insert("users", { name: "Alice" });
    const bobId = await ctx.db.insert("users", { name: "Bob" });
    await Promise.all([
      ctx.db.insert("orgMemberships", {
        orgId,
        userId: aliceId,
        role: "member",
      }),
      ctx.db.insert("orgMemberships", {
        orgId,
        userId: bobId,
        role: "member",
      }),
    ]);
    const notificationId = await ctx.db.insert("notifications", {
      orgId,
      userId: bobId,
      type: "mailbox_attention",
      title: "Private mailbox item",
      body: "Review your connected mailbox.",
      severity: "warning",
      status: "unread",
      createdAt: 1_000,
    });
    return { orgId, aliceId, bobId, notificationId };
  });

  expect(
    await t.withIdentity(sessionFor(aliceId)).query(listInboxFn, { orgId }),
  ).toEqual([]);

  await t.withIdentity(sessionFor(aliceId)).mutation(markReadFn, {
    ids: [notificationId],
  });
  expect(await t.run((ctx) => ctx.db.get(notificationId))).toMatchObject({
    status: "unread",
  });

  expect(
    await t.withIdentity(sessionFor(bobId)).query(listInboxFn, { orgId }),
  ).toHaveLength(1);
});
