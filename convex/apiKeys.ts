import { v } from "convex/values";
import dayjs from "dayjs";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { requireCurrentOrgAdmin as requireOrgAdmin } from "./lib/access";

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireOrgAdmin(ctx);
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    return keys
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((k) => ({
        _id: k._id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        lastUsedAt: k.lastUsedAt,
        createdAt: k.createdAt,
        revokedAt: k.revokedAt,
      }));
  },
});

export const generate = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgAdmin(ctx);
    const rawKey = "glass_" + randomHex(32);
    const keyHash = await sha256Hex(rawKey);
    const keyPrefix = rawKey.slice(0, 14);

    await ctx.db.insert("apiKeys", {
      orgId,
      userId,
      name: args.name,
      keyHash,
      keyPrefix,
      createdAt: dayjs().valueOf(),
    });

    return rawKey;
  },
});

export const revoke = mutation({
  args: { id: v.id("apiKeys") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAdmin(ctx);
    const key = await ctx.db.get(args.id);
    if (!key || key.orgId !== orgId) throw new Error("Not found");
    if (key.revokedAt) throw new Error("Already revoked");
    await ctx.db.patch(args.id, { revokedAt: dayjs().valueOf() });
  },
});

export const remove = mutation({
  args: { id: v.id("apiKeys") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAdmin(ctx);
    const key = await ctx.db.get(args.id);
    if (!key || key.orgId !== orgId) throw new Error("Not found");
    if (!key.revokedAt) throw new Error("Must revoke before removing");
    await ctx.db.delete(args.id);
  },
});

export const validateKey = internalQuery({
  args: { keyHash: v.string() },
  handler: async (ctx, args) => {
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_keyHash", (idx) => idx.eq("keyHash", args.keyHash))
      .first();
    if (!key || key.revokedAt) return null;
    return { userId: key.userId, orgId: key.orgId, keyId: key._id };
  },
});

export const touchLastUsed = internalMutation({
  args: { id: v.id("apiKeys") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { lastUsedAt: dayjs().valueOf() });
  },
});
