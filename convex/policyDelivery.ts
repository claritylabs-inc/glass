import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireCurrentOrgAccess } from "./lib/access";
import { requireBrokerAccessToClient } from "./lib/access";

const channelValidator = v.union(v.literal("email"), v.literal("imessage"));
const actionValidator = v.union(
  v.literal("auto_send"),
  v.literal("broker_review"),
  v.literal("do_not_send"),
);
const statusValidator = v.union(
  v.literal("queued"),
  v.literal("review_required"),
  v.literal("sending"),
  v.literal("sent"),
  v.literal("partially_sent"),
  v.literal("blocked"),
  v.literal("failed"),
  v.literal("suppressed"),
  v.literal("cancelled"),
);
const sourceKindValidator = v.union(v.literal("policy"), v.literal("endorsement"));
const filtersValidator = v.object({
  carriers: v.optional(v.array(v.string())),
  securities: v.optional(v.array(v.string())),
  underwriters: v.optional(v.array(v.string())),
  linesOfBusiness: v.optional(v.array(v.string())),
});

function normalizeText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeChannels(channels: Array<"email" | "imessage"> | undefined) {
  const unique = [...new Set(channels ?? [])];
  return unique.filter((channel) => channel === "email" || channel === "imessage");
}

async function requireBrokerAdmin(ctx: Parameters<typeof requireCurrentOrgAccess>[0]) {
  const access = await requireCurrentOrgAccess(ctx);
  if ((access.org.type ?? "client") !== "broker") {
    throw new Error("Broker organization required");
  }
  if (access.role !== "admin") {
    throw new Error("Broker admin access required");
  }
  return access;
}

async function requireBrokerAdminAccessToClient(
  ctx: Parameters<typeof requireCurrentOrgAccess>[0],
  clientOrgId: Id<"organizations">,
) {
  const access = await requireBrokerAccessToClient(ctx, clientOrgId);
  const current = await requireCurrentOrgAccess(ctx);
  if (current.orgId !== access.brokerOrgId || current.role !== "admin") {
    throw new Error("Broker admin access required");
  }
  return access;
}

export const getBrokerSettings = query({
  args: {},
  handler: async (ctx) => {
    const access = await requireCurrentOrgAccess(ctx);
    if ((access.org.type ?? "client") !== "broker") return null;
    return await ctx.db
      .query("policyDeliverySettings")
      .withIndex("by_brokerOrgId_clientOrgId", (q) =>
        q.eq("brokerOrgId", access.orgId).eq("clientOrgId", undefined),
      )
      .first();
  },
});

export const updateBrokerSettings = mutation({
  args: {
    enabled: v.boolean(),
    channels: v.array(channelValidator),
    defaultAction: actionValidator,
    deliverBeforeClientAcceptance: v.boolean(),
    copyInstructions: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireBrokerAdmin(ctx);
    const now = dayjs().valueOf();
    const patch = {
      enabled: args.enabled,
      channels: normalizeChannels(args.channels),
      defaultAction: args.defaultAction,
      deliverBeforeClientAcceptance: args.deliverBeforeClientAcceptance,
      copyInstructions: normalizeText(args.copyInstructions),
      updatedByUserId: access.userId,
      updatedAt: now,
    };
    const existing = await ctx.db
      .query("policyDeliverySettings")
      .withIndex("by_brokerOrgId_clientOrgId", (q) =>
        q.eq("brokerOrgId", access.orgId).eq("clientOrgId", undefined),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("policyDeliverySettings", {
      brokerOrgId: access.orgId,
      ...patch,
      createdAt: now,
    });
  },
});

export const getClientOverride = query({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await requireBrokerAccessToClient(ctx, args.clientOrgId);
    return await ctx.db
      .query("policyDeliverySettings")
      .withIndex("by_brokerOrgId_clientOrgId", (q) =>
        q.eq("brokerOrgId", access.brokerOrgId).eq("clientOrgId", args.clientOrgId),
      )
      .first();
  },
});

export const getClientSettings = query({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await requireBrokerAccessToClient(ctx, args.clientOrgId);
    const [override, brokerSettings] = await Promise.all([
      ctx.db
        .query("policyDeliverySettings")
        .withIndex("by_brokerOrgId_clientOrgId", (q) =>
          q.eq("brokerOrgId", access.brokerOrgId).eq("clientOrgId", args.clientOrgId),
        )
        .first(),
      ctx.db
        .query("policyDeliverySettings")
        .withIndex("by_brokerOrgId_clientOrgId", (q) =>
          q.eq("brokerOrgId", access.brokerOrgId).eq("clientOrgId", undefined),
        )
        .first(),
    ]);
    return { override, brokerSettings };
  },
});

