/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { updateMemberRole } from "./orgs";

const modules = import.meta.glob("./**/*.ts");
const updateMemberRoleFn = updateMemberRole as any;

function sessionFor(userId: Id<"users">) {
  return { subject: `${userId}|session` };
}

describe("current-org admin writes during operator impersonation", () => {
  test("blocks live organization writes but preserves the member row", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Live broker",
        type: "broker",
        operatorStatus: "live",
      });
      const memberUserId = await ctx.db.insert("users", {
        email: "member@example.com",
      });
      const membershipId = await ctx.db.insert("orgMemberships", {
        orgId,
        userId: memberUserId,
        role: "member",
      });
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
      await ctx.db.insert("operatorImpersonationSessions", {
        operatorUserId,
        targetOrgId: orgId,
        targetRole: "admin",
        status: "active",
        createdAt: 1,
      });
      return { membershipId, operatorUserId };
    });

    await expect(
      t.withIdentity(sessionFor(fixture.operatorUserId)).mutation(
        updateMemberRoleFn,
        {
          membershipId: fixture.membershipId,
          role: "admin",
        },
      ),
    ).rejects.toThrow("Live-organization impersonation is read-only");

    const membership = await t.run((ctx) =>
      ctx.db.get(fixture.membershipId),
    );
    expect(membership?.role).toBe("member");
  });
});
