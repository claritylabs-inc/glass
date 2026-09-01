import dayjs from "dayjs";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { getOrgAccess } from "./lib/access";
import {
  assertImpersonatedSetupWrite,
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import {
  isCompanyContextMemory,
  normalizeMemoryContent,
  type OrgMemoryProvenance,
  type OrgMemoryType,
} from "./lib/orgMemoryPolicy";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

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
  v.literal("slack"),
  v.literal("manual"),
  v.literal("operator"),
  v.literal("mcp"),
);
const orgMemoryProvenanceValidator = v.object({
  kind: v.literal("organization_fact"),
  derivation: v.union(
    v.literal("company_profile_extraction"),
    v.literal("conversation_extraction"),
    v.literal("agent_tool"),
  ),
  schemaVersion: v.literal("organization-fact-v1"),
});

async function orgNameById(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
) {
  const org = await ctx.db.get(orgId);
  return org?.name ?? null;
}

async function requireClientMemoryOrganization(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
) {
  const organization = await ctx.db.get(orgId);
  if (!organization || organization.type !== "client") {
    throw new Error("Client organization not found");
  }
  return organization;
}

async function requireMemoryAdmin(
  ctx: QueryCtx | MutationCtx,
  memoryId: Id<"orgMemory">,
) {
  const memory = await ctx.db.get(memoryId);
  if (!memory) throw new Error("Memory item not found");

  const access = await getOrgAccess(ctx, memory.orgId);
  await assertImpersonatedSetupWrite(ctx, memory.orgId);
  if (access.accessType !== "member" || access.role !== "admin") {
    throwUserFacingError(
      userFacingErrorCodes.orgAdminRequired,
      "Only an organization admin can manage memory.",
    );
  }

  return {
    memory,
    orgName: await orgNameById(ctx, memory.orgId),
  };
}

async function requireDirectMemoryAdminForUser(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
) {
  const org = await ctx.db.get(orgId);
  if (!org) throw new Error("Organization not found");
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("organization_user", (q) =>
      q.eq("orgId", orgId).eq("userId", userId),
    )
    .first();
  if (!membership || membership.role !== "admin") {
    throwUserFacingError(
      userFacingErrorCodes.orgAdminRequired,
      "Only an organization admin can manage memory.",
    );
  }
  return org;
}

async function requireDirectOperatorMemoryWrite(
  ctx: MutationCtx,
  operatorUserId: Id<"users">,
) {
  await requireOperatorForUser(ctx, operatorUserId);
  const active = await ctx.db
    .query("operatorImpersonationSessions")
    .withIndex("operator_status", (q) =>
      q.eq("operatorUserId", operatorUserId).eq("status", "active"),
    )
    .first();
  if (active) {
    throwUserFacingError(userFacingErrorCodes.impersonationReadOnly);
  }
}

function activeCompanyFacts<
  T extends {
    type: OrgMemoryType;
    content: string;
    expiresAt?: number;
    policyId?: unknown;
    provenance?: OrgMemoryProvenance;
  },
>(memories: T[], orgName: string | null) {
  const now = dayjs().valueOf();
  return memories.filter(
    (memory) =>
      (!memory.expiresAt || memory.expiresAt > now) &&
      isCompanyContextMemory({
        type: memory.type,
        content: memory.content,
        orgName,
        policyId: memory.policyId,
        provenance: memory.provenance,
      }),
  );
}

function memoryContentKey(content: string) {
  return normalizeMemoryContent(content)
    .toLowerCase()
    .replace(/[.!?]+$/g, "");
}

