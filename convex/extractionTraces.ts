import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const TRACE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const traceStatusValidator = v.union(
  v.literal("running"),
  v.literal("complete"),
  v.literal("error"),
  v.literal("cancelled"),
);

const traceEventKindValidator = v.union(
  v.literal("session"),
  v.literal("phase"),
  v.literal("log"),
  v.literal("model_call"),
  v.literal("embedding_batch"),
  v.literal("worker"),
  v.literal("artifact"),
);

const modelProviderValidator = v.union(
  v.literal("openai"),
  v.literal("anthropic"),
  v.literal("google"),
  v.literal("xai"),
  v.literal("mistral"),
  v.literal("cohere"),
  v.literal("moonshot"),
  v.literal("deepseek"),
);

function nowMs() {
  return dayjs().valueOf();
}

function expiresAt(timestamp: number) {
  return timestamp + TRACE_RETENTION_MS;
}

function defined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

export const startSession = internalMutation({
  args: {
    traceId: v.string(),
    policyId: v.id("policies"),
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
    sourceKind: v.optional(v.string()),
    trigger: v.optional(v.string()),
    fileName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const timestamp = nowMs();
    const existing = await ctx.db
      .query("policyExtractionTraceSessions")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
      .first();

    const session = {
      traceId: args.traceId,
      policyId: args.policyId,
      orgId: args.orgId,
      userId: args.userId,
      sourceKind: args.sourceKind,
      trigger: args.trigger,
      fileName: args.fileName,
      status: "running" as const,
      startedAt: timestamp,
      lastEventAt: timestamp,
      modelCallCount: 0,
      modelDurationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      expiresAt: expiresAt(timestamp),
      updatedAt: timestamp,
    };

    if (existing) {
      await ctx.db.patch(existing._id, defined(session));
    } else {
      await ctx.db.insert("policyExtractionTraceSessions", defined(session) as typeof session);
    }

    await ctx.db.insert("policyExtractionTraceEvents", {
      traceId: args.traceId,
      policyId: args.policyId,
      orgId: args.orgId,
      kind: "session",
      timestamp,
      status: "running",
      message: "Extraction trace started",
      details: defined({
        sourceKind: args.sourceKind,
        trigger: args.trigger,
        fileName: args.fileName,
      }),
      expiresAt: expiresAt(timestamp),
    });

    return args.traceId;
  },
});

export const recordEvent = internalMutation({
  args: {
    traceId: v.optional(v.string()),
    kind: traceEventKindValidator,
    timestamp: v.optional(v.number()),
    phase: v.optional(v.string()),
    level: v.optional(v.string()),
    message: v.optional(v.string()),
    label: v.optional(v.string()),
    task: v.optional(v.string()),
    taskKind: v.optional(v.string()),
    provider: v.optional(modelProviderValidator),
    model: v.optional(v.string()),
    routeSource: v.optional(v.string()),
    transport: v.optional(v.string()),
    attempt: v.optional(v.number()),
    status: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    error: v.optional(v.string()),
    details: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    if (!args.traceId) return false;
    const session = await ctx.db
      .query("policyExtractionTraceSessions")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId!))
      .first();
    if (!session) return false;

    const timestamp = args.timestamp ?? nowMs();
    await ctx.db.insert("policyExtractionTraceEvents", defined({
      traceId: args.traceId,
      policyId: session.policyId,
      orgId: session.orgId,
      kind: args.kind,
      timestamp,
      phase: args.phase,
      level: args.level,
      message: args.message,
      label: args.label,
      task: args.task,
      taskKind: args.taskKind,
      provider: args.provider,
      model: args.model,
      routeSource: args.routeSource,
      transport: args.transport,
      attempt: args.attempt,
      status: args.status,
      durationMs: args.durationMs,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      error: args.error,
      details: args.details,
      expiresAt: session.expiresAt,
    }) as any);

    const patch: Record<string, unknown> = {
      lastEventAt: timestamp,
      updatedAt: timestamp,
    };
    if (args.kind === "model_call") {
      patch.modelCallCount = (session.modelCallCount ?? 0) + 1;
      patch.modelDurationMs = (session.modelDurationMs ?? 0) + (args.durationMs ?? 0);
      patch.inputTokens = (session.inputTokens ?? 0) + (args.inputTokens ?? 0);
      patch.outputTokens = (session.outputTokens ?? 0) + (args.outputTokens ?? 0);
    }
    if (
      args.durationMs !== undefined &&
      args.durationMs > (session.slowestDurationMs ?? 0)
    ) {
      patch.slowestDurationMs = args.durationMs;
      patch.slowestKind = args.kind;
      patch.slowestLabel = args.label ?? args.phase ?? args.taskKind ?? args.message;
    }
    if (args.error) {
      patch.error = args.error;
    }
    await ctx.db.patch(session._id, patch);
    return true;
  },
});

export const completeSession = internalMutation({
  args: {
    traceId: v.optional(v.string()),
    status: traceStatusValidator,
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.traceId) return false;
    const session = await ctx.db
      .query("policyExtractionTraceSessions")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId!))
      .first();
    if (!session) return false;
    const timestamp = nowMs();
    await ctx.db.patch(session._id, defined({
      status: args.status,
      completedAt: timestamp,
      lastEventAt: timestamp,
      totalDurationMs: timestamp - session.startedAt,
      error: args.error,
      updatedAt: timestamp,
    }));
    await ctx.db.insert("policyExtractionTraceEvents", defined({
      traceId: args.traceId,
      policyId: session.policyId,
      orgId: session.orgId,
      kind: "session",
      timestamp,
      status: args.status,
      message: args.status === "complete" ? "Extraction trace completed" : "Extraction trace ended",
      error: args.error,
      durationMs: timestamp - session.startedAt,
      expiresAt: session.expiresAt,
    }) as any);
    return true;
  },
});

export const sweepExpired = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = Math.max(1, Math.min(Math.floor(args.batchSize ?? 200), 1000));
    const cutoff = nowMs();
    const sessions = await ctx.db
      .query("policyExtractionTraceSessions")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", cutoff))
      .take(batchSize);
    const events = await ctx.db
      .query("policyExtractionTraceEvents")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", cutoff))
      .take(batchSize * 5);
    for (const event of events) await ctx.db.delete(event._id);
    for (const session of sessions) await ctx.db.delete(session._id);
    return { sessions: sessions.length, events: events.length };
  },
});
