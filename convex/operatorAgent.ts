import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  internalAction,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { actionConfirmationFingerprint } from "./lib/actionConfirmationFingerprint";
import {
  MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES,
  MAX_AGENT_ATTACHMENT_BYTES,
  MAX_AGENT_ATTACHMENT_FILES,
  normalizeAgentAttachmentContentType,
  normalizeAgentAttachmentFilename,
} from "./lib/agentAttachmentLimits";
import {
  assertFeatureFlagAllowedForOrg,
  setFeatureFlagPatch,
} from "./lib/featureFlags";
import {
  getOperatorAgentToolSpec,
  operatorAgentToolJsonCatalog,
  parseOperatorAgentToolInput,
  type OperatorAgentToolName,
  type OperatorToolRole,
} from "./lib/operatorAgentToolRegistry";
import { buildOperatorRunCheckpointSummary } from "./lib/operatorAgentContinuation";
import {
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";

const operatorChannelValidator = v.union(
  v.literal("chat"),
  v.literal("slack"),
  v.literal("imessage"),
  v.literal("mcp"),
);

const operatorAttachmentValidator = v.object({
  fileId: v.id("_storage"),
  filename: v.string(),
  contentType: v.string(),
  size: v.number(),
  uploadIntentId: v.optional(v.id("operatorAgentUploadIntents")),
});

const pageContextValidator = v.object({
  pageType: v.string(),
  entityId: v.optional(v.string()),
  summary: v.optional(v.string()),
});

const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "running",
  "waiting_confirmation",
]);
const MAX_OPERATOR_MESSAGE_CHARS = 20_000;
const MAX_OPERATOR_CONVERSATION_KEY_CHARS = 500;
const MAX_OPERATOR_DEDUPE_KEY_CHARS = 500;

type OperatorChannel = "chat" | "slack" | "imessage" | "mcp";

type OperatorAttachment = {
  fileId: Id<"_storage">;
  filename: string;
  contentType: string;
  size: number;
  uploadIntentId?: Id<"operatorAgentUploadIntents">;
};

type ExecuteToolArgs = {
  operatorUserId: Id<"users">;
  runId: Id<"operatorAgentRuns">;
  threadId: Id<"operatorAgentThreads">;
  threadMessageId: Id<"operatorAgentMessages">;
  toolName: string;
  input: unknown;
  inputHash: string;
  idempotencyKey: string;
  channel: OperatorChannel;
  confirmationId?: Id<"operatorAgentConfirmations">;
};

type DirectToolInvocation = {
  threadId: Id<"operatorAgentThreads">;
  runId: Id<"operatorAgentRuns">;
  userMessageId: Id<"operatorAgentMessages">;
  agentMessageId: Id<"operatorAgentMessages">;
  duplicate: boolean;
};

type DirectToolOutcome =
  | {
      status: "confirmation_required";
      confirmationId?: Id<"operatorAgentConfirmations">;
      summary: string;
    }
  | {
      status: "succeeded";
      result: unknown;
      idempotent: boolean;
    }
  | { status: "failed"; error: string };

function boundedJson(value: unknown, maximum = 8_000) {
  try {
    return JSON.stringify(value).slice(0, maximum);
  } catch {
    return String(value).slice(0, maximum);
  }
}

async function validateOperatorAttachments(
  ctx: MutationCtx,
  operatorUserId: Id<"users">,
  attachments: OperatorAttachment[] | undefined,
  options: { requireUploadIntent?: boolean } = {},
): Promise<OperatorAttachment[] | undefined> {
  if (!attachments?.length) return undefined;
  if (attachments.length > MAX_AGENT_ATTACHMENT_FILES) {
    throw new Error(
      `Operator messages support at most ${MAX_AGENT_ATTACHMENT_FILES} files`,
    );
  }

  const seen = new Set<string>();
  const normalized: OperatorAttachment[] = [];
  let aggregateSize = 0;
  for (const attachment of attachments) {
    const fileKey = String(attachment.fileId);
    if (seen.has(fileKey)) throw new Error("Duplicate operator attachment");
    seen.add(fileKey);
    const existingReference = await ctx.db
      .query("operatorAgentAttachments")
      .withIndex("file", (index) => index.eq("fileId", attachment.fileId))
      .first();
    if (
      existingReference &&
      existingReference.operatorUserId !== operatorUserId
    ) {
      throw new Error("Operator attachment belongs to another operator");
    }
    const uploadIntent = attachment.uploadIntentId
      ? await ctx.db.get(attachment.uploadIntentId)
      : null;
    if (options.requireUploadIntent || attachment.uploadIntentId) {
      if (
        !uploadIntent ||
        uploadIntent.operatorUserId !== operatorUserId ||
        uploadIntent.expiresAt <= dayjs().valueOf() ||
        uploadIntent.fileId !== attachment.fileId
      ) {
        throw new Error(
          "Operator attachment upload intent is invalid or expired",
        );
      }
    }
    const metadata = await ctx.db.system.get("_storage", attachment.fileId);
    if (!metadata) throw new Error("Operator attachment was not uploaded");
    if (metadata.size > MAX_AGENT_ATTACHMENT_BYTES) {
      throw new Error(
        `${attachment.filename || "Attachment"} exceeds the 25 MB file limit`,
      );
    }
    aggregateSize += metadata.size;
    if (aggregateSize > MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES) {
      throw new Error("Operator attachments exceed the 50 MB message limit");
    }
    const filename = normalizeAgentAttachmentFilename(attachment.filename);
    if (uploadIntent) {
      await ctx.db.delete(uploadIntent._id);
    }
    normalized.push({
      fileId: attachment.fileId,
      filename,
      contentType: normalizeAgentAttachmentContentType(
        attachment.contentType,
        metadata.contentType || "application/octet-stream",
      ),
      size: metadata.size,
    });
  }
  return normalized;
}

