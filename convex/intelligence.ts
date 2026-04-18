import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { getOrgAccess } from "./lib/orgAuth";

// ── Queries ──

export const list = query({
  args: { category: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const { orgId } = access;

    if (args.category) {
      return await ctx.db
        .query("orgIntelligence")
        .withIndex("by_orgId_category", (idx) =>
          idx.eq("orgId", orgId).eq("category", args.category as string)
        )
        .collect();
    }

    return await ctx.db
      .query("orgIntelligence")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();
  },
});

/** List distinct uploaded business-context documents (source=manual with a sourceRef). */
export const listUploadedDocuments = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const { orgId } = access;

    const entries = await ctx.db
      .query("orgIntelligence")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", orgId))
      .collect();

    // Group manual-source entries by sourceRef to get distinct documents
    const docs = new Map<string, { sourceRef: string; sourceLabel?: string; entryCount: number; createdAt: number }>();
    for (const e of entries) {
      if (e.source !== "manual" || !e.sourceRef) continue;
      const existing = docs.get(e.sourceRef);
      if (existing) {
        existing.entryCount++;
      } else {
        docs.set(e.sourceRef, {
          sourceRef: e.sourceRef,
          sourceLabel: e.sourceLabel,
          entryCount: 1,
          createdAt: e.createdAt ?? e._creationTime,
        });
      }
    }

    return [...docs.values()].sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    const all = await ctx.db
      .query("orgIntelligence")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", access.orgId))
      .collect();
    return all.filter((e) => !e.supersededBy && e.confidence !== "stale");
  },
});

// ── Internal Queries ──

export const listByOrg = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("orgIntelligence")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", args.orgId))
      .collect();
  },
});

export const listActiveByOrg = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("orgIntelligence")
      .withIndex("by_orgId", (idx) => idx.eq("orgId", args.orgId))
      .collect();
    return all.filter((e) => !e.supersededBy && e.confidence !== "stale");
  },
});

// Note: vector search must be called from action context directly.
// Use hydrateSearchResults to fetch full docs after ctx.vectorSearch.
export const hydrateSearchResults = internalQuery({
  args: {
    ids: v.array(v.id("orgIntelligence")),
  },
  handler: async (ctx, args) => {
    const entries = await Promise.all(
      args.ids.map(async (id) => {
        const doc = await ctx.db.get(id);
        return doc;
      })
    );
    return entries.filter(
      (e) => e !== null && !e.supersededBy && e.confidence !== "stale"
    );
  },
});

// ── Internal Mutations ──

export const insert = internalMutation({
  args: {
    orgId: v.id("organizations"),
    content: v.string(),
    category: v.union(
      v.literal("company_info"),
      v.literal("products_services"),
      v.literal("operations"),
      v.literal("employees"),
      v.literal("financial"),
      v.literal("coverage"),
      v.literal("risk"),
      v.literal("relationship"),
      v.literal("clients"),
      v.literal("insurance"),
      v.literal("investors"),
      v.literal("vendors"),
      v.literal("partners"),
      v.literal("observation"),
    ),
    confidence: v.union(
      v.literal("confirmed"),
      v.literal("inferred"),
      v.literal("stale"),
    ),
    source: v.union(
      v.literal("email"),
      v.literal("application"),
      v.literal("chat"),
      v.literal("extraction"),
      v.literal("dream"),
      v.literal("manual"),
    ),
    sourceRef: v.optional(v.string()),
    sourceLabel: v.optional(v.string()),
    asOfDate: v.optional(v.string()),
    documentDate: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("orgIntelligence", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const bulkInsert = internalMutation({
  args: {
    entries: v.array(v.object({
      orgId: v.id("organizations"),
      content: v.string(),
      category: v.string(),
      confidence: v.string(),
      source: v.string(),
      sourceRef: v.optional(v.string()),
      sourceLabel: v.optional(v.string()),
      asOfDate: v.optional(v.string()),
      documentDate: v.optional(v.string()),
      embedding: v.optional(v.array(v.float64())),
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const ids = [];
    for (const entry of args.entries) {
      const id = await ctx.db.insert("orgIntelligence", {
        ...(entry as Record<string, unknown>),
        createdAt: now,
        updatedAt: now,
      });
      ids.push(id);
    }
    return ids;
  },
});

export const bulkInsertWithTimestamps = internalMutation({
  args: {
    entries: v.array(v.object({
      orgId: v.id("organizations"),
      content: v.string(),
      category: v.string(),
      confidence: v.string(),
      source: v.string(),
      sourceRef: v.optional(v.string()),
      sourceLabel: v.optional(v.string()),
      asOfDate: v.optional(v.string()),
      documentDate: v.optional(v.string()),
      embedding: v.optional(v.array(v.float64())),
      createdAt: v.number(),
      updatedAt: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const ids = [];
    for (const entry of args.entries) {
      const id = await ctx.db.insert("orgIntelligence", entry as never);
      ids.push(id);
    }
    return ids;
  },
});

export const markSuperseded = internalMutation({
  args: {
    id: v.id("orgIntelligence"),
    supersededBy: v.id("orgIntelligence"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      supersededBy: args.supersededBy,
      confidence: "stale" as const,
      updatedAt: Date.now(),
    });
  },
});

export const markStale = internalMutation({
  args: { ids: v.array(v.id("orgIntelligence")) },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const id of args.ids) {
      await ctx.db.patch(id, { confidence: "stale" as const, updatedAt: now });
    }
  },
});

export const bulkRecategorize = internalMutation({
  args: {
    updates: v.array(v.object({
      id: v.id("orgIntelligence"),
      category: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const { id, category } of args.updates) {
      await ctx.db.patch(id, { category: category as never, updatedAt: now });
    }
  },
});

export const bulkDelete = internalMutation({
  args: { ids: v.array(v.id("orgIntelligence")) },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      await ctx.db.delete(id);
    }
  },
});

export const updateEntry = internalMutation({
  args: {
    id: v.id("orgIntelligence"),
    content: v.optional(v.string()),
    confidence: v.optional(v.union(
      v.literal("confirmed"),
      v.literal("inferred"),
      v.literal("stale"),
    )),
    embedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, { ...fields, updatedAt: Date.now() });
  },
});

// ── Public Mutations ──

export const update = mutation({
  args: {
    id: v.id("orgIntelligence"),
    content: v.optional(v.string()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) throw new Error("Not authenticated");
    const entry = await ctx.db.get(args.id);
    if (!entry || entry.orgId !== access.orgId) throw new Error("Not found");
    const patch: Record<string, unknown> = {
      confidence: "confirmed" as const,
      updatedAt: Date.now(),
    };
    if (args.content !== undefined) patch.content = args.content;
    if (args.category !== undefined) patch.category = args.category;
    await ctx.db.patch(args.id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("orgIntelligence") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) throw new Error("Not authenticated");
    const entry = await ctx.db.get(args.id);
    if (!entry || entry.orgId !== access.orgId) throw new Error("Not found");
    await ctx.db.delete(args.id);
  },
});

// One-time maintenance: remove legacy `tags` fields from orgIntelligence rows.
export const removeLegacyTags = mutation({
  args: {},
  handler: async (ctx) => {
    const entries = await ctx.db.query("orgIntelligence").collect();
    let updated = 0;
    for (const entry of entries) {
      if ("tags" in entry) {
        await ctx.db.patch(entry._id, { tags: undefined });
        updated += 1;
      }
    }
    return { updated };
  },
});
