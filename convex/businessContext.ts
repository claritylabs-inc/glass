import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { requireOrgAccess, getOrgAccess } from "./lib/orgAuth";

// ── Public (auth-scoped) ──

export const list = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const { orgId } = access;
    const entries = await ctx.db
      .query("orgBusinessContext")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
    // Group by category
    const grouped: Record<string, typeof entries> = {};
    for (const entry of entries) {
      if (!grouped[entry.category]) grouped[entry.category] = [];
      grouped[entry.category].push(entry);
    }
    return grouped;
  },
});

export const get = query({
  args: { id: v.id("orgBusinessContext") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const entry = await ctx.db.get(args.id);
    if (!entry || entry.orgId !== orgId) return null;
    return entry;
  },
});

export const upsert = mutation({
  args: {
    category: v.string(),
    key: v.string(),
    value: v.string(),
    fieldType: v.optional(
      v.union(
        v.literal("text"),
        v.literal("numeric"),
        v.literal("currency"),
        v.literal("date"),
        v.literal("yes_no"),
      ),
    ),
    source: v.optional(
      v.union(
        v.literal("onboarding"),
        v.literal("application"),
        v.literal("user_email"),
        v.literal("manual"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const existing = await ctx.db
      .query("orgBusinessContext")
      .withIndex("by_orgId_key", (idx) =>
        idx.eq("orgId", orgId).eq("key", args.key),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        value: args.value,
        category: args.category,
        fieldType: args.fieldType,
        source: args.source ?? "manual",
        confidence: "confirmed" as const,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("orgBusinessContext", {
      orgId,
      category: args.category,
      key: args.key,
      value: args.value,
      fieldType: args.fieldType,
      source: args.source ?? "manual",
      confidence: "confirmed",
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("orgBusinessContext") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    const entry = await ctx.db.get(args.id);
    if (!entry || entry.orgId !== orgId) throw new Error("Not found");
    await ctx.db.delete(args.id);
  },
});

export const bulkUpsert = mutation({
  args: {
    entries: v.array(
      v.object({
        category: v.string(),
        key: v.string(),
        value: v.string(),
        fieldType: v.optional(
          v.union(
            v.literal("text"),
            v.literal("numeric"),
            v.literal("currency"),
            v.literal("date"),
            v.literal("yes_no"),
          ),
        ),
        source: v.optional(
          v.union(
            v.literal("onboarding"),
            v.literal("application"),
            v.literal("user_email"),
            v.literal("manual"),
          ),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    for (const entry of args.entries) {
      const existing = await ctx.db
        .query("orgBusinessContext")
        .withIndex("by_orgId_key", (idx) =>
          idx.eq("orgId", orgId).eq("key", entry.key),
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          value: entry.value,
          category: entry.category,
          fieldType: entry.fieldType,
          source: entry.source ?? "manual",
          confidence: "confirmed" as const,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("orgBusinessContext", {
          orgId,
          category: entry.category,
          key: entry.key,
          value: entry.value,
          fieldType: entry.fieldType,
          source: entry.source ?? "manual",
          confidence: "confirmed",
          updatedAt: Date.now(),
        });
      }
    }
  },
});

export const listAllInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("orgBusinessContext").collect();
  },
});

// ── Internal (for agent actions) ──

export const listInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("orgBusinessContext")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", args.orgId))
      .collect();
  },
});

export const upsertInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    category: v.string(),
    key: v.string(),
    value: v.string(),
    fieldType: v.optional(
      v.union(
        v.literal("text"),
        v.literal("numeric"),
        v.literal("currency"),
        v.literal("date"),
        v.literal("yes_no"),
      ),
    ),
    source: v.union(
      v.literal("onboarding"),
      v.literal("application"),
      v.literal("user_email"),
      v.literal("manual"),
    ),
    confidence: v.union(v.literal("confirmed"), v.literal("inferred")),
    sourceConversationId: v.optional(v.id("agentConversations")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("orgBusinessContext")
      .withIndex("by_orgId_key", (idx) =>
        idx.eq("orgId", args.orgId).eq("key", args.key),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        value: args.value,
        category: args.category,
        fieldType: args.fieldType,
        source: args.source,
        confidence: args.confidence,
        sourceConversationId: args.sourceConversationId,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("orgBusinessContext", {
      orgId: args.orgId,
      category: args.category,
      key: args.key,
      value: args.value,
      fieldType: args.fieldType,
      source: args.source,
      confidence: args.confidence,
      sourceConversationId: args.sourceConversationId,
      updatedAt: Date.now(),
    });
  },
});

export const bulkUpsertInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    entries: v.array(
      v.object({
        category: v.string(),
        key: v.string(),
        value: v.string(),
        fieldType: v.optional(
          v.union(
            v.literal("text"),
            v.literal("numeric"),
            v.literal("currency"),
            v.literal("date"),
            v.literal("yes_no"),
          ),
        ),
        source: v.union(
          v.literal("onboarding"),
          v.literal("application"),
          v.literal("user_email"),
          v.literal("manual"),
        ),
        confidence: v.union(v.literal("confirmed"), v.literal("inferred")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const entry of args.entries) {
      const existing = await ctx.db
        .query("orgBusinessContext")
        .withIndex("by_orgId_key", (idx) =>
          idx.eq("orgId", args.orgId).eq("key", entry.key),
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          value: entry.value,
          category: entry.category,
          fieldType: entry.fieldType,
          source: entry.source,
          confidence: entry.confidence,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("orgBusinessContext", {
          orgId: args.orgId,
          category: entry.category,
          key: entry.key,
          value: entry.value,
          fieldType: entry.fieldType,
          source: entry.source,
          confidence: entry.confidence,
          updatedAt: Date.now(),
        });
      }
    }
  },
});