function parseStoredOutput(value: string | undefined) {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function assertOperatorRole(
  actual: OperatorToolRole,
  required: OperatorToolRole,
) {
  if (required === "owner" && actual !== "owner") {
    throw new Error("This operator action requires an owner");
  }
}

function normalizedOptionalText(value: unknown) {
  if (value === null) return undefined;
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

function normalizeOperatorPageContext(
  context:
    | { pageType: string; entityId?: string; summary?: string }
    | undefined,
) {
  if (!context) return undefined;
  const pageType = context.pageType.trim();
  const entityId = context.entityId?.trim() || undefined;
  const summary = context.summary?.trim() || undefined;
  if (!pageType || pageType.length > 100) {
    throw new Error("Operator page type must be 1–100 characters");
  }
  if (entityId && entityId.length > 200) {
    throw new Error("Operator page entity ID must be at most 200 characters");
  }
  if (summary && summary.length > 500) {
    throw new Error("Operator page summary must be at most 500 characters");
  }
  return {
    pageType,
    ...(entityId ? { entityId } : {}),
    ...(summary ? { summary } : {}),
  };
}

function normalizeOperatorConversationKey(value: string) {
  const conversationKey = value.trim();
  if (!conversationKey) throw new Error("Conversation key is required");
  if (conversationKey.length > MAX_OPERATOR_CONVERSATION_KEY_CHARS) {
    throw new Error("Conversation key is too long");
  }
  return conversationKey;
}

function normalizeOperatorThreadTitle(value: string | undefined) {
  return value?.trim().replace(/\s+/g, " ").slice(0, 200) || "New chat";
}

function normalizeOrganizationId(ctx: QueryCtx | MutationCtx, value: unknown) {
  if (typeof value !== "string") throw new Error("Organization ID is required");
  const orgId = ctx.db.normalizeId("organizations", value);
  if (!orgId) throw new Error("Invalid organization ID");
  return orgId;
}

function normalizePolicyId(ctx: QueryCtx | MutationCtx, value: unknown) {
  if (typeof value !== "string") throw new Error("Policy ID is required");
  const policyId = ctx.db.normalizeId("policies", value);
  if (!policyId) throw new Error("Invalid policy ID");
  return policyId;
}

async function requireOperatorThread(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"operatorAgentThreads">,
  operatorUserId: Id<"users">,
  options: { allowShared?: boolean } = {},
) {
  const thread = await ctx.db.get(threadId);
  if (
    !thread ||
    (!options.allowShared && thread.ownerUserId !== operatorUserId) ||
    (options.allowShared &&
      thread.ownerUserId !== operatorUserId &&
      thread.visibility !== "shared")
  ) {
    throw new Error("Operator thread not found");
  }
  return thread;
}

async function insertOperatorThread(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    channel: OperatorChannel;
    title?: string;
    initialContext?: {
      pageType: string;
      entityId?: string;
      summary?: string;
    };
    conversationKey?: string;
    visibility?: "private" | "shared";
  },
) {
  const now = dayjs().valueOf();
  const initialContext = normalizeOperatorPageContext(args.initialContext);
  return ctx.db.insert("operatorAgentThreads", {
    ownerUserId: args.operatorUserId,
    visibility: args.visibility ?? "private",
    conversationKey: args.conversationKey,
    title: normalizeOperatorThreadTitle(args.title),
    lastMessageAt: now,
    channel: args.channel,
    initialContext,
    createdAt: now,
    updatedAt: now,
  });
}

async function cancelActiveRunsForThread(
  ctx: MutationCtx,
  threadId: Id<"operatorAgentThreads">,
  reason: string,
) {
  const runs = (
    await Promise.all(
      (["queued", "running", "waiting_confirmation"] as const).map((status) =>
        ctx.db
          .query("operatorAgentRuns")
          .withIndex("thread_status", (index) =>
            index.eq("threadId", threadId).eq("status", status),
          )
          .take(25),
      ),
    )
  ).flat();
  const now = dayjs().valueOf();
  for (const run of runs) {
    await ctx.db.patch(run._id, {
      status: "cancelled",
      cancellationRequestedAt: now,
      completedAt: now,
      lastError: reason,
      updatedAt: now,
    });
    const message = await ctx.db.get(run.agentMessageId);
    if (message?.status === "processing") {
      await ctx.db.patch(message._id, {
        content: "Response cancelled.",
        status: "cancelled",
        updatedAt: now,
      });
    }
    const ledgerRows = await ctx.db
      .query("agentActionAuditEvents")
      .withIndex("run_created", (index) => index.eq("runId", run._id))
      .take(100);
    await Promise.all(
      ledgerRows
        .filter(
          (ledger) =>
            ledger.status === "pending" ||
            ledger.status === "awaiting_confirmation",
        )
        .map((ledger) =>
          ctx.db.patch(ledger._id, { status: "cancelled", updatedAt: now }),
        ),
    );
  }
  return runs.length;
}

async function invalidatePendingOperatorConfirmations(
  ctx: MutationCtx,
  threadId: Id<"operatorAgentThreads">,
  reason: string,
) {
  const pending = await ctx.db
    .query("operatorAgentConfirmations")
    .withIndex("thread_status", (index) =>
      index.eq("threadId", threadId).eq("status", "pending"),
    )
    .take(100);
  const now = dayjs().valueOf();
  await Promise.all(
    pending.map((confirmation) =>
      ctx.db.patch(confirmation._id, {
        status: "stale",
        invalidatedAt: now,
        invalidationReason: reason,
        updatedAt: now,
      }),
    ),
  );
}

async function enqueueOperatorMessage(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    threadId: Id<"operatorAgentThreads">;
    channel: OperatorChannel;
    content: string;
    dedupeKey?: string;
    attachments?: OperatorAttachment[];
    pageContext?: {
      pageType: string;
      entityId?: string;
      summary?: string;
    };
    requireUploadIntent?: boolean;
  },
) {
  const thread = await requireOperatorThread(
    ctx,
    args.threadId,
    args.operatorUserId,
    { allowShared: true },
  );
  const content = args.content.trim();
  if (!content) throw new Error("Message content is required");
  if (content.length > MAX_OPERATOR_MESSAGE_CHARS) {
    throw new Error(
      `Operator messages must be at most ${MAX_OPERATOR_MESSAGE_CHARS.toLocaleString()} characters`,
    );
  }
  if (args.dedupeKey && args.dedupeKey.length > MAX_OPERATOR_DEDUPE_KEY_CHARS) {
    throw new Error("Operator message dedupe key is too long");
  }
  const pageContext = normalizeOperatorPageContext(args.pageContext);

  if (args.dedupeKey) {
    const existing = await ctx.db
      .query("operatorAgentMessages")
      .withIndex("thread_dedupe", (index) =>
        index.eq("threadId", args.threadId).eq("dedupeKey", args.dedupeKey),
      )
      .unique();
    if (existing?.role === "user") {
      const run = await ctx.db
        .query("operatorAgentRuns")
        .withIndex("message", (index) =>
          index.eq("userMessageId", existing._id),
        )
        .unique();
      if (run) {
        return { messageId: existing._id, runId: run._id, duplicate: true };
      }
    }
  }

  const attachments = await validateOperatorAttachments(
    ctx,
    args.operatorUserId,
    args.attachments,
    { requireUploadIntent: args.requireUploadIntent },
  );

  await cancelActiveRunsForThread(ctx, args.threadId, "superseded");
  await invalidatePendingOperatorConfirmations(
    ctx,
    args.threadId,
    "superseded",
  );

  const now = dayjs().valueOf();
  const operator = await ctx.db.get(args.operatorUserId);
  const userMessageId = await ctx.db.insert("operatorAgentMessages", {
    threadId: args.threadId,
    ownerUserId: args.operatorUserId,
    dedupeKey: args.dedupeKey,
    channel: args.channel,
    role: "user",
    userId: args.operatorUserId,
    userName: operator?.name ?? operator?.email ?? "Operator",
    content,
    attachments,
    createdAt: now,
    updatedAt: now,
  });
  await Promise.all(
    (attachments ?? []).map((attachment) =>
      ctx.db.insert("operatorAgentAttachments", {
        ...attachment,
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        messageId: userMessageId,
        createdAt: now,
      }),
    ),
  );
  const agentMessageId = await ctx.db.insert("operatorAgentMessages", {
    threadId: args.threadId,
    ownerUserId: args.operatorUserId,
    channel: args.channel,
    role: "agent",
    replyToMessageId: userMessageId,
    content: "",
    status: "processing",
    agentRunStartedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const runId = await ctx.db.insert("operatorAgentRuns", {
    threadId: args.threadId,
    operatorUserId: args.operatorUserId,
    userMessageId,
    agentMessageId,
    executionKind: "goal",
    objective: content,
    status: "queued",
    checkpoint: { iteration: 0, executionCount: 0 },
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(args.threadId, {
    lastMessageAt: now,
    updatedAt: now,
    ...(pageContext ? { initialContext: pageContext } : {}),
    ...(thread.title === "New chat"
      ? { title: normalizeOperatorThreadTitle(content).slice(0, 80) }
      : {}),
  });
  await ctx.scheduler.runAfter(0, internal.operatorAgentRunner.run, { runId });
  return { messageId: userMessageId, runId, duplicate: false };
}

async function executeToolDomain(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    toolName: OperatorAgentToolName;
    input: Record<string, unknown>;
  },
) {
  const { toolName, input } = args;
  if (toolName === "search_organizations") {
    const queryText =
      typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
    const requestedType =
      input.type === "broker" || input.type === "client"
        ? input.type
        : undefined;
    const limit = typeof input.limit === "number" ? input.limit : 15;
    const organizations = requestedType
      ? await ctx.db
          .query("organizations")
          .withIndex("type", (index) => index.eq("type", requestedType))
          .take(500)
      : await ctx.db.query("organizations").take(500);
    return organizations
      .filter((organization) => {
        if (!queryText) return true;
        return [
          organization.name,
          organization.slug,
          organization.website,
          organization.primaryContactEmail,
        ].some((value) =>
          String(value ?? "")
            .toLowerCase()
            .includes(queryText),
        );
      })
      .slice(0, limit)
      .map((organization) => ({
        orgId: organization._id,
        name: organization.name,
        type: organization.type ?? "client",
        status: organization.operatorStatus ?? "live",
        slug: organization.slug,
        website: organization.website,
        brokerOrgId: organization.brokerOrgId,
      }));
  }

  if (toolName === "get_organization") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const organization = await ctx.db.get(orgId);
    if (!organization) throw new Error("Organization not found");
    const [memberships, policies] = await Promise.all([
      ctx.db
        .query("orgMemberships")
        .withIndex("organization", (index) => index.eq("orgId", orgId))
        .take(5_001),
      ctx.db
        .query("policies")
        .withIndex("organization", (index) => index.eq("orgId", orgId))
        .take(5_001),
    ]);
    return {
      orgId,
      name: organization.name,
      type: organization.type ?? "client",
      status: organization.operatorStatus ?? "live",
      slug: organization.slug,
      website: organization.website,
      industry: organization.industry,
      industryVertical: organization.industryVertical,
      brokerOrgId: organization.brokerOrgId,
      featureFlags: organization.featureFlags,
      onboardingComplete: organization.onboardingComplete,
      memberCount: Math.min(memberships.length, 5_000),
      policyCount: policies
        .slice(0, 5_000)
        .filter((policy) => !policy.deletedAt).length,
      archivedPolicyCount: policies
        .slice(0, 5_000)
        .filter((policy) => policy.deletedAt).length,
      countsAreLowerBounds:
        memberships.length > 5_000 || policies.length > 5_000,
    };
  }

  if (toolName === "get_operator_overview") {
    const [organizations, policies, extractionRuns, agentRuns] =
      await Promise.all([
        ctx.db.query("organizations").take(2_000),
        ctx.db.query("policies").take(5_000),
        ctx.db.query("policyExtractionRuns").take(5_000),
        ctx.db.query("operatorAgentRuns").take(2_000),
      ]);
    return {
      organizations: {
        total: organizations.length,
        brokers: organizations.filter((org) => org.type === "broker").length,
        clients: organizations.filter((org) => org.type !== "broker").length,
      },
      policies: {
        active: policies.filter((policy) => !policy.deletedAt).length,
        archived: policies.filter((policy) => policy.deletedAt).length,
      },
      extractions: {
        running: extractionRuns.filter(
          (run) => run.pipelineStatus === "running",
        ).length,
        paused: extractionRuns.filter((run) => run.pipelineStatus === "paused")
          .length,
        failed: extractionRuns.filter((run) => run.pipelineStatus === "error")
          .length,
      },
      operatorAgent: {
        active: agentRuns.filter((run) => ACTIVE_RUN_STATUSES.has(run.status))
          .length,
        failed: agentRuns.filter((run) => run.status === "failed").length,
      },
      bounded: {
        organizations: organizations.length === 2_000,
        policies: policies.length === 5_000,
        extractionRuns: extractionRuns.length === 5_000,
        operatorAgentRuns: agentRuns.length === 2_000,
      },
    };
  }

  if (toolName === "list_policies") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const organization = await ctx.db.get(orgId);
    if (!organization) throw new Error("Organization not found");
    const queryText =
      typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
    const limit = typeof input.limit === "number" ? input.limit : 15;
    const includeArchived = input.includeArchived === true;
    const policies = await ctx.db
      .query("policies")
      .withIndex("organization", (index) => index.eq("orgId", orgId))
      .take(2_000);
    return policies
      .filter((policy) => includeArchived || !policy.deletedAt)
      .filter((policy) => {
        if (!queryText) return true;
        return [
          policy.policyNumber,
          policy.carrier,
          policy.security,
          policy.insuredName,
          policy.fileName,
          policy.summary,
        ].some((value) =>
          String(value ?? "")
            .toLowerCase()
            .includes(queryText),
        );
      })
      .slice(0, limit)
      .map((policy) => ({
        policyId: policy._id,
        policyNumber: policy.policyNumber,
        carrier: policy.carrier,
        insuredName: policy.insuredName,
        effectiveDate: policy.effectiveDate,
        expirationDate: policy.expirationDate,
        linesOfBusiness: policy.linesOfBusiness,
        extractionDataStage: policy.extractionDataStage,
        pipelineStatus: policy.pipelineStatus,
        archived: Boolean(policy.deletedAt),
      }));
  }

  if (toolName === "get_policy_status") {
    const policyId = normalizePolicyId(ctx, input.policyId);
    const policy = await ctx.db.get(policyId);
    if (!policy) throw new Error("Policy not found");
    const extractionRun = await ctx.db
      .query("policyExtractionRuns")
      .withIndex("policy", (index) => index.eq("policyId", policyId))
      .order("desc")
      .first();
    return {
      policyId,
      orgId: policy.orgId,
      policyNumber: policy.policyNumber,
      carrier: policy.carrier,
      extractionDataStage: policy.extractionDataStage,
      pipelineStatus: extractionRun?.pipelineStatus ?? policy.pipelineStatus,
      pipelineError: extractionRun?.pipelineError ?? policy.pipelineError,
      sourceTreeStatus: policy.sourceTreeStatus,
      reconciliationStatus: policy.reconciliationStatus,
      archived: Boolean(policy.deletedAt),
      fileName: policy.fileName,
    };
  }

  if (toolName === "list_extraction_issues") {
    const orgId = input.orgId
      ? normalizeOrganizationId(ctx, input.orgId)
      : undefined;
    if (orgId && !(await ctx.db.get(orgId))) {
      throw new Error("Organization not found");
    }
    const requestedStatus =
      input.status === "error" ||
      input.status === "paused" ||
      input.status === "running" ||
      input.status === "queued" ||
      input.status === "leased"
        ? input.status
        : undefined;
    const limit = typeof input.limit === "number" ? input.limit : 15;
    const queueStatus =
      requestedStatus === "queued" || requestedStatus === "leased"
        ? requestedStatus
        : undefined;
    const pipelineStatuses: Array<"error" | "paused" | "running"> =
      requestedStatus === "error" ||
      requestedStatus === "paused" ||
      requestedStatus === "running"
        ? [requestedStatus]
        : requestedStatus
          ? []
          : ["error", "paused"];
    const candidateLimit = Math.min(100, limit * 5);
    const [pipelineRuns, queueRows] = await Promise.all([
      Promise.all(
        pipelineStatuses.map((status) =>
          ctx.db
            .query("policyExtractionRuns")
            .withIndex("status_updated", (index) =>
              index.eq("pipelineStatus", status),
            )
            .order("desc")
            .take(candidateLimit),
        ),
      ),
      queueStatus
        ? ctx.db
            .query("policyExtractionQueue")
            .withIndex("status_updated", (index) =>
              index.eq("status", queueStatus),
            )
            .order("desc")
            .take(candidateLimit)
        : requestedStatus
          ? Promise.resolve([])
          : Promise.all([
              ctx.db
                .query("policyExtractionQueue")
                .withIndex("status_updated", (index) =>
                  index.eq("status", "queued"),
                )
                .order("desc")
                .take(candidateLimit),
              ctx.db
                .query("policyExtractionQueue")
                .withIndex("status_updated", (index) =>
                  index.eq("status", "leased"),
                )
                .order("desc")
                .take(candidateLimit),
            ]).then((rows) => rows.flat()),
    ]);
    const candidates = [
      ...pipelineRuns.flat().map((run) => ({
        policyId: run.policyId,
        runId: run._id,
        status: run.pipelineStatus,
        error: run.pipelineError,
        updatedAt: run.updatedAt,
        queue: undefined as
          | undefined
          | { status: string; leaseExpiresAt?: number },
      })),
      ...queueRows.map((row) => ({
        policyId: row.policyId,
        runId: row.runId,
        status: row.status,
        error: undefined,
        updatedAt: row.updatedAt,
        queue: { status: row.status, leaseExpiresAt: row.leaseExpiresAt },
      })),
    ].sort((left, right) => right.updatedAt - left.updatedAt);
    const results = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (results.length >= limit) break;
      if (seen.has(String(candidate.policyId))) continue;
      const policy = await ctx.db.get(candidate.policyId);
      if (!policy || (orgId && policy.orgId !== orgId)) continue;
      seen.add(String(candidate.policyId));
      const organization = policy.orgId ? await ctx.db.get(policy.orgId) : null;
      results.push({
        policyId: policy._id,
        runId: candidate.runId,
        orgId: policy.orgId,
        orgName: organization?.name,
        policyNumber: policy.policyNumber,
        carrier: policy.carrier,
        fileName: policy.fileName,
        status: candidate.status,
        error: candidate.error,
        queue: candidate.queue,
        updatedAt: candidate.updatedAt,
      });
    }
    return { issues: results, bounded: candidates.length > results.length };
  }

  if (toolName === "get_routing_status") {
    const task = typeof input.task === "string" ? input.task.trim() : undefined;
    const limit = typeof input.limit === "number" ? input.limit : 50;
    const events = task
      ? await ctx.db
          .query("modelRoutingEvents")
          .withIndex("task_time", (index) => index.eq("task", task))
          .order("desc")
          .take(limit)
      : await ctx.db
          .query("modelRoutingEvents")
          .withIndex("time")
          .order("desc")
          .take(limit);
    const settings = await ctx.db
      .query("globalModelSettings")
      .withIndex("key", (index) => index.eq("key", "default"))
      .unique();
    const counts = {
      complete: events.filter((event) => event.status === "complete").length,
      incomplete: events.filter((event) => event.status === "incomplete")
        .length,
      error: events.filter((event) => event.status === "error").length,
      fallback: events.filter(
        (event) =>
          event.kind === "direct_fallback" || event.status === "fallback",
      ).length,
    };
    return {
      task,
      counts,
      configuredRoutes: Object.keys(settings?.routes ?? {}),
      settingsUpdatedAt: settings?.updatedAt,
      recentIssues: events
        .filter(
          (event) =>
            event.status === "error" ||
            event.status === "incomplete" ||
            event.status === "fallback" ||
            event.kind === "direct_fallback",
        )
        .slice(0, 20)
        .map((event) => ({
          eventId: event._id,
          timestamp: event.timestamp,
          task: event.task,
          phase: event.phase,
          status: event.status,
          provider: event.provider,
          model: event.model,
          transport: event.transport,
          fallbackReason: event.fallbackReason,
          routerCode: event.routerCode,
          error: event.error,
        })),
      sampled: events.length,
    };
  }

  if (toolName === "get_channel_health") {
    const orgId = input.orgId
      ? normalizeOrganizationId(ctx, input.orgId)
      : undefined;
    if (orgId && !(await ctx.db.get(orgId))) {
      throw new Error("Organization not found");
    }
    const [settings, connections, bindings, emailAccounts, hostInstalls] =
      await Promise.all([
        orgId
          ? ctx.db
              .query("agentChannelSettings")
              .withIndex("client", (index) => index.eq("clientOrgId", orgId))
              .first()
          : Promise.resolve(null),
        orgId
          ? ctx.db
              .query("slackWorkspaceConnections")
              .withIndex("client_status", (index) =>
                index.eq("clientOrgId", orgId),
              )
              .take(25)
          : ctx.db.query("slackWorkspaceConnections").take(250),
        orgId
          ? ctx.db
              .query("slackChannelBindings")
              .withIndex("client_status", (index) =>
                index.eq("clientOrgId", orgId),
              )
              .take(25)
          : ctx.db.query("slackChannelBindings").take(250),
        orgId
          ? ctx.db
              .query("connectedEmailAccounts")
              .withIndex("organization", (index) => index.eq("orgId", orgId))
              .take(25)
          : ctx.db.query("connectedEmailAccounts").take(250),
        orgId
          ? Promise.resolve([])
          : ctx.db.query("slackInstallations").take(25),
      ]);
    return {
      orgId,
      settings: settings
        ? {
            emailEnabled: settings.emailEnabled,
            imessageEnabled: settings.imessageEnabled,
            slackEnabled: settings.slackEnabled,
            updatedAt: settings.updatedAt,
          }
        : undefined,
      slack: {
        connections: connections.map((connection) => ({
          connectionId: connection._id,
          clientOrgId: connection.clientOrgId,
          teamName: connection.teamName,
          status: connection.status,
          healthStatus: connection.healthStatus,
          healthReason: connection.healthReason,
          lastVerifiedAt: connection.lastVerifiedAt,
        })),
        bindings: bindings.map((binding) => ({
          bindingId: binding._id,
          clientOrgId: binding.clientOrgId,
          channelName: binding.channelName,
          status: binding.status,
          healthStatus: binding.healthStatus,
          unavailableReason: binding.unavailableReason,
          lastVerifiedAt: binding.lastVerifiedAt,
        })),
        hostInstallations: hostInstalls
          .filter((installation) => installation.kind === "host")
          .map((installation) => ({
            installationId: installation._id,
            teamName: installation.teamName,
            status: installation.status,
            updatedAt: installation.updatedAt,
          })),
      },
      email: emailAccounts.map((account) => ({
        accountId: account._id,
        orgId: account.orgId,
        label: account.label,
        status: account.status,
        lastError: account.lastError,
        lastTestedAt: account.lastTestedAt,
        updatedAt: account.updatedAt,
      })),
      bounded: {
        connections: connections.length >= (orgId ? 25 : 250),
        bindings: bindings.length >= (orgId ? 25 : 250),
        emailAccounts: emailAccounts.length >= (orgId ? 25 : 250),
      },
    };
  }

  if (toolName === "retry_failed_policy_extraction") {
    const policyId = normalizePolicyId(ctx, input.policyId);
    const policy = await ctx.db.get(policyId);
    if (!policy) throw new Error("Policy not found");
    const run = await ctx.db
      .query("policyExtractionRuns")
      .withIndex("policy", (index) => index.eq("policyId", policyId))
      .order("desc")
      .first();
    const status = run?.pipelineStatus ?? policy.pipelineStatus;
    if (status === "running" || status === "paused") {
      throw new Error(
        "An extraction is already running or paused for this policy",
      );
    }
    if (!policy.fileId) throw new Error("Policy source file is missing");
    await ctx.scheduler.runAfter(
      0,
      internal.actions.policyExtraction.retryPolicyExtraction,
      { policyId, mode: "full" },
    );
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: policy.orgId,
      summary: `Queued full extraction for ${policy.policyNumber ?? policy.fileName ?? policyId}`,
      metadata: {
        domain: "operator_agent",
        policyId,
        previousStatus: status,
        operation: "full_extraction",
      },
    });
    return { status: "scheduled", policyId, previousStatus: status };
  }

  if (toolName === "update_organization_profile") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const organization = await ctx.db.get(orgId);
    if (!organization) throw new Error("Organization not found");
    const patch: {
      name?: string;
      website?: string;
      industry?: string;
      industryVertical?: string;
    } = {};
    if (input.name !== undefined) {
      const name = normalizedOptionalText(input.name);
      if (!name) throw new Error("Organization name is required");
      patch.name = name;
    }
    if ("website" in input)
      patch.website = normalizedOptionalText(input.website);
    if ("industry" in input)
      patch.industry = normalizedOptionalText(input.industry);
    if ("industryVertical" in input) {
      patch.industryVertical = normalizedOptionalText(input.industryVertical);
    }
    await ctx.db.patch(orgId, patch);
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: orgId,
      summary: `Updated organization profile for ${patch.name ?? organization.name}`,
      metadata: { domain: "operator_agent", fields: Object.keys(patch) },
    });
    return { status: "updated", orgId, fields: Object.keys(patch) };
  }

  if (toolName === "set_organization_status") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const organization = await ctx.db.get(orgId);
    if (!organization) throw new Error("Organization not found");
    const status = input.status;
    if (status !== "onboarding" && status !== "live") {
      throw new Error("Invalid organization status");
    }
    const previous = organization.operatorStatus ?? "live";
    await ctx.db.patch(orgId, { operatorStatus: status });
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type:
        organization.type === "broker"
          ? "broker_status_changed"
          : "client_status_changed",
      targetOrgId: orgId,
      summary: `${organization.name} changed from ${previous} to ${status}`,
      metadata: { previous, next: status, domain: "operator_agent" },
    });
    return { status: "updated", orgId, previous, next: status };
  }

  if (toolName === "set_client_feature_flag") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const organization = await ctx.db.get(orgId);
    if (!organization || organization.type !== "client") {
      throw new Error("Client organization not found");
    }
    const flagId = input.flagId;
    if (
      flagId !== "connect_features" &&
      flagId !== "coverage_recovery_v2" &&
      flagId !== "imessage_app_cards"
    ) {
      throw new Error("Unsupported feature flag");
    }
    const enabled = input.enabled === true;
    assertFeatureFlagAllowedForOrg(flagId, organization);
    await ctx.db.patch(orgId, {
      featureFlags: setFeatureFlagPatch(
        organization.featureFlags,
        flagId,
        enabled,
      ),
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: orgId,
      summary: `Updated ${flagId} for ${organization.name}`,
      metadata: { flagId, enabled, domain: "operator_agent" },
    });
    return { status: "updated", orgId, flagId, enabled };
  }

  if (toolName === "clear_all_agent_memory") {
    await ctx.scheduler.runAfter(
      0,
      internal.memoryMaintenance.clearTableBatch,
      {
        table: "orgMemory",
      },
    );
    await ctx.scheduler.runAfter(
      0,
      internal.memoryMaintenance.clearTableBatch,
      {
        table: "conversationTurns",
      },
    );
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "memory_cleared",
      summary: "Scheduled org memory and raw conversation memory purge",
      metadata: {
        domain: "operator_agent",
        tables: ["orgMemory", "conversationTurns"],
      },
    });
    return { status: "scheduled", tables: ["orgMemory", "conversationTurns"] };
  }

  throw new Error(`Unsupported operator tool: ${toolName}`);
}

