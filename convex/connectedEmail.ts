import dayjs from "dayjs";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getOrgAccess } from "./lib/access";

function publicAccount(account: any) {
  return {
    _id: account._id,
    orgId: account.orgId,
    userId: account.userId,
    scope: account.scope,
    label: account.label,
    emailAddress: account.emailAddress,
    host: account.host,
    port: account.port,
    secure: account.secure,
    username: account.username,
    status: account.status,
    lastError: account.lastError,
    lastTestedAt: account.lastTestedAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

async function requireDirectOrgMember(ctx: any, orgId: Id<"organizations">) {
  const access = await getOrgAccess(ctx, orgId);
  if (access.accessType !== "member") {
    throw new Error("Connected email is available only to direct org members");
  }
  return access;
}

export const list = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const access = await requireDirectOrgMember(ctx, args.orgId);
    const accounts = await ctx.db
      .query("connectedEmailAccounts")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();
    return accounts
      .filter(
        (account) =>
          account.status !== "revoked" &&
          (account.scope === "org" || account.userId === access.userId),
      )
      .map(publicAccount);
  },
});

export const getAccessibleInternal = internalQuery({
  args: {
    accountId: v.id("connectedEmailAccounts"),
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account || account.orgId !== args.orgId || account.status !== "active") {
      return null;
    }
    if (account.scope === "user" && (!args.userId || account.userId !== args.userId)) {
      return null;
    }
    return account;
  },
});

export const listAccessibleInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("connectedEmailAccounts")
      .withIndex("by_orgId_status", (q) =>
        q.eq("orgId", args.orgId).eq("status", "active"),
      )
      .collect();
    return accounts.filter(
      (account) =>
        account.scope === "org" || (!!args.userId && account.userId === args.userId),
    );
  },
});

export const listOrgScopedInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("connectedEmailAccounts")
      .withIndex("by_orgId_status", (q) =>
        q.eq("orgId", args.orgId).eq("status", "active"),
      )
      .filter((q) => q.eq(q.field("scope"), "org"))
      .collect();
  },
});

export const listOrgIdsWithOrgScopedAccountsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.db
      .query("connectedEmailAccounts")
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "active"),
          q.eq(q.field("scope"), "org"),
        ),
      )
      .collect();
    return [...new Set(accounts.map((account) => account.orgId))];
  },
});

export const upsertInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    scope: v.union(v.literal("user"), v.literal("org")),
    label: v.optional(v.string()),
    emailAddress: v.string(),
    host: v.string(),
    port: v.number(),
    secure: v.boolean(),
    username: v.string(),
    encryptedPassword: v.string(),
    encryptionKeyVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const existing = await ctx.db
      .query("connectedEmailAccounts")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("emailAddress"), args.emailAddress),
          q.neq(q.field("status"), "revoked"),
        ),
      )
      .first();
    const patch = {
      scope: args.scope,
      label: args.label,
      emailAddress: args.emailAddress,
      host: args.host,
      port: args.port,
      secure: args.secure,
      username: args.username,
      encryptedPassword: args.encryptedPassword,
      encryptionKeyVersion: args.encryptionKeyVersion,
      status: "active" as const,
      lastError: undefined,
      lastTestedAt: now,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("connectedEmailAccounts", {
      orgId: args.orgId,
      userId: args.userId,
      createdAt: now,
      ...patch,
    });
  },
});

export const markErrorInternal = internalMutation({
  args: {
    accountId: v.id("connectedEmailAccounts"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.accountId, {
      status: "error",
      lastError: args.error,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const updateScope = mutation({
  args: {
    accountId: v.id("connectedEmailAccounts"),
    scope: v.union(v.literal("user"), v.literal("org")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const account = await ctx.db.get(args.accountId);
    if (!account || account.status === "revoked") throw new Error("Email account not found");
    const access = await requireDirectOrgMember(ctx, account.orgId);
    if (account.userId !== userId && access.role !== "admin") {
      throw new Error("Only the account owner or an org admin can update scope");
    }
    if (args.scope === "org" && access.role !== "admin") {
      throw new Error("Only org admins can make a mailbox available to the organization");
    }
    await ctx.db.patch(account._id, {
      scope: args.scope,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const revoke = mutation({
  args: { accountId: v.id("connectedEmailAccounts") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const account = await ctx.db.get(args.accountId);
    if (!account || account.status === "revoked") return;
    const access = await requireDirectOrgMember(ctx, account.orgId);
    if (account.userId !== userId && access.role !== "admin") {
      throw new Error("Only the account owner or an org admin can disconnect this mailbox");
    }
    await ctx.db.patch(account._id, {
      status: "revoked",
      updatedAt: dayjs().valueOf(),
    });
  },
});
