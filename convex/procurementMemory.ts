import dayjs from "dayjs";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

export type ProcurementMemoryKind =
  | "placement_preference"
  | "broker_appetite"
  | "submission_requirement"
  | "market_observation";

export type ProcurementMemorySource =
  | "manual"
  | "operator_agent"
  | "mcp"
  | "email"
  | "procurement_outcome";

const procurementMemoryKindValidator = v.union(
  v.literal("placement_preference"),
  v.literal("broker_appetite"),
  v.literal("submission_requirement"),
  v.literal("market_observation"),
);

const MAX_MEMORY_LENGTH = 2_000;
const MAX_MEMORY_ROWS = 500;

function normalizeContent(value: string) {
  const content = value.trim().replace(/\s+/g, " ");
  if (!content) throw new Error("Procurement memory cannot be empty");
  if (content.length > MAX_MEMORY_LENGTH) {
    throw new Error(
      `Procurement memory must be ${MAX_MEMORY_LENGTH.toLocaleString()} characters or fewer`,
    );
  }
  return content;
}

function normalizeOptionalText(value: string | undefined, maximum = 500) {
  const normalized = value?.trim().replace(/\s+/g, " ");
  if (!normalized) return undefined;
  if (normalized.length > maximum) {
    throw new Error(
      `Value must be ${maximum.toLocaleString()} characters or fewer`,
    );
  }
  return normalized;
}

async function requireClient(
  ctx: QueryCtx | MutationCtx,
  clientOrgId: Id<"organizations">,
) {
  const client = await ctx.db.get(clientOrgId);
  if (!client || client.type !== "client") {
    throw new Error("Client organization not found");
  }
  return client;
}

async function requireDirectOperatorWrite(
  ctx: MutationCtx,
  operatorUserId: Id<"users">,
) {
  await requireOperatorForUser(ctx, operatorUserId);
  const active = await ctx.db
    .query("operatorImpersonationSessions")
    .withIndex("operator_status", (index) =>
      index.eq("operatorUserId", operatorUserId).eq("status", "active"),
    )
    .first();
  if (active) {
    throwUserFacingError(userFacingErrorCodes.impersonationReadOnly);
  }
}

async function validateLinks(
  ctx: QueryCtx | MutationCtx,
  args: {
    clientOrgId: Id<"organizations">;
    requestId?: Id<"procurementRequests">;
    outreachId?: Id<"procurementBrokerOutreaches">;
    brokerOrgId?: Id<"organizations">;
  },
) {
  await requireClient(ctx, args.clientOrgId);
  const [request, outreach, broker] = await Promise.all([
    args.requestId ? ctx.db.get(args.requestId) : null,
    args.outreachId ? ctx.db.get(args.outreachId) : null,
    args.brokerOrgId ? ctx.db.get(args.brokerOrgId) : null,
  ]);
  if (
    args.requestId &&
    (!request || request.clientOrgId !== args.clientOrgId)
  ) {
    throw new Error("Procurement request does not belong to this client");
  }
  if (
    args.outreachId &&
    (!outreach || outreach.clientOrgId !== args.clientOrgId)
  ) {
    throw new Error("Procurement outreach does not belong to this client");
  }
  if (request && outreach && outreach.requestId !== request._id) {
    throw new Error("Procurement outreach does not belong to this request");
  }
  if (args.brokerOrgId && (!broker || broker.type !== "broker")) {
    throw new Error("Broker organization not found");
  }
  if (
    outreach?.brokerOrgId &&
    args.brokerOrgId &&
    outreach.brokerOrgId !== args.brokerOrgId
  ) {
    throw new Error("Broker does not match the linked outreach");
  }
}

async function memoryView(
  ctx: QueryCtx | MutationCtx,
  memory: Doc<"procurementMemory">,
) {
  const [request, outreach, broker, creator, updater] = await Promise.all([
    memory.requestId ? ctx.db.get(memory.requestId) : null,
    memory.outreachId ? ctx.db.get(memory.outreachId) : null,
    memory.brokerOrgId ? ctx.db.get(memory.brokerOrgId) : null,
    ctx.db.get(memory.createdByUserId),
    ctx.db.get(memory.updatedByUserId),
  ]);
  return {
    ...memory,
    requestTitle: request?.title,
    outreachBrokerName: outreach?.brokerName,
    brokerName: broker?.name,
    createdByName: creator?.name ?? creator?.email,
    updatedByName: updater?.name ?? updater?.email,
  };
}

export async function listProcurementMemory(
  ctx: QueryCtx | MutationCtx,
  args: {
    clientOrgId: Id<"organizations">;
    requestId?: Id<"procurementRequests">;
    kind?: ProcurementMemoryKind;
    query?: string;
    limit?: number;
  },
) {
  await requireClient(ctx, args.clientOrgId);
  const rows = args.requestId
    ? await ctx.db
        .query("procurementMemory")
        .withIndex("request", (index) => index.eq("requestId", args.requestId))
        .order("desc")
        .take(MAX_MEMORY_ROWS)
    : await ctx.db
        .query("procurementMemory")
        .withIndex("client", (index) =>
          index.eq("clientOrgId", args.clientOrgId),
        )
        .order("desc")
        .take(MAX_MEMORY_ROWS);
  const search = args.query?.trim().toLowerCase();
  const limit = Math.max(1, Math.min(args.limit ?? 100, 100));
  const filtered = rows
    .filter((row) => row.clientOrgId === args.clientOrgId)
    .filter((row) => (args.kind ? row.kind === args.kind : true))
    .filter((row) =>
      search ? row.content.toLowerCase().includes(search) : true,
    )
    .slice(0, limit);
  return await Promise.all(filtered.map((row) => memoryView(ctx, row)));
}