async function executeOperatorTool(ctx: MutationCtx, args: ExecuteToolArgs) {
  const operator = await requireOperatorForUser(ctx, args.operatorUserId);
  const run = await ctx.db.get(args.runId);
  if (
    !run ||
    run.operatorUserId !== args.operatorUserId ||
    run.threadId !== args.threadId
  ) {
    throw new Error("Operator agent run not found");
  }
  await requireOperatorThread(ctx, args.threadId, args.operatorUserId, {
    allowShared: true,
  });
  const spec = getOperatorAgentToolSpec(args.toolName);
  assertOperatorRole(operator.profile.role, spec.requiredRole);
  const input = parseOperatorAgentToolInput(args.toolName, args.input);
  const expectedHash = await actionConfirmationFingerprint({
    toolName: args.toolName,
    toolVersion: spec.version,
    input,
  });
  if (expectedHash !== args.inputHash) {
    throw new Error("Operator tool input changed before execution");
  }
  const target = spec.target(input);
  const existing = await ctx.db
    .query("agentActionAuditEvents")
    .withIndex("idempotency", (index) =>
      index
        .eq("operatorUserId", args.operatorUserId)
        .eq("idempotencyKey", args.idempotencyKey),
    )
    .unique();
  if (existing) {
    if (
      existing.inputHash !== args.inputHash ||
      existing.action !== args.toolName
    ) {
      throw new Error("Idempotency key was already used for another action");
    }
    if (existing.status === "succeeded") {
      return {
        status: "succeeded" as const,
        result: parseStoredOutput(existing.output),
        idempotent: true,
      };
    }
    if (
      run.cancellationRequestedAt ||
      run.status === "cancelled" ||
      run.status === "failed" ||
      run.status === "completed"
    ) {
      throw new Error("Operator agent run is no longer active");
    }
    if (existing.status === "awaiting_confirmation" && !args.confirmationId) {
      return {
        status: "confirmation_required" as const,
        confirmationId: existing.operatorConfirmationId,
        summary: spec.summarize(input),
      };
    }
    if (
      existing.status === "awaiting_confirmation" &&
      existing.operatorConfirmationId !== args.confirmationId
    ) {
      throw new Error("Confirmation does not match this action");
    }
    await ctx.db.patch(existing._id, {
      status: "pending",
      operatorConfirmationId:
        args.confirmationId ?? existing.operatorConfirmationId,
      updatedAt: dayjs().valueOf(),
    });
  }

  if (run.cancellationRequestedAt || run.status === "cancelled") {
    throw new Error("Operator agent run was cancelled");
  }
  if (spec.confirmation === "exact") {
    if (
      !args.confirmationId ||
      run.status !== "waiting_confirmation" ||
      run.checkpoint?.pendingConfirmationId !== args.confirmationId
    ) {
      throw new Error("Exact operator confirmation is required");
    }
    const confirmation = await ctx.db.get(args.confirmationId);
    if (
      !confirmation ||
      confirmation.status !== "completed" ||
      confirmation.operatorUserId !== args.operatorUserId ||
      confirmation.threadId !== args.threadId ||
      confirmation.payload.runId !== args.runId ||
      confirmation.payload.toolName !== args.toolName ||
      confirmation.payload.inputHash !== args.inputHash ||
      confirmation.payload.idempotencyKey !== args.idempotencyKey
    ) {
      throw new Error("Exact operator confirmation is invalid");
    }
  } else if (run.status !== "running") {
    throw new Error("Operator agent run is no longer active");
  }

  const now = dayjs().valueOf();
  const auditId =
    existing?._id ??
    (await ctx.db.insert("agentActionAuditEvents", {
      operatorThreadId: args.threadId,
      operatorMessageId: args.threadMessageId,
      runId: args.runId,
      operatorConfirmationId: args.confirmationId,
      actorKind: "operator",
      operatorUserId: args.operatorUserId,
      authorizationKind: "operator",
      action: args.toolName,
      toolVersion: spec.version,
      capability: spec.capability,
      effect: spec.effect,
      idempotencyKey: args.idempotencyKey,
      inputHash: args.inputHash,
      targetKind: target.kind,
      targetId: target.id,
      channel: args.channel,
      input: boundedJson(input),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    }));

  try {
    const result = await executeToolDomain(ctx, {
      operatorUserId: args.operatorUserId,
      toolName: args.toolName as OperatorAgentToolName,
      input,
    });
    await ctx.db.patch(auditId, {
      status: "succeeded",
      output: boundedJson(result),
      error: undefined,
      updatedAt: dayjs().valueOf(),
    });
    return { status: "succeeded" as const, result, idempotent: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.db.patch(auditId, {
      status: "failed",
      error: message.slice(0, 1_000),
      updatedAt: dayjs().valueOf(),
    });
    return { status: "failed" as const, error: message };
  }
}

export const listThreads = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
    const [owned, shared] = await Promise.all([
      ctx.db
        .query("operatorAgentThreads")
        .withIndex("owner_activity", (index) =>
          index.eq("ownerUserId", operator.userId),
        )
        .order("desc")
        .take(limit),
      ctx.db
        .query("operatorAgentThreads")
        .withIndex("visibility_activity", (index) =>
          index.eq("visibility", "shared"),
        )
        .order("desc")
        .take(limit),
    ]);
    return [
      ...new Map(
        [...owned, ...shared].map((thread) => [thread._id, thread]),
      ).values(),
    ]
      .sort((left, right) => right.lastMessageAt - left.lastMessageAt)
      .slice(0, limit);
  },
});

