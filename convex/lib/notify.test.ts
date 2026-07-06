/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { notifyInternal } from "./notify";

const notifyInternalFn = notifyInternal as any;

const modules = import.meta.glob("../**/*.ts");

describe("notify() — coalesce logic", () => {
  test("two events within the window collapse into one notification", async () => {
    const t = convexTest(schema, modules);

    const brokerOrgId = await t.run(async (ctx) => {
      return await ctx.db.insert("organizations", {
        name: "Broker Co",
        type: "broker",
      });
    });

    const now = 1_000_000_000_000;

    // First event
    const id1 = await t.mutation(notifyInternalFn, {
      orgId: brokerOrgId,
      type: "vendor_compliance_gap",
      title: "Vendor compliance gap",
      body: "Acme is missing a vendor requirement",
      severity: "warning",
      coalesceKeyParts: ["vendor_compliance_gap", brokerOrgId, "clientOrg1"],
      nowMs: now,
    });

    const id2 = await t.mutation(notifyInternalFn, {
      orgId: brokerOrgId,
      type: "vendor_compliance_gap",
      title: "Vendor compliance gap",
      body: "Acme is still missing a vendor requirement",
      severity: "warning",
      coalesceKeyParts: ["vendor_compliance_gap", brokerOrgId, "clientOrg1"],
      nowMs: now + 60_000, // 1 minute later, same bucket
    });

    expect(id1).toBe(id2);


    const notif = await t.run(async (ctx) => ctx.db.get(id1)) as any;
    expect(notif?.coalescedCount).toBe(2);
  });

  test("event outside the window creates a new notification", async () => {
    const t = convexTest(schema, modules);

    const brokerOrgId = await t.run(async (ctx) => {
      return await ctx.db.insert("organizations", { name: "Broker Co", type: "broker" });
    });

    const now = 1_000_000_000_000;
    const windowMs = 24 * 60 * 60 * 1000;

    const id1 = await t.mutation(notifyInternalFn, {
      orgId: brokerOrgId,
      type: "vendor_compliance_gap",
      title: "Vendor compliance gap",
      body: "First",
      severity: "warning",
      coalesceKeyParts: ["vendor_compliance_gap", brokerOrgId, "clientOrg1"],
      nowMs: now,
    });

    const id2 = await t.mutation(notifyInternalFn, {
      orgId: brokerOrgId,
      type: "vendor_compliance_gap",
      title: "Vendor compliance gap",
      body: "Second",
      severity: "warning",
      coalesceKeyParts: ["vendor_compliance_gap", brokerOrgId, "clientOrg1"],
      nowMs: now + windowMs + 1, // different bucket
    });

    expect(id1).not.toBe(id2);
  });

  test("read notification is not coalesced; new unread notification created", async () => {
    const t = convexTest(schema, modules);

    const brokerOrgId = await t.run(async (ctx) => {
      return await ctx.db.insert("organizations", { name: "Broker Co", type: "broker" });
    });

    const now = 1_000_000_000_000;

    const id1 = await t.mutation(notifyInternalFn, {
      orgId: brokerOrgId,
      type: "vendor_compliance_gap",
      title: "Vendor compliance gap",
      body: "First",
      severity: "warning",
      coalesceKeyParts: ["vendor_compliance_gap", brokerOrgId, "clientOrg1"],
      nowMs: now,
    });

    // Mark it read
    await t.run(async (ctx) => ctx.db.patch(id1, { status: "read" }));

    const id2 = await t.mutation(notifyInternalFn, {
      orgId: brokerOrgId,
      type: "vendor_compliance_gap",
      title: "Vendor compliance gap",
      body: "Second",
      severity: "warning",
      coalesceKeyParts: ["vendor_compliance_gap", brokerOrgId, "clientOrg1"],
      nowMs: now + 60_000, // same bucket, but first is read
    });

    expect(id1).not.toBe(id2);
  });
});

describe("notify() — preference resolution", () => {
  test("per-type row beats __all__ override", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Alice" })
    );
    const orgId = await t.run(async (ctx) =>
      ctx.db.insert("organizations", { name: "Acme", type: "client" })
    );

    // __all__ disables email
    await t.run(async (ctx) =>
      ctx.db.insert("notificationPreferences", {
        userId,
        orgId,
        type: "__all__",
        channel: "email",
        enabled: false,
        updatedAt: Date.now(),
      })
    );

    // per-type enables email for this type
    await t.run(async (ctx) =>
      ctx.db.insert("notificationPreferences", {
        userId,
        orgId,
        type: "incomplete_extraction",
        channel: "email",
        enabled: true,
        updatedAt: Date.now(),
      })
    );

    const { shouldEmail } = await t.run(async (ctx) => {
      const { resolveEmailPreference } = await import("./notify");
      return resolveEmailPreference(ctx, userId, orgId, "incomplete_extraction", "warning");
    });

    expect(shouldEmail).toBe(true);
  });

  test("absence of row falls back to severity default", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Bob" })
    );
    const orgId = await t.run(async (ctx) =>
      ctx.db.insert("organizations", { name: "Acme", type: "client" })
    );

    // No preference rows at all
    const { shouldEmail } = await t.run(async (ctx) => {
      const { resolveEmailPreference } = await import("./notify");
      return resolveEmailPreference(ctx, userId, orgId, "policy_change_completed", "info");
    });

    // info severity defaults to false
    expect(shouldEmail).toBe(false);
  });
});