async function createMemory(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    clientOrgId: Id<"organizations">;
    kind: ProcurementMemoryKind;
    content: string;
    source: ProcurementMemorySource;
    requestId?: Id<"procurementRequests">;
    outreachId?: Id<"procurementBrokerOutreaches">;
    brokerOrgId?: Id<"organizations">;
    sourceRef?: string;
    confidence?: number;
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  await validateLinks(ctx, args);
  if (
    args.confidence !== undefined &&
    (args.confidence < 0 || args.confidence > 1)
  ) {
    throw new Error("Confidence must be between 0 and 1");
  }
  const content = normalizeContent(args.content);
  const sourceRef = normalizeOptionalText(args.sourceRef);
  const duplicate = sourceRef
    ? await ctx.db
        .query("procurementMemory")
        .withIndex("source", (index) =>
          index.eq("clientOrgId", args.clientOrgId).eq("sourceRef", sourceRef),
        )
        .first()
    : null;
  if (duplicate) return await memoryView(ctx, duplicate);

  const now = dayjs().valueOf();
  const id = await ctx.db.insert("procurementMemory", {
    clientOrgId: args.clientOrgId,
    kind: args.kind,
    content,
    source: args.source,
    requestId: args.requestId,
    outreachId: args.outreachId,
    brokerOrgId: args.brokerOrgId,
    sourceRef,
    confidence: args.confidence,
    createdByUserId: args.operatorUserId,
    updatedByUserId: args.operatorUserId,
    createdAt: now,
    updatedAt: now,
  });
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: args.clientOrgId,
    summary: "Created procurement memory",
    metadata: {
      domain: "procurement_memory",
      operation: "create",
      procurementMemoryId: id,
    },
  });
  const memory = await ctx.db.get(id);
  if (!memory) throw new Error("Procurement memory not found");
  return await memoryView(ctx, memory);
}

async function updateMemory(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    id: Id<"procurementMemory">;
    kind?: ProcurementMemoryKind;
    content?: string;
    requestId?: Id<"procurementRequests"> | null;
    outreachId?: Id<"procurementBrokerOutreaches"> | null;
    brokerOrgId?: Id<"organizations"> | null;
    confidence?: number | null;
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const memory = await ctx.db.get(args.id);
  if (!memory) throw new Error("Procurement memory not found");
  const links = {
    clientOrgId: memory.clientOrgId,
    requestId:
      args.requestId === undefined
        ? memory.requestId
        : (args.requestId ?? undefined),
    outreachId:
      args.outreachId === undefined
        ? memory.outreachId
        : (args.outreachId ?? undefined),
    brokerOrgId:
      args.brokerOrgId === undefined
        ? memory.brokerOrgId
        : (args.brokerOrgId ?? undefined),
  };
  await validateLinks(ctx, links);
  if (
    args.confidence !== undefined &&
    args.confidence !== null &&
    (args.confidence < 0 || args.confidence > 1)
  ) {
    throw new Error("Confidence must be between 0 and 1");
  }
  const updatedAt = dayjs().valueOf();
  await ctx.db.patch(args.id, {
    kind: args.kind ?? memory.kind,
    content:
      args.content === undefined
        ? memory.content
        : normalizeContent(args.content),
    requestId: links.requestId,
    outreachId: links.outreachId,
    brokerOrgId: links.brokerOrgId,
    confidence:
      args.confidence === undefined
        ? memory.confidence
        : (args.confidence ?? undefined),
    updatedByUserId: args.operatorUserId,
    updatedAt,
  });
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: memory.clientOrgId,
    summary: "Updated procurement memory",
    metadata: {
      domain: "procurement_memory",
      operation: "update",
      procurementMemoryId: args.id,
    },
  });
  const updated = await ctx.db.get(args.id);
  if (!updated) throw new Error("Procurement memory not found");
  return await memoryView(ctx, updated);
}

async function deleteMemory(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    id: Id<"procurementMemory">;
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const memory = await ctx.db.get(args.id);
  if (!memory) throw new Error("Procurement memory not found");
  await ctx.db.delete(args.id);
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: memory.clientOrgId,
    summary: "Deleted procurement memory",
    metadata: {
      domain: "procurement_memory",
      operation: "delete",
      procurementMemoryId: args.id,
    },
  });
  return { deleted: true };
}

export const list = query({
  args: {
    clientOrgId: v.id("organizations"),
    requestId: v.optional(v.id("procurementRequests")),
    kind: v.optional(procurementMemoryKindValidator),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return await listProcurementMemory(ctx, args);
  },
});

export const create = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    kind: procurementMemoryKindValidator,
    content: v.string(),
    requestId: v.optional(v.id("procurementRequests")),
    outreachId: v.optional(v.id("procurementBrokerOutreaches")),
    brokerOrgId: v.optional(v.id("organizations")),
    sourceRef: v.optional(v.string()),
    confidence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await createMemory(ctx, {
      ...args,
      operatorUserId: operator.userId,
      source: "manual",
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("procurementMemory"),
    kind: v.optional(procurementMemoryKindValidator),
    content: v.optional(v.string()),
    requestId: v.optional(v.union(v.id("procurementRequests"), v.null())),
    outreachId: v.optional(
      v.union(v.id("procurementBrokerOutreaches"), v.null()),
    ),
    brokerOrgId: v.optional(v.union(v.id("organizations"), v.null())),
    confidence: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await updateMemory(ctx, {
      ...args,
      operatorUserId: operator.userId,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("procurementMemory") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await deleteMemory(ctx, {
      ...args,
      operatorUserId: operator.userId,
    });
  },
});

export const createProcurementMemoryByOperator = createMemory;
export const updateProcurementMemoryByOperator = updateMemory;
export const deleteProcurementMemoryByOperator = deleteMemory;