export const getThread = query({
  args: { threadId: v.id("operatorAgentThreads") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const thread = await requireOperatorThread(
      ctx,
      args.threadId,
      operator.userId,
      { allowShared: true },
    );
    const [messages, runs, pendingConfirmation] = await Promise.all([
      ctx.db
        .query("operatorAgentMessages")
        .withIndex("thread", (index) => index.eq("threadId", args.threadId))
        .order("desc")
        .take(500)
        .then((items) => items.reverse()),
      ctx.db
        .query("operatorAgentRuns")
        .withIndex("thread_status", (index) =>
          index.eq("threadId", args.threadId),
        )
        .order("desc")
        .take(25),
      ctx.db
        .query("operatorAgentConfirmations")
        .withIndex("thread_status", (index) =>
          index.eq("threadId", args.threadId).eq("status", "pending"),
        )
        .order("desc")
        .first(),
    ]);
    const activeRun =
      runs.find((run) => ACTIVE_RUN_STATUSES.has(run.status)) ?? null;
    const confirmationIsCurrent =
      pendingConfirmation &&
      pendingConfirmation.operatorUserId === operator.userId &&
      pendingConfirmation.expiresAt > dayjs().valueOf() &&
      activeRun?.status === "waiting_confirmation" &&
      activeRun.checkpoint?.pendingConfirmationId === pendingConfirmation._id;
    return {
      thread,
      messages,
      activeRun,
      recentRuns: runs,
      pendingConfirmation: confirmationIsCurrent
        ? {
            _id: pendingConfirmation._id,
            summary: pendingConfirmation.payload.summary,
            toolName: pendingConfirmation.payload.toolName,
            effect: pendingConfirmation.payload.effect,
            targetKind: pendingConfirmation.payload.targetKind,
            targetId: pendingConfirmation.payload.targetId,
            expiresAt: pendingConfirmation.expiresAt,
          }
        : null,
    };
  },
});

