import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireCurrentOrgAccess } from "./lib/access";
import { requireBrokerAccessToClient } from "./lib/access";
import { requireCurrentOrgAdminWrite } from "./lib/access";
import { requireOperator, writeOperatorAudit } from "./lib/operatorIdentity";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

const channelValidator = v.union(
  v.literal("email"),
  v.literal("imessage"),
  v.literal("slack"),
);
const actionValidator = v.union(
  v.literal("auto_send"),
  v.literal("broker_review"),
  v.literal("service_review"),
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

type DeliveryChannel = "email" | "imessage" | "slack";

function normalizeChannels(channels: DeliveryChannel[] | undefined) {
  const unique = [...new Set(channels ?? [])];
  return unique.filter(
    (channel) =>
      channel === "email" || channel === "imessage" || channel === "slack",
  );
}

export const getClientOwnedSettings = query({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await getOrgAccessForClientDelivery(ctx, args.clientOrgId);
    const owned = await ctx.db
      .query("policyDeliverySettings")
      .withIndex("by_deliveryOwnerOrgId_and_clientOrgId", (q) =>
        q
          .eq("deliveryOwnerOrgId", args.clientOrgId)
          .eq("clientOrgId", args.clientOrgId),
      )
      .first();
    if (owned) return owned;
    const client = await ctx.db.get(args.clientOrgId);
    if (!client?.brokerOrgId) return null;
    return await ctx.db
      .query("policyDeliverySettings")
      .withIndex("by_brokerOrgId_clientOrgId", (q) =>
        q.eq("brokerOrgId", client.brokerOrgId).eq("clientOrgId", args.clientOrgId),
      )
      .first();
  },
});

async function getOrgAccessForClientDelivery(
  ctx: Parameters<typeof requireCurrentOrgAccess>[0],
  clientOrgId: Id<"organizations">,
) {
  const current = await requireCurrentOrgAccess(ctx);
  if (current.orgId === clientOrgId) return current;
  await requireBrokerAccessToClient(ctx, clientOrgId);
  return current;
}

async function upsertClientOwnedSettings(
  ctx: Parameters<typeof requireCurrentOrgAdminWrite>[0],
  args: {
    clientOrgId: Id<"organizations">;
    enabled: boolean;
    channels: DeliveryChannel[];
    defaultAction: "auto_send" | "broker_review" | "service_review" | "do_not_send";
    deliverBeforeClientAcceptance: boolean;
    copyInstructions?: string;
    updatedByUserId: Id<"users">;
  },
) {
  const existing = await ctx.db
    .query("policyDeliverySettings")
    .withIndex("by_deliveryOwnerOrgId_and_clientOrgId", (q) =>
      q
        .eq("deliveryOwnerOrgId", args.clientOrgId)
        .eq("clientOrgId", args.clientOrgId),
    )
    .first();
  const now = dayjs().valueOf();
  const patch = {
    deliveryOwnerOrgId: args.clientOrgId,
    clientOrgId: args.clientOrgId,
    enabled: args.enabled,
    channels: normalizeChannels(args.channels),
    defaultAction: args.defaultAction,
    deliverBeforeClientAcceptance: args.deliverBeforeClientAcceptance,
    copyInstructions: normalizeText(args.copyInstructions),
    updatedByUserId: args.updatedByUserId,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }
  return await ctx.db.insert("policyDeliverySettings", {
    ...patch,
    createdAt: now,
  });
}

export const updateClientOwnedSettings = mutation({
  args: {
    enabled: v.boolean(),
    channels: v.array(channelValidator),
    defaultAction: actionValidator,
    deliverBeforeClientAcceptance: v.boolean(),
    copyInstructions: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireCurrentOrgAdminWrite(ctx);
    if ((access.org.type ?? "client") !== "client") {
      throw new Error("Policy delivery is owned by a client organization");
    }
    return await upsertClientOwnedSettings(ctx, {
      clientOrgId: access.orgId,
      ...args,
      updatedByUserId: access.userId,
    });
  },
});

export const updateClientOwnedSettingsForOperator = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    enabled: v.boolean(),
    channels: v.array(channelValidator),
    defaultAction: actionValidator,
    deliverBeforeClientAcceptance: v.boolean(),
    copyInstructions: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const id = await upsertClientOwnedSettings(ctx, {
      ...args,
      updatedByUserId: operator.userId,
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: args.clientOrgId,
      summary: "Updated client-owned policy delivery settings",
      metadata: {
        enabled: args.enabled,
        channels: args.channels,
        defaultAction: args.defaultAction,
      },
    });
    return id;
  },
});

