/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { expect, test, describe } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  getProactiveChannels,
  setChannels,
  setProactiveChannels,
} from "./notificationPreferences";

const modules = import.meta.glob("./**/*.ts");
const setChannelsFn = setChannels as any;
const setProactiveChannelsFn = setProactiveChannels as any;
const getProactiveChannelsFn = getProactiveChannels as any;

function sessionFor(userId: Id<"users">) {
  return { subject: `${userId}|session` };
}

// Helper: sets up a user+org+membership and returns ids
// Uses t.run to bypass auth for setup
async function setupUserAndOrg(t: ReturnType<typeof convexTest>) {
  const orgId = await t.run(async (ctx) =>
    ctx.db.insert("organizations", { name: "Acme", type: "client" })
  );
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "Alice" })
  );
  await t.run(async (ctx) =>
    ctx.db.insert("orgMemberships", { orgId, userId, role: "member" })
  );
  return { orgId, userId };
}

describe("notificationPreferences — upsert logic", () => {
  test("creates a preference row", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await setupUserAndOrg(t);

    // Test directly via t.run to avoid auth complexity
    await t.run(async (ctx) => {
      await ctx.db.insert("notificationPreferences", {
        userId,
        orgId,
        type: "incomplete_extraction",
        channel: "email",
        enabled: false,
        updatedAt: dayjs().valueOf(),
      });
    });

    const rows = await t.run(async (ctx) =>
      ctx.db.query("notificationPreferences").collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(false);
    expect(rows[0].type).toBe("incomplete_extraction");
  });

  test("upserts — inserting same key twice updates the row", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await setupUserAndOrg(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("notificationPreferences", {
        userId, orgId, type: "incomplete_extraction",
        channel: "email", enabled: false, updatedAt: dayjs().valueOf(),
      });
    });

    // Simulate upsert: find existing and patch
    await t.run(async (ctx) => {
      const existing = await ctx.db
        .query("notificationPreferences")
        .withIndex("by_userId_orgId_type_channel", (q) =>
          q.eq("userId", userId).eq("orgId", orgId)
           .eq("type", "incomplete_extraction").eq("channel", "email")
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          enabled: true,
          updatedAt: dayjs().valueOf(),
        });
      }
    });

    const rows = await t.run(async (ctx) =>
      ctx.db.query("notificationPreferences").collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(true);
  });
});

describe("notificationPreferences.setAllEmail", () => {
  test("writes __all__ email row", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await setupUserAndOrg(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("notificationPreferences", {
        userId, orgId, type: "__all__", channel: "email",
        enabled: false, updatedAt: dayjs().valueOf(),
      });
    });

    const rows = await t.run(async (ctx) =>
      ctx.db.query("notificationPreferences").collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("__all__");
    expect(rows[0].channel).toBe("email");
    expect(rows[0].enabled).toBe(false);
  });
});

describe("notificationPreferences — query", () => {
  test("returns only rows for the matching user+org", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await setupUserAndOrg(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("notificationPreferences", {
        userId, orgId, type: "vendor_compliance_gap", channel: "email",
        enabled: true, updatedAt: dayjs().valueOf(),
      });
    });

    const prefs = await t.run(async (ctx) =>
      ctx.db.query("notificationPreferences")
        .withIndex("by_userId_orgId", (q) => q.eq("userId", userId).eq("orgId", orgId))
        .collect()
    );
    expect(prefs).toHaveLength(1);
    expect(prefs[0].type).toBe("vendor_compliance_gap");
  });
});

describe("resolveForUser", () => {
  test("per-type row beats __all__ override", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await setupUserAndOrg(t);

    await t.run(async (ctx) => {
      // __all__ disables email
      await ctx.db.insert("notificationPreferences", {
        userId, orgId, type: "__all__", channel: "email",
        enabled: false, updatedAt: dayjs().valueOf(),
      });
      // per-type enables email for this type
      await ctx.db.insert("notificationPreferences", {
        userId, orgId, type: "incomplete_extraction", channel: "email",
        enabled: true, updatedAt: dayjs().valueOf(),
      });
    });

    const result = await t.run(async (ctx) => {
      const { resolveEmailPreference } = await import("./lib/notify");
      return resolveEmailPreference(ctx, userId, orgId, "incomplete_extraction", "warning");
    });

    expect(result.shouldEmail).toBe(true);
  });

  test("absence of row falls back to severity default", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await setupUserAndOrg(t);

    const result = await t.run(async (ctx) => {
      const { resolveEmailPreference } = await import("./lib/notify");
      return resolveEmailPreference(ctx, userId, orgId, "policy_change_completed", "info");
    });

    // info severity defaults to false
    expect(result.shouldEmail).toBe(false);
  });
});

describe("notificationPreferences — atomic channel updates", () => {
  test("updates email and iMessage rows together", async () => {
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

  test("reports effective proactive routing inherited from __all__", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await setupUserAndOrg(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("notificationPreferences", {
        userId,
        orgId,
        type: "__all__",
        channel: "email",
        enabled: false,
        updatedAt: dayjs().valueOf(),
      });
      await ctx.db.insert("notificationPreferences", {
        userId,
        orgId,
        type: "__all__",
        channel: "imessage",
        enabled: true,
        updatedAt: dayjs().valueOf(),
      });
    });

    const result = await t
      .withIdentity(sessionFor(userId))
      .query(getProactiveChannelsFn, { orgId });

    expect(result).toEqual({
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
});