export const createThread = mutation({
  args: { initialContext: v.optional(pageContextValidator) },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return insertOperatorThread(ctx, {
      operatorUserId: operator.userId,
      channel: "chat",
      initialContext: args.initialContext,
    });
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    const now = dayjs().valueOf();
    const expiresAt = dayjs(now).add(30, "minute").valueOf();
    const uploadIntentId = await ctx.db.insert("operatorAgentUploadIntents", {
      operatorUserId: operator.userId,
      expiresAt,
      createdAt: now,
    });
    await ctx.scheduler.runAt(
      expiresAt,
      internal.operatorAgent.cleanupUploadIntentInternal,
      { uploadIntentId },
    );
    return {
      uploadUrl: await ctx.storage.generateUploadUrl(),
      uploadIntentId,
    };
  },
});

export const registerUpload = mutation({
  args: {
    uploadIntentId: v.id("operatorAgentUploadIntents"),
    fileId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const intent = await ctx.db.get(args.uploadIntentId);
    if (
      !intent ||
      intent.operatorUserId !== operator.userId ||
      intent.expiresAt <= dayjs().valueOf() ||
      (intent.fileId && intent.fileId !== args.fileId)
    ) {
      throw new Error(
        "Operator attachment upload intent is invalid or expired",
      );
    }
    const existingReference = await ctx.db
      .query("operatorAgentAttachments")
      .withIndex("file", (index) => index.eq("fileId", args.fileId))
      .first();
    if (existingReference?.operatorUserId !== undefined) {
      throw new Error("Operator attachment is already owned");
    }
    const metadata = await ctx.db.system.get("_storage", args.fileId);
    if (!metadata) throw new Error("Operator attachment was not uploaded");
    await ctx.db.patch(intent._id, { fileId: args.fileId });
    return { registered: true as const };
  },
});

