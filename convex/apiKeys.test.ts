/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  generate,
  list,
  remove,
  revoke,
  validateKey,
} from "./apiKeys";

const modules = import.meta.glob("./**/*.ts");
const generateFn = generate as any;
const listFn = list as any;
const revokeFn = revoke as any;
const removeFn = remove as any;
const validateKeyFn = validateKey as any;

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function seedOrgWithAdminAndMember() {
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

function sessionFor(userId: Id<"users">) {
  return { subject: `${userId}|session` };
}

describe("apiKeys", () => {
  test("allows admins to generate and list API keys", async () => {
    const { t, adminUserId } = await seedOrgWithAdminAndMember();

    const rawKey = await t
      .withIdentity(sessionFor(adminUserId))
      .mutation(generateFn, { name: "CI" });
    const keys = await t.withIdentity(sessionFor(adminUserId)).query(listFn, {});

    expect(rawKey).toMatch(/^glass_[a-f0-9]{64}$/);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({
      name: "CI",
      keyPrefix: rawKey.slice(0, 14),
    });
    expect(keys[0]).not.toHaveProperty("keyHash");
  });

  test("blocks members from listing or generating API keys", async () => {
    const { t, memberUserId } = await seedOrgWithAdminAndMember();
    const memberSession = t.withIdentity(sessionFor(memberUserId));

    await expect(memberSession.query(listFn, {})).rejects.toThrow(
      "Admin access required",
    );
    await expect(memberSession.mutation(generateFn, { name: "Script" })).rejects.toThrow(
      "Admin access required",
    );
  });

  test("blocks members from revoking or removing API keys", async () => {
    const { t, adminUserId, memberUserId } = await seedOrgWithAdminAndMember();

    await t.withIdentity(sessionFor(adminUserId)).mutation(generateFn, {
      name: "Integration",
    });
    const [key] = await t.withIdentity(sessionFor(adminUserId)).query(listFn, {});
    const memberSession = t.withIdentity(sessionFor(memberUserId));

    await expect(memberSession.mutation(revokeFn, { id: key._id })).rejects.toThrow(
      "Admin access required",
    );
    await expect(memberSession.mutation(removeFn, { id: key._id })).rejects.toThrow(
      "Admin access required",
    );
  });

  test("keeps existing API key validation behavior for created keys", async () => {
    const { t, orgId, adminUserId } = await seedOrgWithAdminAndMember();

    const rawKey = await t
      .withIdentity(sessionFor(adminUserId))
      .mutation(generateFn, { name: "REST" });
    const result = await t.query(validateKeyFn, {
      keyHash: await sha256Hex(rawKey),
    });

    expect(result).toMatchObject({
      userId: adminUserId,
      orgId,
    });
  });

  test("allows admins to revoke and remove keys", async () => {
    const { t, adminUserId } = await seedOrgWithAdminAndMember();
    const adminSession = t.withIdentity(sessionFor(adminUserId));

    await adminSession.mutation(generateFn, { name: "Old key" });
    const [key] = await adminSession.query(listFn, {});
    await adminSession.mutation(revokeFn, { id: key._id });
    await adminSession.mutation(removeFn, { id: key._id });

    await expect(adminSession.query(listFn, {})).resolves.toEqual([]);
  });
});
