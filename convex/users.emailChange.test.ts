/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  cancelEmailChange,
  confirmEmailChange,
  createEmailChangeRequestInternal,
} from "./users";
import { cancelMemberEmailChange } from "./orgs";

const modules = import.meta.glob("./**/*.ts");
const createRequestFn = createEmailChangeRequestInternal as any;
const confirmFn = confirmEmailChange as any;
const cancelFn = cancelEmailChange as any;
const cancelMemberFn = cancelMemberEmailChange as any;

describe("user email changes", () => {
  test("confirms a requested email change and moves the auth account", async () => {
    const t = convexTest(schema, modules);
    const { userId, accountId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "old@example.com",
        emailVerificationTime: 1,
      });
      const accountId = await ctx.db.insert("authAccounts", {
        userId,
        provider: "resend-otp",
        providerAccountId: "old@example.com",
        emailVerified: "old@example.com",
      });
      return { userId, accountId };
    });

    const request = await t.mutation(createRequestFn, {
      targetUserId: userId,
      requestedByUserId: userId,
      newEmail: "new@example.com",
      code: "123456",
    });
    const requestId = request.requestId as Id<"userEmailChangeRequests">;

    await t.withIdentity({ subject: `${userId}|session` }).mutation(confirmFn, {
      requestId,
      code: "123456",
    });

    const result = await t.run(async (ctx) => {
      const user = await ctx.db.get(userId);
      const account = await ctx.db.get(accountId);
      const oldAccount = await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", "resend-otp").eq("providerAccountId", "old@example.com"),
        )
        .first();
      const savedRequest = await ctx.db.get(requestId);
      return { user, account, oldAccount, savedRequest };
    });

    expect(result.user?.email).toBe("new@example.com");
    expect(result.account?.providerAccountId).toBe("new@example.com");
    expect(result.account?.emailVerified).toBe("new@example.com");
    expect(result.oldAccount).toBeNull();
    expect(result.savedRequest?.status).toBe("confirmed");
  });

  test("does not let another user confirm the request", async () => {
    const t = convexTest(schema, modules);
    const { targetUserId, otherUserId } = await t.run(async (ctx) => {
      const targetUserId = await ctx.db.insert("users", {
        email: "target@example.com",
      });
      const otherUserId = await ctx.db.insert("users", {
        email: "other@example.com",
      });
      return { targetUserId, otherUserId };
    });

    const request = await t.mutation(createRequestFn, {
      targetUserId,
      requestedByUserId: targetUserId,
      newEmail: "new-target@example.com",
      code: "123456",
    });
    const requestId = request.requestId as Id<"userEmailChangeRequests">;

    await expect(
      t.withIdentity({ subject: `${otherUserId}|session` }).mutation(confirmFn, {
        requestId,
        code: "123456",
      }),
    ).rejects.toThrow("Email change request not found");
  });

  test("rejects a new email already owned by another user", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "one@example.com",
      });
      await ctx.db.insert("users", {
        email: "taken@example.com",
      });
      return { userId };
    });

    await expect(
      t.mutation(createRequestFn, {
        targetUserId: userId,
        requestedByUserId: userId,
        newEmail: "taken@example.com",
        code: "123456",
      }),
    ).rejects.toThrow("This email is already used by another user.");
  });

  test("lets the target user cancel an unconfirmed request", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "old@example.com" }),
    );
    const request = await t.mutation(createRequestFn, {
      targetUserId: userId,
      requestedByUserId: userId,
      newEmail: "new@example.com",
      code: "123456",
    });
    const requestId = request.requestId as Id<"userEmailChangeRequests">;

    await t.withIdentity({ subject: `${userId}|session` }).mutation(cancelFn, {
      requestId,
    });

    const savedRequest = await t.run((ctx) => ctx.db.get(requestId));
    expect(savedRequest?.status).toBe("cancelled");
  });

  test("lets an org admin cancel a teammate request", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Client",
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
      const membershipId = await ctx.db.insert("orgMemberships", {
        orgId,
        userId: memberUserId,
        role: "member",
      });
      return { adminUserId, memberUserId, membershipId };
    });
    const request = await t.mutation(createRequestFn, {
      targetUserId: seeded.memberUserId,
      requestedByUserId: seeded.adminUserId,
      newEmail: "member-new@example.com",
      code: "123456",
    });
    const requestId = request.requestId as Id<"userEmailChangeRequests">;

    await t
      .withIdentity({ subject: `${seeded.adminUserId}|session` })
      .mutation(cancelMemberFn, {
        membershipId: seeded.membershipId,
        requestId,
      });

    const savedRequest = await t.run((ctx) => ctx.db.get(requestId));
    expect(savedRequest?.status).toBe("cancelled");
  });
});