export const discardUploads = mutation({
  args: {
    uploads: v.array(
      v.object({
        uploadIntentId: v.id("operatorAgentUploadIntents"),
        fileId: v.optional(v.id("_storage")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    let discarded = 0;
    for (const upload of args.uploads.slice(0, 10)) {
      const intent = await ctx.db.get(upload.uploadIntentId);
      if (!intent || intent.operatorUserId !== operator.userId) {
        continue;
      }
      if (intent.fileId && upload.fileId && intent.fileId !== upload.fileId) {
        continue;
      }
      const fileId = intent.fileId ?? upload.fileId;
      if (fileId) {
        const reference = await ctx.db
          .query("operatorAgentAttachments")
          .withIndex("file", (index) => index.eq("fileId", fileId))
          .first();
        if (!reference) await ctx.storage.delete(fileId);
      }
      await ctx.db.delete(intent._id);
      discarded += 1;
    }
    return { discarded };
  },
});

export const cleanupUploadIntentInternal = internalMutation({
  args: { uploadIntentId: v.id("operatorAgentUploadIntents") },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.uploadIntentId);
    if (!intent) return { deleted: false as const };
    const now = dayjs().valueOf();
    if (intent.expiresAt > now) {
      await ctx.scheduler.runAt(
        intent.expiresAt,
        internal.operatorAgent.cleanupUploadIntentInternal,
        args,
      );
      return { deleted: false as const };
    }
    if (intent.fileId) {
      const fileId = intent.fileId;
      const reference = await ctx.db
        .query("operatorAgentAttachments")
        .withIndex("file", (index) => index.eq("fileId", fileId))
        .first();
      if (!reference) await ctx.storage.delete(fileId);
    }
    await ctx.db.delete(intent._id);
    return { deleted: true as const };
  },
});

export const deleteUnreferencedAttachmentsInternal = internalMutation({
  args: { fileIds: v.array(v.id("_storage")) },
  handler: async (ctx, args) => {
    let deleted = 0;
    for (const fileId of args.fileIds.slice(0, MAX_AGENT_ATTACHMENT_FILES)) {
      const reference = await ctx.db
        .query("operatorAgentAttachments")
        .withIndex("file", (index) => index.eq("fileId", fileId))
        .first();
      if (reference) continue;
      await ctx.storage.delete(fileId);
      deleted += 1;
    }
    return { deleted };
  },
});

export const getAttachmentUrl = query({
  args: {
    threadId: v.id("operatorAgentThreads"),
    fileId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireOperatorThread(ctx, args.threadId, operator.userId, {
      allowShared: true,
    });
    const attachment = await ctx.db
      .query("operatorAgentAttachments")
      .withIndex("thread_file", (index) =>
        index.eq("threadId", args.threadId).eq("fileId", args.fileId),
      )
      .first();
    return attachment ? ctx.storage.getUrl(args.fileId) : null;
  },
});

export const sendMessage = mutation({
  args: {
    threadId: v.optional(v.id("operatorAgentThreads")),
    content: v.string(),
    pageContext: v.optional(pageContextValidator),
    attachments: v.optional(v.array(operatorAttachmentValidator)),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const threadId =
      args.threadId ??
      (await insertOperatorThread(ctx, {
        operatorUserId: operator.userId,
        channel: "chat",
        initialContext: args.pageContext,
      }));
    const result = await enqueueOperatorMessage(ctx, {
      operatorUserId: operator.userId,
      threadId,
      channel: "chat",
      content: args.content,
      pageContext: args.pageContext,
      attachments: args.attachments,
      requireUploadIntent: Boolean(args.attachments?.length),
    });
    return { threadId, ...result };
  },
});

export const cancelRun = mutation({
  args: { threadId: v.id("operatorAgentThreads") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireOperatorThread(ctx, args.threadId, operator.userId, {
      allowShared: true,
    });
    const cancelled = await cancelActiveRunsForThread(
      ctx,
      args.threadId,
      "cancelled_by_operator",
    );
    await invalidatePendingOperatorConfirmations(
      ctx,
      args.threadId,
      "cancelled_by_operator",
    );
    return { cancelled: cancelled > 0 };
  },
});

async function confirmOperatorAction(
  ctx: MutationCtx,
  args: {
    threadId: Id<"operatorAgentThreads">;
    confirmationId: Id<"operatorAgentConfirmations">;
    decision: "approve" | "reject";
    operatorUserId?: Id<"users">;
    channel?: OperatorChannel;
  },
) {
  const operator = args.operatorUserId
    ? await requireOperatorForUser(ctx, args.operatorUserId)
    : await requireOperator(ctx);
  const thread = await requireOperatorThread(
    ctx,
    args.threadId,
    operator.userId,
    { allowShared: true },
  );
  const channel =
    args.channel ??
    (thread.channel === "slack" ||
    thread.channel === "imessage" ||
    thread.channel === "mcp"
      ? thread.channel
      : "chat");
  const confirmation = await ctx.db.get(args.confirmationId);
  if (
    !confirmation ||
    confirmation.threadId !== args.threadId ||
    confirmation.payload.kind !== "operator_tool_action" ||
    confirmation.operatorUserId !== operator.userId
  ) {
    throw new Error("Operator action confirmation not found");
  }
  const payload = confirmation.payload;
  const run = await ctx.db.get(payload.runId);
  if (!run || run.operatorUserId !== operator.userId) {
    throw new Error("Operator agent run not found");
  }
  const now = dayjs().valueOf();
  if (
    run.cancellationRequestedAt ||
    run.status !== "waiting_confirmation" ||
    run.checkpoint?.pendingConfirmationId !== confirmation._id ||
    confirmation.status !== "pending"
  ) {
    return { status: "needs_refresh" as const, runId: run._id };
  }
  if (confirmation.expiresAt <= now) {
    await ctx.db.patch(confirmation._id, {
      status: "expired",
      completedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(run._id, {
      status: "completed",
      completedAt: now,
      checkpoint: {
        iteration: run.checkpoint?.iteration ?? 0,
        executionCount: run.checkpoint?.executionCount ?? 0,
        summary: "Operator confirmation expired",
        lastToolName: run.checkpoint?.lastToolName,
      },
      updatedAt: now,
    });
    const content = `Confirmation expired: ${payload.summary}.`;
    await ctx.db.insert("operatorAgentMessages", {
      threadId: args.threadId,
      ownerUserId: operator.userId,
      channel,
      role: "agent",
      content,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.threadId, { lastMessageAt: now, updatedAt: now });
    return { status: "expired" as const, runId: run._id, content };
  }
  if (args.decision === "reject") {
    await ctx.db.patch(confirmation._id, {
      status: "stale",
      invalidatedAt: now,
      invalidationReason: "rejected_by_operator",
      updatedAt: now,
    });
    const ledger = await ctx.db
      .query("agentActionAuditEvents")
      .withIndex("idempotency", (index) =>
        index
          .eq("operatorUserId", operator.userId)
          .eq("idempotencyKey", payload.idempotencyKey),
      )
      .unique();
    if (ledger) {
      await ctx.db.patch(ledger._id, {
        status: "cancelled",
        updatedAt: now,
      });
    }
    await ctx.db.patch(run._id, {
      status: "completed",
      completedAt: now,
      updatedAt: now,
    });
    const content = `Cancelled: ${payload.summary}.`;
    await ctx.db.insert("operatorAgentMessages", {
      threadId: args.threadId,
      ownerUserId: operator.userId,
      channel,
      role: "agent",
      content,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.threadId, { lastMessageAt: now, updatedAt: now });
    return { status: "rejected" as const, runId: run._id, content };
  }

  await ctx.db.patch(confirmation._id, {
    status: "completed",
    completedAt: now,
    updatedAt: now,
  });
  const parsedInput = JSON.parse(payload.input) as unknown;
  const result = await executeOperatorTool(ctx, {
    operatorUserId: operator.userId,
    runId: run._id,
    threadId: args.threadId,
    threadMessageId: run.agentMessageId,
    toolName: payload.toolName,
    input: parsedInput,
    inputHash: payload.inputHash,
    idempotencyKey: payload.idempotencyKey,
    channel,
    confirmationId: confirmation._id,
  });
  const succeeded = result.status === "succeeded";
  if (succeeded && run.executionKind === "goal") {
    const toolCall = {
      name: payload.toolName,
      input: boundedJson(parsedInput, 500),
      output: boundedJson(result, 500),
    };
    const currentMessage = await ctx.db.get(run.agentMessageId);
    const usedTools = [
      ...new Set([...(currentMessage?.usedTools ?? []), payload.toolName]),
    ];
    const toolCalls = [...(currentMessage?.toolCalls ?? []), toolCall].slice(
      -100,
    );
    await ctx.db.patch(run.agentMessageId, {
      content: "",
      status: "processing",
      usedTools,
      toolCalls,
      updatedAt: now,
    });
    await ctx.db.patch(run._id, {
      status: "queued",
      checkpoint: {
        iteration: run.checkpoint?.iteration ?? 0,
        executionCount: (run.checkpoint?.executionCount ?? 0) + 1,
        summary: buildOperatorRunCheckpointSummary({
          previous: run.checkpoint?.summary,
          audit: {
            usedTools: [payload.toolName],
            completedTools: [payload.toolName],
            toolCalls: [toolCall],
            workflowOutcomes: [],
          },
        }),
        lastToolName: payload.toolName,
      },
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.operatorAgentRunner.run, {
      runId: run._id,
    });
    return {
      status: "queued" as const,
      runId: run._id,
      result,
      content: `Confirmed: ${payload.summary}. Continuing the operator task.`,
    };
  }
  await ctx.db.patch(run._id, {
    status: succeeded ? "completed" : "failed",
    completedAt: now,
    lastError: succeeded ? undefined : result.error,
    updatedAt: now,
  });
  const content = succeeded
    ? `Completed: ${payload.summary}.`
    : `Could not complete ${payload.summary}: ${result.error}`;
  await ctx.db.insert("operatorAgentMessages", {
    threadId: args.threadId,
    ownerUserId: operator.userId,
    channel,
    role: "agent",
    content,
    usedTools: [payload.toolName],
    toolCalls: [
      {
        name: payload.toolName,
        input: boundedJson(parsedInput, 500),
        output: boundedJson(result, 500),
      },
    ],
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(args.threadId, { lastMessageAt: now, updatedAt: now });
  return {
    status: succeeded ? ("completed" as const) : ("failed" as const),
    runId: run._id,
    result,
    content,
  };
}

const confirmActionArgs = {
  threadId: v.id("operatorAgentThreads"),
  confirmationId: v.id("operatorAgentConfirmations"),
  decision: v.union(v.literal("approve"), v.literal("reject")),
};

export const confirmAction = mutation({
  args: confirmActionArgs,
  handler: confirmOperatorAction,
});

export const confirmActionInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    channel: v.optional(operatorChannelValidator),
    ...confirmActionArgs,
  },
  handler: confirmOperatorAction,
});

export const getPendingConfirmationInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await requireOperatorThread(ctx, args.threadId, args.operatorUserId, {
      allowShared: true,
    });
    const confirmation = await ctx.db
      .query("operatorAgentConfirmations")
      .withIndex("thread_status", (index) =>
        index.eq("threadId", args.threadId).eq("status", "pending"),
      )
      .order("desc")
      .first();
    if (
      !confirmation ||
      confirmation.operatorUserId !== args.operatorUserId ||
      confirmation.expiresAt <= dayjs().valueOf()
    ) {
      return null;
    }
    const run = await ctx.db.get(confirmation.payload.runId);
    if (
      !run ||
      run.operatorUserId !== args.operatorUserId ||
      run.status !== "waiting_confirmation" ||
      run.checkpoint?.pendingConfirmationId !== confirmation._id
    ) {
      return null;
    }
    return {
      _id: confirmation._id,
      summary: confirmation.payload.summary,
      toolName: confirmation.payload.toolName,
      effect: confirmation.payload.effect,
      targetKind: confirmation.payload.targetKind,
      targetId: confirmation.payload.targetId,
      expiresAt: confirmation.expiresAt,
    };
  },
});

export const createOrGetChannelThreadInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    channel: v.union(
      v.literal("slack"),
      v.literal("imessage"),
      v.literal("mcp"),
    ),
    conversationKey: v.string(),
    title: v.optional(v.string()),
    shared: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const conversationKey = normalizeOperatorConversationKey(
      args.conversationKey,
    );
    if (args.shared && args.channel !== "slack") {
      throw new Error("Only Slack channel conversations may be shared");
    }
    const existing = args.shared
      ? await ctx.db
          .query("operatorAgentThreads")
          .withIndex("channel_conversation", (index) =>
            index
              .eq("channel", args.channel)
              .eq("conversationKey", conversationKey),
          )
          .unique()
      : await ctx.db
          .query("operatorAgentThreads")
          .withIndex("owner_conversation", (index) =>
            index
              .eq("ownerUserId", args.operatorUserId)
              .eq("channel", args.channel)
              .eq("conversationKey", conversationKey),
          )
          .unique();
    if (existing) return existing._id;
    return insertOperatorThread(ctx, {
      operatorUserId: args.operatorUserId,
      channel: args.channel,
      title: args.title,
      conversationKey,
      visibility: args.shared ? "shared" : "private",
    });
  },
});

export const enqueueMessageInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
    channel: operatorChannelValidator,
    content: v.string(),
    dedupeKey: v.string(),
    attachments: v.optional(v.array(operatorAttachmentValidator)),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    return enqueueOperatorMessage(ctx, args);
  },
});

export const getRunResultForOperatorInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    runId: v.id("operatorAgentRuns"),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const run = await ctx.db.get(args.runId);
    if (!run || run.operatorUserId !== args.operatorUserId) {
      throw new Error("Operator agent run not found");
    }
    await requireOperatorThread(ctx, run.threadId, args.operatorUserId, {
      allowShared: true,
    });
    const response = await ctx.db.get(run.agentMessageId);
    return {
      run,
      response: response
        ? {
            messageId: response._id,
            content: response.content,
            status: response.status,
            attachments: response.attachments,
            usedTools: response.usedTools,
            toolCalls: response.toolCalls,
          }
        : undefined,
    };
  },
});

export const cancelRunInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await requireOperatorThread(ctx, args.threadId, args.operatorUserId, {
      allowShared: true,
    });
    const cancelled = await cancelActiveRunsForThread(
      ctx,
      args.threadId,
      "cancelled_by_operator",
    );
    await invalidatePendingOperatorConfirmations(
      ctx,
      args.threadId,
      "cancelled_by_operator",
    );
    return { cancelled: cancelled > 0 };
  },
});

export const prepareDirectToolInvocationInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.optional(v.id("operatorAgentThreads")),
    conversationKey: v.optional(v.string()),
    channel: operatorChannelValidator,
    toolName: v.string(),
    summary: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const idempotencyKey = args.idempotencyKey.trim();
    if (!idempotencyKey) throw new Error("Idempotency key is required");
    if (idempotencyKey.length > MAX_OPERATOR_DEDUPE_KEY_CHARS) {
      throw new Error("Idempotency key is too long");
    }
    if (args.summary.trim().length > MAX_OPERATOR_MESSAGE_CHARS) {
      throw new Error("Operator tool summary is too long");
    }
    const existingLedger = await ctx.db
      .query("agentActionAuditEvents")
      .withIndex("idempotency", (index) =>
        index
          .eq("operatorUserId", args.operatorUserId)
          .eq("idempotencyKey", idempotencyKey),
      )
      .unique();
    if (existingLedger?.runId) {
      const run = await ctx.db.get(existingLedger.runId);
      if (run && run.operatorUserId === args.operatorUserId) {
        return {
          threadId: run.threadId,
          runId: run._id,
          userMessageId: run.userMessageId,
          agentMessageId: run.agentMessageId,
          duplicate: true,
        };
      }
    }

    let threadId = args.threadId;
    if (threadId) {
      await requireOperatorThread(ctx, threadId, args.operatorUserId, {
        allowShared: true,
      });
    } else {
      const conversationKey = normalizeOperatorConversationKey(
        args.conversationKey || `${args.channel}:direct`,
      );
      const existingThread = await ctx.db
        .query("operatorAgentThreads")
        .withIndex("owner_conversation", (index) =>
          index
            .eq("ownerUserId", args.operatorUserId)
            .eq("channel", args.channel)
            .eq("conversationKey", conversationKey),
        )
        .unique();
      threadId =
        existingThread?._id ??
        (await insertOperatorThread(ctx, {
          operatorUserId: args.operatorUserId,
          channel: args.channel,
          title: "Operator API",
          conversationKey,
        }));
    }

    const now = dayjs().valueOf();
    const userMessageId = await ctx.db.insert("operatorAgentMessages", {
      threadId,
      ownerUserId: args.operatorUserId,
      dedupeKey: `operator-tool:${idempotencyKey}`,
      channel: args.channel,
      role: "user",
      userId: args.operatorUserId,
      userName: "Operator API",
      content: args.summary,
      createdAt: now,
      updatedAt: now,
    });
    const agentMessageId = await ctx.db.insert("operatorAgentMessages", {
      threadId,
      ownerUserId: args.operatorUserId,
      channel: args.channel,
      role: "agent",
      replyToMessageId: userMessageId,
      content: "",
      status: "processing",
      agentRunStartedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const runId = await ctx.db.insert("operatorAgentRuns", {
      threadId,
      operatorUserId: args.operatorUserId,
      userMessageId,
      agentMessageId,
      executionKind: "direct_tool",
      objective: args.summary,
      status: "running",
      checkpoint: { iteration: 0, executionCount: 0 },
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(threadId, { lastMessageAt: now, updatedAt: now });
    return {
      threadId,
      runId,
      userMessageId,
      agentMessageId,
      duplicate: false,
    };
  },
});

export const invokeRegisteredToolInternal = internalAction({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.optional(v.id("operatorAgentThreads")),
    conversationKey: v.optional(v.string()),
    channel: operatorChannelValidator,
    toolName: v.string(),
    input: v.any(),
    idempotencyKey: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<DirectToolInvocation & { outcome: DirectToolOutcome }> => {
    const spec = getOperatorAgentToolSpec(args.toolName);
    const input = parseOperatorAgentToolInput(args.toolName, args.input);
    const summary = spec.summarize(input);
    const inputHash = await actionConfirmationFingerprint({
      toolName: args.toolName,
      toolVersion: spec.version,
      input,
    });
    const invocation: DirectToolInvocation = await ctx.runMutation(
      internal.operatorAgent.prepareDirectToolInvocationInternal,
      {
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        conversationKey: args.conversationKey,
        channel: args.channel,
        toolName: args.toolName,
        summary,
        idempotencyKey: args.idempotencyKey,
      },
    );
    const outcome: DirectToolOutcome =
      spec.confirmation === "exact"
        ? await ctx.runMutation(
            internal.operatorAgent.requestToolConfirmationInternal,
            {
              operatorUserId: args.operatorUserId,
              runId: invocation.runId,
              threadId: invocation.threadId,
              threadMessageId: invocation.agentMessageId,
              toolName: args.toolName,
              input,
              inputHash,
              idempotencyKey: args.idempotencyKey,
              channel: args.channel,
            },
          )
        : await ctx.runMutation(internal.operatorAgent.executeToolInternal, {
            operatorUserId: args.operatorUserId,
            runId: invocation.runId,
            threadId: invocation.threadId,
            threadMessageId: invocation.agentMessageId,
            toolName: args.toolName,
            input,
            inputHash,
            idempotencyKey: args.idempotencyKey,
            channel: args.channel,
          });
    const content =
      outcome.status === "confirmation_required"
        ? `Confirmation required: ${summary}.`
        : outcome.status === "succeeded"
          ? `Completed: ${summary}.`
          : `Could not complete ${summary}: ${"error" in outcome ? outcome.error : "unknown error"}`;
    await ctx.runMutation(internal.operatorAgent.completeRunInternal, {
      runId: invocation.runId,
      content,
      usedTools: [args.toolName],
      toolCalls: [
        {
          name: args.toolName,
          input: boundedJson(input, 500),
          output: boundedJson(outcome, 500),
        },
      ],
    });
    return { ...invocation, outcome };
  },
});

export const getRunContextInternal = internalQuery({
  args: { runId: v.id("operatorAgentRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    await requireOperatorForUser(ctx, run.operatorUserId);
    const thread = await requireOperatorThread(
      ctx,
      run.threadId,
      run.operatorUserId,
      { allowShared: true },
    );
    const messages = await ctx.db
      .query("operatorAgentMessages")
      .withIndex("thread", (index) => index.eq("threadId", run.threadId))
      .order("desc")
      .take(96);
    return { run, thread, messages: messages.reverse() };
  },
});

export const markRunStartedInternal = internalMutation({
  args: { runId: v.id("operatorAgentRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "queued" || run.cancellationRequestedAt) {
      return false;
    }
    await requireOperatorForUser(ctx, run.operatorUserId);
    const now = dayjs().valueOf();
    await ctx.db.patch(run._id, {
      status: "running",
      startedAt: run.startedAt ?? now,
      updatedAt: now,
    });
    return true;
  },
});

export const requestToolConfirmationInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    runId: v.id("operatorAgentRuns"),
    threadId: v.id("operatorAgentThreads"),
    threadMessageId: v.id("operatorAgentMessages"),
    toolName: v.string(),
    input: v.any(),
    inputHash: v.string(),
    idempotencyKey: v.string(),
    channel: operatorChannelValidator,
  },
  handler: async (ctx, args) => {
    const operator = await requireOperatorForUser(ctx, args.operatorUserId);
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.operatorUserId !== args.operatorUserId ||
      run.threadId !== args.threadId
    ) {
      throw new Error("Operator agent run not found");
    }
    await requireOperatorThread(ctx, args.threadId, args.operatorUserId, {
      allowShared: true,
    });
    const spec = getOperatorAgentToolSpec(args.toolName);
    assertOperatorRole(operator.profile.role, spec.requiredRole);
    if (spec.confirmation !== "exact" || spec.effect === "read") {
      throw new Error("This tool does not use exact confirmation");
    }
    const input = parseOperatorAgentToolInput(args.toolName, args.input);
    const expectedHash = await actionConfirmationFingerprint({
      toolName: args.toolName,
      toolVersion: spec.version,
      input,
    });
    if (expectedHash !== args.inputHash) {
      throw new Error("Operator tool input changed before confirmation");
    }
    const existing = await ctx.db
      .query("agentActionAuditEvents")
      .withIndex("idempotency", (index) =>
        index
          .eq("operatorUserId", args.operatorUserId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (existing) {
      if (
        existing.inputHash !== args.inputHash ||
        existing.action !== args.toolName
      ) {
        throw new Error("Idempotency key was already used for another action");
      }
      if (existing.status === "succeeded") {
        return {
          status: "succeeded" as const,
          result: parseStoredOutput(existing.output),
          idempotent: true,
        };
      }
      if (
        existing.status === "awaiting_confirmation" &&
        existing.operatorConfirmationId
      ) {
        if (
          run.cancellationRequestedAt ||
          run.status !== "waiting_confirmation" ||
          run.checkpoint?.pendingConfirmationId !==
            existing.operatorConfirmationId
        ) {
          throw new Error("Operator agent run is no longer active");
        }
        return {
          status: "confirmation_required" as const,
          confirmationId: existing.operatorConfirmationId,
          summary: spec.summarize(input),
        };
      }
    }
    if (run.cancellationRequestedAt || run.status !== "running") {
      throw new Error("Operator agent run is no longer active");
    }
    const pendingConfirmation = await ctx.db
      .query("operatorAgentConfirmations")
      .withIndex("thread_status", (index) =>
        index.eq("threadId", args.threadId).eq("status", "pending"),
      )
      .first();
    if (pendingConfirmation) {
      throw new Error(
        "Another operator action is already awaiting confirmation",
      );
    }
    const target = spec.target(input);
    const inputJson = JSON.stringify(input);
    const now = dayjs().valueOf();
    const confirmationId = await ctx.db.insert("operatorAgentConfirmations", {
      threadId: args.threadId,
      operatorUserId: args.operatorUserId,
      promptMessageId: args.threadMessageId,
      payload: {
        kind: "operator_tool_action",
        runId: args.runId,
        toolName: args.toolName,
        toolVersion: spec.version,
        input: inputJson,
        inputHash: args.inputHash,
        idempotencyKey: args.idempotencyKey,
        capability: spec.capability,
        effect: spec.effect,
        requiredRole: spec.requiredRole,
        targetKind: target.kind,
        targetId: target.id,
        summary: spec.summarize(input),
      },
      status: "pending",
      expiresAt: dayjs(now).add(10, "minute").valueOf(),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("agentActionAuditEvents", {
      operatorThreadId: args.threadId,
      operatorMessageId: args.threadMessageId,
      runId: args.runId,
      operatorConfirmationId: confirmationId,
      actorKind: "operator",
      operatorUserId: args.operatorUserId,
      authorizationKind: "operator",
      action: args.toolName,
      toolVersion: spec.version,
      capability: spec.capability,
      effect: spec.effect,
      idempotencyKey: args.idempotencyKey,
      inputHash: args.inputHash,
      targetKind: target.kind,
      targetId: target.id,
      channel: args.channel,
      input: boundedJson(input),
      output: boundedJson({ confirmationId, summary: spec.summarize(input) }),
      status: "awaiting_confirmation",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.threadMessageId, {
      content: `Confirmation required: ${spec.summarize(input)}. Reply approve or reject.`,
      status: undefined,
      usedTools: [args.toolName],
      updatedAt: now,
    });
    await ctx.db.patch(args.runId, {
      status: "waiting_confirmation",
      checkpoint: {
        iteration: (run.checkpoint?.iteration ?? 0) + 1,
        executionCount: (run.checkpoint?.executionCount ?? 0) + 1,
        summary: run.checkpoint?.summary,
        lastToolName: args.toolName,
        pendingConfirmationId: confirmationId,
      },
      updatedAt: now,
    });
    return {
      status: "confirmation_required" as const,
      confirmationId,
      summary: spec.summarize(input),
    };
  },
});

export const executeToolInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    runId: v.id("operatorAgentRuns"),
    threadId: v.id("operatorAgentThreads"),
    threadMessageId: v.id("operatorAgentMessages"),
    toolName: v.string(),
    input: v.any(),
    inputHash: v.string(),
    idempotencyKey: v.string(),
    channel: operatorChannelValidator,
    confirmationId: v.optional(v.id("operatorAgentConfirmations")),
  },
  handler: executeOperatorTool,
});

