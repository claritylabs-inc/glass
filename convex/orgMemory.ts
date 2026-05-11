import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";

export const listAllInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("orgMemory").collect();
  },
});

// ── Internal queries ──

export const listByOrg = internalQuery({
  args: {
    orgId: v.id("organizations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const memories = await ctx.db
      .query("orgMemory")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const now = Date.now();
    const active = memories.filter((m) => !m.expiresAt || m.expiresAt > now);
    active.sort((a, b) => b.updatedAt - a.updatedAt);
    return active.slice(0, args.limit ?? 50);
  },
});

export const listByType = internalQuery({
  args: {
    orgId: v.id("organizations"),
    type: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("orgMemory")
      .withIndex("by_org_type", (q) =>

        q.eq("orgId", args.orgId).eq("type", args.type as any),
      )
      .collect();
  },
});

// ── Internal mutations ──

export const upsert = internalMutation({
  args: {
    orgId: v.id("organizations"),
    type: v.union(
      v.literal("fact"),
      v.literal("preference"),
      v.literal("risk_note"),
      v.literal("observation"),
    ),
    content: v.string(),
    source: v.union(
      v.literal("extraction"),
      v.literal("analysis"),
      v.literal("chat"),
      v.literal("email"),
      v.literal("imessage"),
    ),
    policyId: v.optional(v.id("policies")),
    quoteId: v.optional(v.id("policies")),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("orgMemory")
      .withIndex("by_org_type", (q) =>
        q.eq("orgId", args.orgId).eq("type", args.type),
      )
      .collect();
    const duplicate = existing.find((m) => m.content === args.content);
    if (duplicate) {
      await ctx.db.patch(duplicate._id, { updatedAt: now });
      return duplicate._id;
    }
    return await ctx.db.insert("orgMemory", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const bulkInsert = internalMutation({
  args: {
    items: v.array(
      v.object({
        orgId: v.id("organizations"),
        type: v.union(
          v.literal("fact"),
          v.literal("preference"),
          v.literal("risk_note"),
          v.literal("observation"),
        ),
        content: v.string(),
        source: v.union(
          v.literal("extraction"),
          v.literal("analysis"),
          v.literal("chat"),
          v.literal("email"),
          v.literal("imessage"),
        ),
        policyId: v.optional(v.id("policies")),
        quoteId: v.optional(v.id("policies")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const inserted: string[] = [];
    for (const item of args.items) {
      const existing = await ctx.db
        .query("orgMemory")
        .withIndex("by_org_type", (q) =>
          q.eq("orgId", item.orgId).eq("type", item.type),
        )
        .collect();
      if (existing.some((m) => m.content === item.content)) continue;
      const id = await ctx.db.insert("orgMemory", {
        ...item,
        createdAt: now,
        updatedAt: now,
      });
      inserted.push(id);
    }
    return inserted;
  },
});

export const deleteExpired = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const memories = await ctx.db
      .query("orgMemory")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    let cleaned = 0;
    for (const m of memories) {
      if (m.expiresAt && m.expiresAt <= now) {
        await ctx.db.delete(m._id);
        cleaned++;
      }
    }
    return cleaned;
  },
});

// ── Public query (for UI) ──

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!membership) return [];
    const memories = await ctx.db
      .query("orgMemory")
      .withIndex("by_org", (q) => q.eq("orgId", membership.orgId))
      .collect();
    const now = Date.now();
    return memories
      .filter((m) => !m.expiresAt || m.expiresAt > now)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});
