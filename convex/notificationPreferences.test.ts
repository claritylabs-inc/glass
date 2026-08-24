/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import {
  getProactiveChannels,
  setChannels,
  setProactiveChannels,
} from "./notificationPreferences";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const setChannelsFn = setChannels as any;
const setProactiveChannelsFn = setProactiveChannels as any;
const getProactiveChannelsFn = getProactiveChannels as any;

function sessionFor(userId: Id<"users">) {
  return { subject: `${userId}|session` };
}

async function setupUserAndOrg(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Acme",
      type: "client",
    });
    const userId = await ctx.db.insert("users", { name: "Alice" });
    await ctx.db.insert("orgMemberships", { orgId, userId, role: "member" });
    return { orgId, userId };
  });
}

test("updates notification channels atomically", async () => {
  const t = convexTest(schema, modules);
  const { orgId, userId } = await setupUserAndOrg(t);

  await t.withIdentity(sessionFor(userId)).mutation(setChannelsFn, {
    orgId,
    type: "mailbox_attention",
    email: true,
    imessage: false,
  });

  const rows = await t.run((ctx) =>
    ctx.db
      .query("notificationPreferences")
      .withIndex("by_userId_orgId", (q) =>
        q.eq("userId", userId).eq("orgId", orgId),
      )
      .collect(),
  );
  expect(rows).toMatchObject([
    { type: "mailbox_attention", channel: "email", enabled: true },
    { type: "mailbox_attention", channel: "imessage", enabled: false },
  ]);
});

test("reports proactive routing inherited from the global preference", async () => {
  const t = convexTest(schema, modules);
  const { orgId, userId } = await setupUserAndOrg(t);
  await t.run(async (ctx) => {
    for (const preference of [
      { channel: "email" as const, enabled: false },
      { channel: "imessage" as const, enabled: true },
    ]) {
      await ctx.db.insert("notificationPreferences", {
        userId,
        orgId,
        type: "__all__",
        ...preference,
        updatedAt: dayjs().valueOf(),
      });
    }
  });

  await expect(
    t.withIdentity(sessionFor(userId)).query(getProactiveChannelsFn, { orgId }),
  ).resolves.toEqual({
    email: false,
    imessage: true,
    configured: false,
  });
});

test("does not partially save proactive channels when iMessage is unavailable", async () => {
  const t = convexTest(schema, modules);
  const { orgId, userId } = await setupUserAndOrg(t);

  await expect(
    t.withIdentity(sessionFor(userId)).mutation(setProactiveChannelsFn, {
      orgId,
      email: true,
      imessage: true,
    }),
  ).rejects.toThrow("Add a mobile number before choosing iMessage");

  const rows = await t.run((ctx) =>
    ctx.db
      .query("notificationPreferences")
      .withIndex("by_userId_orgId", (q) =>
        q.eq("userId", userId).eq("orgId", orgId),
      )
      .collect(),
  );
  expect(rows).toEqual([]);
});