async function findAndMergeDuplicate(
  ctx: MutationCtx,
  item: {
    orgId: Id<"organizations">;
    type: OrgMemoryType;
    content: string;
    sourceRef?: string;
    confidence?: number;
    observedAt?: number;
    provenance?: OrgMemoryProvenance;
  },
  now: number,
): Promise<Id<"orgMemory"> | null> {
  const sourceMatch = item.sourceRef
    ? await ctx.db
        .query("orgMemory")
        .withIndex("organization_source", (q) =>
          q.eq("orgId", item.orgId).eq("sourceRef", item.sourceRef),
        )
        .first()
    : null;
  let duplicate = sourceMatch;
  if (!duplicate) {
    const contentKey = memoryContentKey(item.content);
    const existing = await ctx.db
      .query("orgMemory")
      .withIndex("organization_type", (q) =>
        q.eq("orgId", item.orgId).eq("type", item.type),
      )
      .take(500);
    duplicate =
      existing.find(
        (memory) => memoryContentKey(memory.content) === contentKey,
      ) ?? null;
  }
  if (!duplicate) return null;
  await ctx.db.patch(duplicate._id, {
    confidence:
      item.confidence === undefined
        ? duplicate.confidence
        : Math.max(duplicate.confidence ?? 0, item.confidence),
    observedAt:
      item.observedAt === undefined
        ? duplicate.observedAt
        : Math.max(duplicate.observedAt ?? 0, item.observedAt),
    provenance: item.provenance ?? duplicate.provenance,
    updatedAt: now,
  });
  return duplicate._id;
}

async function createMemory(
  ctx: MutationCtx,
  args: {
    orgId: Id<"organizations">;
    content: string;
    source: "manual" | "operator" | "mcp";
    sourceRef?: string;
  },
) {
  const orgName = await orgNameById(ctx, args.orgId);
  const content = normalizeMemoryContent(args.content);
  const provenance: OrgMemoryProvenance = {
    kind: "organization_fact",
    derivation: "agent_tool",
    schemaVersion: "organization-fact-v1",
  };
  if (
    !isCompanyContextMemory({
      type: "fact",
      content,
      orgName,
    })
  ) {
    throw new Error("Memory must be a stable company fact");
  }
  const now = dayjs().valueOf();
  const duplicateId = await findAndMergeDuplicate(
    ctx,
    {
      orgId: args.orgId,
      type: "fact",
      content,
      sourceRef: args.sourceRef,
      provenance,
    },
    now,
  );
  if (duplicateId) {
    const duplicate = await ctx.db.get(duplicateId);
    if (!duplicate) throw new Error("Memory item not found");
    return duplicate;
  }
  const id = await ctx.db.insert("orgMemory", {
    orgId: args.orgId,
    type: "fact",
    content,
    source: args.source,
    sourceRef: args.sourceRef,
    provenance,
    createdAt: now,
    updatedAt: now,
  });
  const memory = await ctx.db.get(id);
  if (!memory) throw new Error("Memory item not found");
  return memory;
}

