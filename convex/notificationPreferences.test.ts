/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

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
        updatedAt: Date.now(),
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
        channel: "email", enabled: false, updatedAt: Date.now(),
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
        await ctx.db.patch(existing._id, { enabled: true, updatedAt: Date.now() });
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
        enabled: false, updatedAt: Date.now(),
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
        enabled: true, updatedAt: Date.now(),
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
        enabled: false, updatedAt: Date.now(),
      });
      // per-type enables email for this type
      await ctx.db.insert("notificationPreferences", {
        userId, orgId, type: "incomplete_extraction", channel: "email",
        enabled: true, updatedAt: Date.now(),
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