async function requireBrokerAdmin(ctx: Parameters<typeof requireCurrentOrgAccess>[0]) {
  const access = await requireCurrentOrgAccess(ctx);
  if ((access.org.type ?? "client") !== "broker") {
    throwUserFacingError(
      userFacingErrorCodes.orgAccessRequired,
      "Switch to a broker organization to manage policy delivery.",
    );
  }
  if (access.role !== "admin") {
    throwUserFacingError(userFacingErrorCodes.brokerAdminRequired);
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
    throwUserFacingError(userFacingErrorCodes.brokerAdminRequired);
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
      deliveryOwnerOrgId: args.clientOrgId,
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
    const current = await requireCurrentOrgAccess(ctx);
    if ((current.org.type ?? "client") === "client") {
      if (args.clientOrgId && args.clientOrgId !== current.orgId) return [];
      return await ctx.db
        .query("policyDeliveryRules")
        .withIndex("by_deliveryOwnerOrgId_and_clientOrgId", (q) =>
          q
            .eq("deliveryOwnerOrgId", current.orgId)
            .eq("clientOrgId", current.orgId),
        )
        .collect()
        .then((rows) => rows.sort((a, b) => a.priority - b.priority));
    }
    let brokerOrgId: Id<"organizations">;
    if (args.clientOrgId) {
      const access = await requireBrokerAccessToClient(ctx, args.clientOrgId);
      brokerOrgId = access.brokerOrgId;
    } else {
      brokerOrgId = current.orgId;
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
    const current = await requireCurrentOrgAccess(ctx);
    if ((current.org.type ?? "client") === "client") {
      if (current.role !== "admin") {
        throwUserFacingError(userFacingErrorCodes.clientAdminRequired);
      }
      if (args.clientOrgId && args.clientOrgId !== current.orgId) {
        throwUserFacingError(userFacingErrorCodes.orgAccessRequired);
      }
      const now = dayjs().valueOf();
      const patch = {
        brokerOrgId: current.org.brokerOrgId,
        deliveryOwnerOrgId: current.orgId,
        clientOrgId: current.orgId,
        name: args.name.trim() || "Delivery rule",
        enabled: args.enabled,
        priority: args.priority,
        filters: args.filters,
        llmRuleText: normalizeText(args.llmRuleText),
        action: args.action,
        channels: args.channels ? normalizeChannels(args.channels) : undefined,
        copyInstructions: normalizeText(args.copyInstructions),
        updatedByUserId: current.userId,
        updatedAt: now,
      };
      if (args.id) {
        const existing = await ctx.db.get(args.id);
        if (!existing || existing.deliveryOwnerOrgId !== current.orgId) {
          throw new Error("Rule not found");
        }
        await ctx.db.patch(args.id, patch);
        return args.id;
      }
      return await ctx.db.insert("policyDeliveryRules", {
        ...patch,
        createdByUserId: current.userId,
        createdAt: now,
      });
    }
    const clientAccess = args.clientOrgId
      ? await requireBrokerAdminAccessToClient(ctx, args.clientOrgId)
      : null;
    const brokerAccess = args.clientOrgId ? null : await requireBrokerAdmin(ctx);
    const access = clientAccess ?? brokerAccess;
    if (!access) {
      throwUserFacingError(
        userFacingErrorCodes.orgAccessRequired,
        "You need broker access to manage policy delivery.",
      );
    }
    const brokerOrgId = clientAccess?.brokerOrgId ?? brokerAccess!.orgId;
    const now = dayjs().valueOf();
    const patch = {
      brokerOrgId,
      deliveryOwnerOrgId: args.clientOrgId,
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
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Rule not found");
    const current = await requireCurrentOrgAccess(ctx);
    if ((current.org.type ?? "client") === "client") {
      if (current.role !== "admin" || existing.deliveryOwnerOrgId !== current.orgId) {
        throwUserFacingError(userFacingErrorCodes.clientAdminRequired);
      }
    } else if (current.role !== "admin" || existing.brokerOrgId !== current.orgId) {
      throwUserFacingError(userFacingErrorCodes.brokerAdminRequired);
    }
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
    if (!policy?.orgId || policy.deletedAt) {
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
      deliveryOwnerOrgId: policy.orgId,
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
    const deliveryOwnerOrgId = job.deliveryOwnerOrgId ?? job.clientOrgId;
    const [broker, client, policy, policyFile] = await Promise.all([
      job.brokerOrgId ? ctx.db.get(job.brokerOrgId) : Promise.resolve(null),
      ctx.db.get(job.clientOrgId),
      ctx.db.get(job.policyId),
      job.policyFileId ? ctx.db.get(job.policyFileId) : Promise.resolve(null),
    ]);
    if (!policy || policy.deletedAt) return null;
    const ownerSettings = await ctx.db
      .query("policyDeliverySettings")
      .withIndex("by_deliveryOwnerOrgId_and_clientOrgId", (q) =>
        q
          .eq("deliveryOwnerOrgId", deliveryOwnerOrgId)
          .eq("clientOrgId", job.clientOrgId),
      )
      .first();
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
    const ownerRules = await ctx.db
      .query("policyDeliveryRules")
      .withIndex("by_deliveryOwnerOrgId_and_clientOrgId", (q) =>
        q
          .eq("deliveryOwnerOrgId", deliveryOwnerOrgId)
          .eq("clientOrgId", job.clientOrgId),
      )
      .collect();
    const allRules = job.brokerOrgId
      ? await ctx.db
          .query("policyDeliveryRules")
          .withIndex("by_brokerOrgId", (q) =>
            q.eq("brokerOrgId", job.brokerOrgId),
          )
          .collect()
      : [];
    const clientRules = allRules.filter((rule) => rule.enabled && rule.clientOrgId === job.clientOrgId);
    const brokerRules = allRules.filter((rule) => rule.enabled && rule.clientOrgId === undefined);
    const rules = (ownerRules.length > 0
      ? ownerRules.filter((rule) => rule.enabled)
      : [...clientRules, ...brokerRules]
    ).sort((a, b) => a.priority - b.priority);
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
    const brokerOrgId = job.brokerOrgId;
    const brokerMembers = brokerOrgId
      ? await ctx.db
          .query("orgMemberships")
          .withIndex("by_orgId", (q) => q.eq("orgId", brokerOrgId))
          .collect()
      : [];
    const connection = await ctx.db
      .query("slackWorkspaceConnections")
      .withIndex("by_clientOrgId_and_status", (q) =>
        q.eq("clientOrgId", job.clientOrgId).eq("status", "active"),
      )
      .first();
    const primarySlackChannel = connection
      ? await ctx.db
          .query("slackChannelBindings")
          .withIndex("by_connectionId_and_status", (q) =>
            q.eq("connectionId", connection._id).eq("status", "active"),
          )
          .first()
      : null;
    const agentChannels = await ctx.db
      .query("agentChannelSettings")
      .withIndex("by_clientOrgId", (q) =>
        q.eq("clientOrgId", job.clientOrgId),
      )
      .first();
    return {
      job,
      broker,
      client,
      policy,
      policyFile,
      ownerSettings,
      brokerSettings,
      clientSettings,
      rules,
      members: members.map((membership, index) => ({ ...membership, user: users[index] })),
      primaryInsuranceContact,
      uploadedBy,
      connection,
      primarySlackChannel,
      agentChannels,
      fallbackUserId:
        policy?.uploadedByUserId ?? members[0]?.userId ?? brokerMembers[0]?.userId,
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
    slackSentAt: v.optional(v.number()),
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
    brokerOrgId: v.optional(v.id("organizations")),
    deliveryOwnerOrgId: v.optional(v.id("organizations")),
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

export const verifyDeliveryOwnerBackfill = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [settings, rules, jobs, attempts] = await Promise.all([
      ctx.db
        .query("policyDeliverySettings")
        .withIndex("by_deliveryOwnerOrgId_and_clientOrgId", (q) =>
          q.eq("deliveryOwnerOrgId", undefined),
        )
        .first(),
      ctx.db
        .query("policyDeliveryRules")
        .withIndex("by_deliveryOwnerOrgId_and_clientOrgId", (q) =>
          q.eq("deliveryOwnerOrgId", undefined),
        )
        .first(),
      ctx.db
        .query("policyDeliveryJobs")
        .withIndex("by_deliveryOwnerOrgId_and_status_and_updatedAt", (q) =>
          q.eq("deliveryOwnerOrgId", undefined),
        )
        .first(),
      ctx.db
        .query("policyDeliveryAttempts")
        .withIndex("by_deliveryOwnerOrgId_and_createdAt", (q) =>
          q.eq("deliveryOwnerOrgId", undefined),
        )
        .first(),
    ]);
    const missing = {
      settings: Number(Boolean(settings)),
      rules: Number(Boolean(rules)),
      jobs: Number(Boolean(jobs)),
      attempts: Number(Boolean(attempts)),
    };
    return {
      sampleIds: {
        settings: settings?._id,
        rules: rules?._id,
        jobs: jobs?._id,
        attempts: attempts?._id,
      },
      missing,
      complete: Object.values(missing).every((count) => count === 0),
    };
  },
});