export const completeRunInternal = internalMutation({
  args: {
    runId: v.id("operatorAgentRuns"),
    content: v.string(),
    routerRequestId: v.optional(v.string()),
    usedTools: v.array(v.string()),
    toolCalls: v.array(
      v.object({
        name: v.string(),
        input: v.optional(v.string()),
        output: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const now = dayjs().valueOf();
    if (run.status === "cancelled" || run.cancellationRequestedAt) {
      return { status: "cancelled" as const };
    }
    const waiting = run.status === "waiting_confirmation";
    const currentMessage = await ctx.db.get(run.agentMessageId);
    const usedTools = [
      ...new Set([...(currentMessage?.usedTools ?? []), ...args.usedTools]),
    ];
    const toolCalls = [
      ...(currentMessage?.toolCalls ?? []),
      ...args.toolCalls,
    ].slice(-100);
    await ctx.db.patch(run.agentMessageId, {
      content: args.content,
      status: undefined,
      routerRequestId: args.routerRequestId,
      usedTools: usedTools.length > 0 ? usedTools : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      updatedAt: now,
    });
    await ctx.db.patch(run.threadId, { lastMessageAt: now, updatedAt: now });
    if (!waiting) {
      await ctx.db.patch(run._id, {
        status: "completed",
        completedAt: now,
        checkpoint: {
          iteration: (run.checkpoint?.iteration ?? 0) + 1,
          executionCount:
            (run.checkpoint?.executionCount ?? 0) + args.toolCalls.length,
          summary: args.content.slice(0, 1_000),
          lastToolName: args.usedTools.at(-1),
        },
        updatedAt: now,
      });
    }
    return {
      status: waiting
        ? ("waiting_confirmation" as const)
        : ("completed" as const),
    };
  },
});

export const continueRunInternal = internalMutation({
  args: {
    runId: v.id("operatorAgentRuns"),
    summary: v.string(),
    usedTools: v.array(v.string()),
    toolCalls: v.array(
      v.object({
        name: v.string(),
        input: v.optional(v.string()),
        output: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    if (run.status === "waiting_confirmation") {
      return { status: "waiting_confirmation" as const };
    }
    if (run.status !== "running" || run.cancellationRequestedAt) {
      return { status: "not_continued" as const };
    }
    const message = await ctx.db.get(run.agentMessageId);
    const usedTools = [
      ...new Set([...(message?.usedTools ?? []), ...args.usedTools]),
    ];
    const toolCalls = [...(message?.toolCalls ?? []), ...args.toolCalls].slice(
      -100,
    );
    const now = dayjs().valueOf();
    await ctx.db.patch(run.agentMessageId, {
      status: "processing",
      usedTools: usedTools.length > 0 ? usedTools : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      updatedAt: now,
    });
    await ctx.db.patch(run._id, {
      status: "queued",
      checkpoint: {
        iteration: (run.checkpoint?.iteration ?? 0) + 1,
        executionCount:
          (run.checkpoint?.executionCount ?? 0) + args.toolCalls.length,
        summary: args.summary.slice(-6_000),
        lastToolName: args.usedTools.at(-1),
      },
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.operatorAgentRunner.run, {
      runId: run._id,
    });
    return { status: "queued" as const };
  },
});

export const failRunInternal = internalMutation({
  args: { runId: v.id("operatorAgentRuns"), error: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;
    const now = dayjs().valueOf();
    if (run.status === "cancelled" || run.cancellationRequestedAt) return;
    if (run.checkpoint?.pendingConfirmationId) {
      const confirmation = await ctx.db.get(
        run.checkpoint.pendingConfirmationId,
      );
      if (
        confirmation?.status === "pending" &&
        confirmation.payload.runId === run._id &&
        confirmation.threadId === run.threadId
      ) {
        await ctx.db.patch(confirmation._id, {
          status: "stale",
          invalidatedAt: now,
          invalidationReason: "operator_run_failed",
          updatedAt: now,
        });
      }
    }
    const ledgerRows = await ctx.db
      .query("agentActionAuditEvents")
      .withIndex("run_created", (index) => index.eq("runId", run._id))
      .take(100);
    await Promise.all(
      ledgerRows
        .filter(
          (ledger) =>
            ledger.status === "pending" ||
            ledger.status === "awaiting_confirmation",
        )
        .map((ledger) =>
          ctx.db.patch(ledger._id, {
            status: "failed",
            error: args.error.slice(0, 1_000),
            updatedAt: now,
          }),
        ),
    );
    await ctx.db.patch(run._id, {
      status: "failed",
      lastError: args.error.slice(0, 1_000),
      completedAt: now,
      checkpoint: run.checkpoint
        ? {
            iteration: run.checkpoint.iteration,
            executionCount: run.checkpoint.executionCount,
            summary: "Operator run failed",
            lastToolName: run.checkpoint.lastToolName,
          }
        : undefined,
      updatedAt: now,
    });
    await ctx.db.patch(run.agentMessageId, {
      content: "I couldn't complete that operator task.",
      status: "error",
      error: args.error.slice(0, 1_000),
      updatedAt: now,
    });
    await ctx.db.patch(run.threadId, { lastMessageAt: now, updatedAt: now });
  },
});

export const recordImessageAttachmentDeliveryFailureInternal = internalMutation(
  {
    args: {
      operatorMessageId: v.id("operatorAgentMessages"),
      stage: v.union(v.literal("url_resolution"), v.literal("worker_delivery")),
      failures: v.array(
        v.object({
          filename: v.string(),
          error: v.optional(v.string()),
        }),
      ),
    },
    handler: async (ctx, args) => {
      const message = await ctx.db.get(args.operatorMessageId);
      if (
        !message ||
        message.channel !== "imessage" ||
        message.role !== "agent"
      ) {
        return false;
      }
      const existingArtifacts = message.toolArtifacts ?? [];
      const existingKeys = new Set(
        existingArtifacts.flatMap((artifact) => {
          if (artifact.type !== "imessage_attachment_delivery") return [];
          const data = artifact.data as {
            stage?: unknown;
            failures?: Array<{ filename?: unknown }>;
          };
          if (data.stage !== args.stage || !Array.isArray(data.failures)) {
            return [];
          }
          return data.failures.flatMap((failure) =>
            typeof failure.filename === "string"
              ? [`${args.stage}:${failure.filename.trim().toLowerCase()}`]
              : [],
          );
        }),
      );
      const failures = args.failures.flatMap((failure) => {
        const filename = failure.filename.trim();
        if (!filename) return [];
        const key = `${args.stage}:${filename.toLowerCase()}`;
        if (existingKeys.has(key)) return [];
        const error = failure.error?.trim();
        return [{ filename, ...(error ? { error } : {}) }];
      });
      if (failures.length === 0) return false;
      const names = failures
        .slice(0, 3)
        .map((failure) => `“${failure.filename.replace(/[“”"]/g, "'")}”`)
        .join(", ");
      const notice = `Attachment delivery update: ${names || "the attachment"} did not attach in iMessage. Open this operator thread in the portal to access the preserved file.`;
      const now = dayjs().valueOf();
      await ctx.db.patch(message._id, {
        content: message.content.includes(notice)
          ? message.content
          : `${message.content.trim()}\n\n${notice}`.trim(),
        toolArtifacts: [
          ...existingArtifacts.slice(-24),
          {
            type: "imessage_attachment_delivery",
            data: { status: "failed", stage: args.stage, failures },
          },
        ],
        updatedAt: now,
      });
      return true;
    },
  },
);

export const listToolCatalogInternal = internalQuery({
  args: {},
  handler: async () => operatorAgentToolJsonCatalog(),
});