async function updateMemoryContent(
  ctx: MutationCtx,
  memory: Doc<"orgMemory">,
  contentValue: string,
  source: "manual" | "operator" | "mcp",
) {
  const orgName = await orgNameById(ctx, memory.orgId);
  const content = normalizeMemoryContent(contentValue);
  if (
    !isCompanyContextMemory({
      type: memory.type as OrgMemoryType,
      content,
      orgName,
      policyId: memory.policyId,
    })
  ) {
    throw new Error("Memory must be a stable company fact");
  }
  const updatedAt = dayjs().valueOf();
  await ctx.db.patch(memory._id, {
    content,
    source,
    sourceRef: undefined,
    provenance: undefined,
    updatedAt,
  });
  return {
    ...memory,
    content,
    source,
    sourceRef: undefined,
    provenance: undefined,
    updatedAt,
  };
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
      .withIndex("organization", (q) => q.eq("orgId", args.orgId))
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
      .withIndex("organization_type", (q) =>
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
    sourceRef: v.optional(v.string()),
    confidence: v.optional(v.number()),
    observedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    provenance: v.optional(orgMemoryProvenanceValidator),
  },
  handler: async (ctx, args) => {
    const orgName = await orgNameById(ctx, args.orgId);
    const content = normalizeMemoryContent(args.content);
    if (
      !isCompanyContextMemory({
        type: args.type,
        content,
        orgName,
        policyId: args.policyId,
        provenance: args.provenance,
      })
    ) {
      return null;
    }

    const now = dayjs().valueOf();
    const duplicateId = await findAndMergeDuplicate(
      ctx,
      { ...args, content },
      now,
    );
    if (duplicateId) return duplicateId;
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
          v.literal("slack"),
          v.literal("manual"),
          v.literal("operator"),
          v.literal("mcp"),
        ),
        policyId: v.optional(v.id("policies")),
        sourceRef: v.optional(v.string()),
        confidence: v.optional(v.number()),
        observedAt: v.optional(v.number()),
        provenance: v.optional(orgMemoryProvenanceValidator),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const inserted: Id<"orgMemory">[] = [];
    const orgNames = new Map<string, string | null>();
    for (const item of args.items) {
      const orgKey = String(item.orgId);
      let orgName = orgNames.get(orgKey);
      if (orgName === undefined) {
        orgName = await orgNameById(ctx, item.orgId);
        orgNames.set(orgKey, orgName);
      }
      const content = normalizeMemoryContent(item.content);
      if (
        !isCompanyContextMemory({
          type: item.type,
          content,
          orgName,
          policyId: item.policyId,
          provenance: item.provenance,
        })
      ) {
        continue;
      }
      const duplicateId = await findAndMergeDuplicate(
        ctx,
        { ...item, content },
        now,
      );
      if (duplicateId) continue;
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
      .withIndex("organization", (q) => q.eq("orgId", args.orgId))
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
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.orgId);
    if (access.accessType !== "member") {
      throwUserFacingError(
        userFacingErrorCodes.orgAccessRequired,
        "Company memory is available only to members of this organization.",
      );
    }
    const memories = await ctx.db
      .query("orgMemory")
      .withIndex("organization", (q) => q.eq("orgId", args.orgId))
      .take(500);
    const orgName = await orgNameById(ctx, args.orgId);
    return activeCompanyFacts(memories, orgName).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  },
});

export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.orgId);
    await assertImpersonatedSetupWrite(ctx, args.orgId);
    if (access.accessType !== "member" || access.role !== "admin") {
      throwUserFacingError(
        userFacingErrorCodes.orgAdminRequired,
        "Only an organization admin can manage memory.",
      );
    }
    return await createMemory(ctx, { ...args, source: "manual" });
  },
});

export const update = mutation({
  args: {
    id: v.id("orgMemory"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const { memory, orgName } = await requireMemoryAdmin(ctx, args.id);
    void orgName;
    return await updateMemoryContent(ctx, memory, args.content, "manual");
  },
});

export const listForOperator = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const org = await requireClientMemoryOrganization(ctx, args.orgId);
    const memories = await ctx.db
      .query("orgMemory")
      .withIndex("organization", (q) => q.eq("orgId", args.orgId))
      .take(500);
    return activeCompanyFacts(memories, org.name).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  },
});

export const createForOperator = mutation({
  args: { orgId: v.id("organizations"), content: v.string() },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireDirectOperatorMemoryWrite(ctx, operator.userId);
    await requireClientMemoryOrganization(ctx, args.orgId);
    const memory = await createMemory(ctx, { ...args, source: "operator" });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: args.orgId,
      summary: "Created company memory",
      metadata: {
        domain: "org_memory",
        operation: "create",
        memoryId: memory._id,
      },
    });
    return memory;
  },
});

export const updateForOperator = mutation({
  args: { id: v.id("orgMemory"), content: v.string() },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireDirectOperatorMemoryWrite(ctx, operator.userId);
    const memory = await ctx.db.get(args.id);
    if (!memory) throw new Error("Memory item not found");
    await requireClientMemoryOrganization(ctx, memory.orgId);
    const updated = await updateMemoryContent(
      ctx,
      memory,
      args.content,
      "operator",
    );
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: memory.orgId,
      summary: "Updated company memory",
      metadata: {
        domain: "org_memory",
        operation: "update",
        memoryId: args.id,
      },
    });
    return updated;
  },
});

