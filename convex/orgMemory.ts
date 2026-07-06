import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import {
  isCompanyContextMemory,
  normalizeMemoryContent,
  type OrgMemoryType,
} from "./lib/orgMemoryPolicy";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const orgMemoryTypeValidator = v.union(
  v.literal("fact"),
  v.literal("preference"),
  v.literal("risk_note"),
  v.literal("observation"),
);
const orgMemorySourceValidator = v.union(
  v.literal("extraction"),
  v.literal("analysis"),
  v.literal("chat"),
  v.literal("email"),
  v.literal("imessage"),
);

async function orgNameById(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
) {
  const org = await ctx.db.get(orgId);
  return org?.name ?? null;
}

async function requireMemoryAdmin(
  ctx: QueryCtx | MutationCtx,
  memoryId: Id<"orgMemory">,
) {
  const userId = await requireAuth(ctx);
  const memory = await ctx.db.get(memoryId);
  if (!memory) throw new Error("Memory item not found");

  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_orgId_userId", (q) =>
      q.eq("orgId", memory.orgId).eq("userId", userId),
    )
    .first();
  if (membership?.role !== "admin") {
    throw new Error("Admin role required to manage memory");
  }

  return {
    memory,
    orgName: await orgNameById(ctx, memory.orgId),
  };
}

function activeCompanyFacts<T extends {
  type: OrgMemoryType;
  content: string;
  expiresAt?: number;
  policyId?: unknown;
}>(
  memories: T[],
  orgName: string | null,
) {
  const now = dayjs().valueOf();
  return memories.filter((memory) =>
    (!memory.expiresAt || memory.expiresAt > now) &&
    isCompanyContextMemory({
      type: memory.type,
      content: memory.content,
      orgName,
      policyId: memory.policyId,
    })
  );
}

export const listAllInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("orgMemory").take(500);
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
      .take(500);
    const orgName = await orgNameById(ctx, args.orgId);
    const active = activeCompanyFacts(memories, orgName);
    active.sort((a, b) => b.updatedAt - a.updatedAt);
    return active.slice(0, args.limit ?? 50);
  },
});

export const listByType = internalQuery({
  args: {
    orgId: v.id("organizations"),
    type: orgMemoryTypeValidator,
  },
  handler: async (ctx, args) => {
    const memories = await ctx.db
      .query("orgMemory")
      .withIndex("by_org_type", (q) =>
        q.eq("orgId", args.orgId).eq("type", args.type),
      )
      .take(500);
    const orgName = await orgNameById(ctx, args.orgId);
    return activeCompanyFacts(memories, orgName);
  },
});

// ── Internal mutations ──

export const upsert = internalMutation({
  args: {
    orgId: v.id("organizations"),
    type: orgMemoryTypeValidator,
    content: v.string(),
    source: orgMemorySourceValidator,
    policyId: v.optional(v.id("policies")),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgName = await orgNameById(ctx, args.orgId);
    const content = normalizeMemoryContent(args.content);
    if (!isCompanyContextMemory({
      type: args.type,
      content,
      orgName,
      policyId: args.policyId,
    })) {
      return null;
    }

    const now = dayjs().valueOf();
    const existing = await ctx.db
      .query("orgMemory")
      .withIndex("by_org_type", (q) =>
        q.eq("orgId", args.orgId).eq("type", args.type),
      )
      .take(500);
    const duplicate = existing.find((m) => m.content === content);
    if (duplicate) {
      await ctx.db.patch(duplicate._id, { updatedAt: now });
      return duplicate._id;
    }
    return await ctx.db.insert("orgMemory", {
      ...args,
      content,
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
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const inserted: string[] = [];
    const orgNames = new Map<string, string | null>();
    for (const item of args.items) {
      const orgKey = String(item.orgId);
      if (!orgNames.has(orgKey)) {
        orgNames.set(orgKey, await orgNameById(ctx, item.orgId));
      }
      const content = normalizeMemoryContent(item.content);
      if (!isCompanyContextMemory({
        type: item.type as OrgMemoryType,
        content,
        orgName: orgNames.get(orgKey),
        policyId: item.policyId,
      })) {
        continue;
      }
      const existing = await ctx.db
        .query("orgMemory")
        .withIndex("by_org_type", (q) =>
          q.eq("orgId", item.orgId).eq("type", item.type),
        )
        .take(500);
      if (existing.some((m) => m.content === content)) continue;
      const id = await ctx.db.insert("orgMemory", {
        ...item,
        content,
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
    const now = dayjs().valueOf();
    const memories = await ctx.db
      .query("orgMemory")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .take(500);
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
      .take(500);
    const orgName = await orgNameById(ctx, membership.orgId);
    return activeCompanyFacts(memories, orgName)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const update = mutation({
  args: {
    id: v.id("orgMemory"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const { memory, orgName } = await requireMemoryAdmin(ctx, args.id);
    const content = normalizeMemoryContent(args.content);
    if (!isCompanyContextMemory({
      type: memory.type,
      content,
      orgName,
      policyId: memory.policyId,
    })) {
      throw new Error("Memory must be a stable company fact");
    }

    const now = dayjs().valueOf();
    await ctx.db.patch(args.id, {
      content,
      updatedAt: now,
    });
    return {
      ...memory,
      content,
      updatedAt: now,
    };
  },
});

export const remove = mutation({
  args: {
    id: v.id("orgMemory"),
  },
  handler: async (ctx, args) => {
    await requireMemoryAdmin(ctx, args.id);
    await ctx.db.delete(args.id);
    return { deleted: true };
  },
});
