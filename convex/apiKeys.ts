import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { requireOrgAccess } from "./lib/orgAuth";

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

// ── Public (auth-scoped) ──

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireOrgAccess(ctx);
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    // Return without the hash, sorted newest first
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
    const { userId, orgId } = await requireOrgAccess(ctx);
    const rawKey = "prism_" + randomHex(32); // prism_ + 64 hex chars
    const keyHash = await sha256Hex(rawKey);
    const keyPrefix = rawKey.slice(0, 14); // "prism_" + 8 hex chars

    await ctx.db.insert("apiKeys", {
      orgId,
      userId,
      name: args.name,
      keyHash,
      keyPrefix,
      createdAt: Date.now(),
    });

    // Return the full key — this is the only time it's visible
    return rawKey;
  },
});

export const revoke = mutation({
  args: { id: v.id("apiKeys") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const key = await ctx.db.get(args.id);
    if (!key || key.orgId !== orgId) throw new Error("Not found");
    if (key.revokedAt) throw new Error("Already revoked");
    await ctx.db.patch(args.id, { revokedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { id: v.id("apiKeys") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const key = await ctx.db.get(args.id);
    if (!key || key.orgId !== orgId) throw new Error("Not found");
    if (!key.revokedAt) throw new Error("Must revoke before removing");
    await ctx.db.delete(args.id);
  },
});

// ── Internal (for HTTP action auth) ──

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
    await ctx.db.patch(args.id, { lastUsedAt: Date.now() });
  },
});