export const removeForOperator = mutation({
  args: { id: v.id("orgMemory") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireDirectOperatorMemoryWrite(ctx, operator.userId);
    const memory = await ctx.db.get(args.id);
    if (!memory) throw new Error("Memory item not found");
    await requireClientMemoryOrganization(ctx, memory.orgId);
    await ctx.db.delete(args.id);
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: memory.orgId,
      summary: "Deleted company memory",
      metadata: {
        domain: "org_memory",
        operation: "delete",
        memoryId: args.id,
      },
    });
    return { deleted: true };
  },
});

export const listForMcp = internalQuery({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", args.orgId).eq("userId", args.userId),
      )
      .first();
    if (!membership) {
      throwUserFacingError(userFacingErrorCodes.orgAccessRequired);
    }
    const memories = await ctx.db
      .query("orgMemory")
      .withIndex("organization", (q) => q.eq("orgId", args.orgId))
      .take(500);
    const orgName = await orgNameById(ctx, args.orgId);
    const queryText = args.query?.trim().toLowerCase();
    return activeCompanyFacts(memories, orgName)
      .filter((memory) =>
        queryText ? memory.content.toLowerCase().includes(queryText) : true,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(1, Math.min(args.limit ?? 50, 100)));
  },
});

export const createForMcp = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await requireDirectMemoryAdminForUser(ctx, args.orgId, args.userId);
    return await createMemory(ctx, {
      orgId: args.orgId,
      content: args.content,
      source: "mcp",
      sourceRef: `mcp:${args.userId}:${dayjs().valueOf()}`,
    });
  },
});

export const updateForMcp = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    id: v.id("orgMemory"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await requireDirectMemoryAdminForUser(ctx, args.orgId, args.userId);
    const memory = await ctx.db.get(args.id);
    if (!memory || memory.orgId !== args.orgId)
      throw new Error("Memory item not found");
    return await updateMemoryContent(ctx, memory, args.content, "mcp");
  },
});

export const removeForMcp = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    id: v.id("orgMemory"),
  },
  handler: async (ctx, args) => {
    await requireDirectMemoryAdminForUser(ctx, args.orgId, args.userId);
    const memory = await ctx.db.get(args.id);
    if (!memory || memory.orgId !== args.orgId)
      throw new Error("Memory item not found");
    await ctx.db.delete(args.id);
    return { deleted: true };
  },
});

export async function createCompanyMemoryByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    orgId: Id<"organizations">;
    content: string;
    source: "operator" | "mcp";
  },
) {
  await requireDirectOperatorMemoryWrite(ctx, args.operatorUserId);
  await requireClientMemoryOrganization(ctx, args.orgId);
  const memory = await createMemory(ctx, args);
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: args.orgId,
    summary: "Created company memory",
    metadata: {
      domain: "org_memory",
      operation: "create",
      memoryId: memory._id,
    },
  });
  return memory;
}

export async function updateCompanyMemoryByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    id: Id<"orgMemory">;
    content: string;
    source: "operator" | "mcp";
  },
) {
  await requireDirectOperatorMemoryWrite(ctx, args.operatorUserId);
  const memory = await ctx.db.get(args.id);
  if (!memory) throw new Error("Memory item not found");
  await requireClientMemoryOrganization(ctx, memory.orgId);
  const updated = await updateMemoryContent(
    ctx,
    memory,
    args.content,
    args.source,
  );
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: memory.orgId,
    summary: "Updated company memory",
    metadata: { domain: "org_memory", operation: "update", memoryId: args.id },
  });
  return updated;
}

export async function deleteCompanyMemoryByOperator(
  ctx: MutationCtx,
  args: { operatorUserId: Id<"users">; id: Id<"orgMemory"> },
) {
  await requireDirectOperatorMemoryWrite(ctx, args.operatorUserId);
  const memory = await ctx.db.get(args.id);
  if (!memory) throw new Error("Memory item not found");
  await requireClientMemoryOrganization(ctx, memory.orgId);
  await ctx.db.delete(args.id);
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: memory.orgId,
    summary: "Deleted company memory",
    metadata: { domain: "org_memory", operation: "delete", memoryId: args.id },
  });
  return { deleted: true };
}

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