export const updateClientOverride = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    enabled: v.boolean(),
    channels: v.array(channelValidator),
    defaultAction: actionValidator,
    deliverBeforeClientAcceptance: v.boolean(),
    copyInstructions: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireBrokerAdminAccessToClient(ctx, args.clientOrgId);
    const now = dayjs().valueOf();
    const patch = {
      enabled: args.enabled,
      channels: normalizeChannels(args.channels),
      defaultAction: args.defaultAction,
      deliverBeforeClientAcceptance: args.deliverBeforeClientAcceptance,
      copyInstructions: normalizeText(args.copyInstructions),
      updatedByUserId: access.userId,
      updatedAt: now,
    };
    const existing = await ctx.db
      .query("policyDeliverySettings")
      .withIndex("by_brokerOrgId_clientOrgId", (q) =>
        q.eq("brokerOrgId", access.brokerOrgId).eq("clientOrgId", args.clientOrgId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("policyDeliverySettings", {
      brokerOrgId: access.brokerOrgId,
      clientOrgId: args.clientOrgId,
      ...patch,
      createdAt: now,
    });
  },
});

export const clearClientOverride = mutation({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await requireBrokerAdminAccessToClient(ctx, args.clientOrgId);
    const existing = await ctx.db
      .query("policyDeliverySettings")
      .withIndex("by_brokerOrgId_clientOrgId", (q) =>
        q.eq("brokerOrgId", access.brokerOrgId).eq("clientOrgId", args.clientOrgId),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const listRules = query({
  args: { clientOrgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    let brokerOrgId: Id<"organizations">;
    if (args.clientOrgId) {
      const access = await requireBrokerAccessToClient(ctx, args.clientOrgId);
      brokerOrgId = access.brokerOrgId;
    } else {
      const access = await requireCurrentOrgAccess(ctx);
      if ((access.org.type ?? "client") !== "broker") return [];
      brokerOrgId = access.orgId;
    }
    const rows = await ctx.db
      .query("policyDeliveryRules")
      .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", brokerOrgId))
      .collect();
    return rows
      .filter((row) => row.clientOrgId === args.clientOrgId)
      .sort((a, b) => a.priority - b.priority);
  },
});

export const upsertRule = mutation({
  args: {
    id: v.optional(v.id("policyDeliveryRules")),
    clientOrgId: v.optional(v.id("organizations")),
    name: v.string(),
    enabled: v.boolean(),
    priority: v.number(),
    filters: filtersValidator,
    llmRuleText: v.optional(v.string()),
    action: actionValidator,
    channels: v.optional(v.array(channelValidator)),
    copyInstructions: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clientAccess = args.clientOrgId
      ? await requireBrokerAdminAccessToClient(ctx, args.clientOrgId)
      : null;
    const brokerAccess = args.clientOrgId ? null : await requireBrokerAdmin(ctx);
    const access = clientAccess ?? brokerAccess;
    if (!access) throw new Error("Broker access required");
    const brokerOrgId = clientAccess?.brokerOrgId ?? brokerAccess!.orgId;
    const now = dayjs().valueOf();
    const patch = {
      brokerOrgId,
      clientOrgId: args.clientOrgId,
      name: args.name.trim() || "Delivery rule",
      enabled: args.enabled,
      priority: args.priority,
      filters: args.filters,
      llmRuleText: normalizeText(args.llmRuleText),
      action: args.action,
      channels: args.channels ? normalizeChannels(args.channels) : undefined,
      copyInstructions: normalizeText(args.copyInstructions),
      updatedByUserId: access.userId,
      updatedAt: now,
    };
    if (args.id) {
      const existing = await ctx.db.get(args.id);
      if (!existing || existing.brokerOrgId !== brokerOrgId) throw new Error("Rule not found");
      await ctx.db.patch(args.id, patch);
      return args.id;
    }
    return await ctx.db.insert("policyDeliveryRules", {
      ...patch,
      createdByUserId: access.userId,
      createdAt: now,
    });
  },
});

export const deleteRule = mutation({
  args: { id: v.id("policyDeliveryRules") },
  handler: async (ctx, args) => {
    const access = await requireBrokerAdmin(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.brokerOrgId !== access.orgId) throw new Error("Rule not found");
    await ctx.db.delete(args.id);
  },
});

export const listQueue = query({
  args: {
    status: v.optional(statusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await requireCurrentOrgAccess(ctx);
    if ((access.org.type ?? "client") !== "broker") return [];
    const rows = args.status
      ? await ctx.db
          .query("policyDeliveryJobs")
          .withIndex("by_brokerOrgId_status_updatedAt", (q) =>
            q.eq("brokerOrgId", access.orgId).eq("status", args.status!),
          )
          .order("desc")
          .take(args.limit ?? 100)
      : (await ctx.db
          .query("policyDeliveryJobs")
          .withIndex("by_brokerOrgId_status_updatedAt", (q) =>
            q.eq("brokerOrgId", access.orgId),
          )
          .order("desc")
          .take((args.limit ?? 100) * 2)).slice(0, args.limit ?? 100);

    const hydrated = await Promise.all(
      rows.map(async (job) => {
        const [client, policy, attempts] = await Promise.all([
          ctx.db.get(job.clientOrgId),
          ctx.db.get(job.policyId),
          ctx.db
            .query("policyDeliveryAttempts")
            .withIndex("by_jobId", (q) => q.eq("jobId", job._id))
            .collect(),
        ]);
        if (!policy || policy.deletedAt) return null;
        return { ...job, clientName: client?.name, policy, attempts };
      }),
    );
    return hydrated.filter((row) => row !== null);
  },
});

export const getJob = query({
  args: { id: v.id("policyDeliveryJobs") },
  handler: async (ctx, args) => {
    const access = await requireCurrentOrgAccess(ctx);
    if ((access.org.type ?? "client") !== "broker") return null;
    const job = await ctx.db.get(args.id);
    if (!job || job.brokerOrgId !== access.orgId) return null;
    const policy = await ctx.db.get(job.policyId);
    if (!policy || policy.deletedAt) return null;
    const attempts = await ctx.db
      .query("policyDeliveryAttempts")
      .withIndex("by_jobId", (q) => q.eq("jobId", args.id))
      .collect();
    return { ...job, policy, attempts };
  },
});

export const sendReviewedJob = mutation({
  args: { id: v.id("policyDeliveryJobs") },
  handler: async (ctx, args) => {
    const access = await requireCurrentOrgAccess(ctx);
    const job = await ctx.db.get(args.id);
    if (!job || job.brokerOrgId !== access.orgId) throw new Error("Delivery job not found");
    const policy = await ctx.db.get(job.policyId);
    if (!policy || policy.deletedAt) throw new Error("Policy is archived");
    await ctx.db.patch(args.id, {
      status: "queued",
      action: "auto_send",
      updatedAt: dayjs().valueOf(),
      lastError: undefined,
    });
    await ctx.scheduler.runAfter(0, (internal as any).actions.policyDelivery.processJob, {
      jobId: args.id,
    });
  },
});

export const retryJob = mutation({
  args: { id: v.id("policyDeliveryJobs") },
  handler: async (ctx, args) => {
    const access = await requireCurrentOrgAccess(ctx);
    const job = await ctx.db.get(args.id);
    if (!job || job.brokerOrgId !== access.orgId) throw new Error("Delivery job not found");
    const policy = await ctx.db.get(job.policyId);
    if (!policy || policy.deletedAt) throw new Error("Policy is archived");
    await ctx.db.patch(args.id, {
      status: "queued",
      updatedAt: dayjs().valueOf(),
      lastError: undefined,
    });
    await ctx.scheduler.runAfter(0, (internal as any).actions.policyDelivery.processJob, {
      jobId: args.id,
    });
  },
});

export const suppressJob = mutation({
  args: { id: v.id("policyDeliveryJobs") },
  handler: async (ctx, args) => {
    const access = await requireCurrentOrgAccess(ctx);
    const job = await ctx.db.get(args.id);
    if (!job || job.brokerOrgId !== access.orgId) throw new Error("Delivery job not found");
    await ctx.db.patch(args.id, {
      status: "suppressed",
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const enqueueInternal = internalMutation({
  args: {
    policyId: v.id("policies"),
    policyFileId: v.optional(v.id("policyFiles")),
    sourceKind: sourceKindValidator,
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy?.orgId || policy.deletedAt || !policy.uploadedByBrokerOrgId) {
      return null;
    }
    if ((policy.documentType ?? "policy") !== "policy") return null;
    const idempotencyKey = [
      "policy-delivery",
      args.sourceKind,
      String(args.policyId),
      String(args.policyFileId ?? "primary"),
    ].join(":");
    const existing = await ctx.db
      .query("policyDeliveryJobs")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
      .first();
    if (existing) return existing._id;
    const now = dayjs().valueOf();
    const jobId = await ctx.db.insert("policyDeliveryJobs", {
      brokerOrgId: policy.uploadedByBrokerOrgId,
      clientOrgId: policy.orgId,
      policyId: args.policyId,
      policyFileId: args.policyFileId,
      sourceKind: args.sourceKind,
      idempotencyKey,
      status: "queued",
      action: "auto_send",
      channels: [],
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, (internal as any).actions.policyDelivery.processJob, {
      jobId,
    });
    return jobId;
  },
});

export const getJobInternal = internalQuery({
  args: { id: v.id("policyDeliveryJobs") },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

export const getContextInternal = internalQuery({
  args: { jobId: v.id("policyDeliveryJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    const [broker, client, policy, policyFile] = await Promise.all([
      ctx.db.get(job.brokerOrgId),
      ctx.db.get(job.clientOrgId),
      ctx.db.get(job.policyId),
      job.policyFileId ? ctx.db.get(job.policyFileId) : Promise.resolve(null),
    ]);
    if (!policy || policy.deletedAt) return null;
    const brokerSettings = await ctx.db
      .query("policyDeliverySettings")
      .withIndex("by_brokerOrgId_clientOrgId", (q) =>
        q.eq("brokerOrgId", job.brokerOrgId).eq("clientOrgId", undefined),
      )
      .first();
    const clientSettings = await ctx.db
      .query("policyDeliverySettings")
      .withIndex("by_brokerOrgId_clientOrgId", (q) =>
        q.eq("brokerOrgId", job.brokerOrgId).eq("clientOrgId", job.clientOrgId),
      )
      .first();
    const allRules = await ctx.db
      .query("policyDeliveryRules")
      .withIndex("by_brokerOrgId", (q) => q.eq("brokerOrgId", job.brokerOrgId))
      .collect();
    const clientRules = allRules.filter((rule) => rule.enabled && rule.clientOrgId === job.clientOrgId);
    const brokerRules = allRules.filter((rule) => rule.enabled && rule.clientOrgId === undefined);
    const rules = [...clientRules, ...brokerRules].sort((a, b) => a.priority - b.priority);
    const members = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", job.clientOrgId))
      .collect();
    const users = await Promise.all(members.map((membership) => ctx.db.get(membership.userId)));
    const primaryInsuranceContact = client?.primaryInsuranceContactId
      ? await ctx.db.get(client.primaryInsuranceContactId)
      : null;
    const uploadedBy = policy?.uploadedByUserId
      ? await ctx.db.get(policy.uploadedByUserId)
      : null;
    const brokerMembers = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", job.brokerOrgId))
      .collect();
    return {
      job,
      broker,
      client,
      policy,
      policyFile,
      brokerSettings,
      clientSettings,
      rules,
      members: members.map((membership, index) => ({ ...membership, user: users[index] })),
      primaryInsuranceContact,
      uploadedBy,
      fallbackUserId: policy?.uploadedByUserId ?? brokerMembers[0]?.userId,
    };
  },
});

export const patchJobInternal = internalMutation({
  args: {
    id: v.id("policyDeliveryJobs"),
    status: v.optional(statusValidator),
    action: v.optional(actionValidator),
    channels: v.optional(v.array(channelValidator)),
    ruleId: v.optional(v.id("policyDeliveryRules")),
    ruleName: v.optional(v.string()),
    decisionSummary: v.optional(v.string()),
    decisionDetails: v.optional(v.any()),
    recipientName: v.optional(v.string()),
    recipientEmail: v.optional(v.string()),
    recipientPhone: v.optional(v.string()),
    threadId: v.optional(v.id("threads")),
    emailSentAt: v.optional(v.number()),
    imessageSentAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...patch } = args;
    await ctx.db.patch(id, {
      ...patch,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const insertAttemptInternal = internalMutation({
  args: {
    jobId: v.id("policyDeliveryJobs"),
    brokerOrgId: v.id("organizations"),
    clientOrgId: v.id("organizations"),
    policyId: v.id("policies"),
    channel: channelValidator,
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("policyDeliveryAttempts", {
      ...args,
      createdAt: dayjs().valueOf(),
    });
  },
});
