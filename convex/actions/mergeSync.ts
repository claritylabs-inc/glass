// convex/actions/mergeSync.ts
"use node";
//
// Sync pipeline between Merge.dev (via mergeClient stub) and integrationData.
// Runs as Convex actions (can call external APIs; not transactional).

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { getMergeClient } from "../lib/mergeClient";
import type { MergeCategory } from "../lib/mergeClient";

// ── Core sync helper ────────────────────────────────────────────────────────

async function performSync(
  ctx: { runQuery: Function; runMutation: Function; scheduler: { runAfter: Function } },
  connectionId: string,
  trigger: "initial" | "webhook" | "scheduled" | "manual",
): Promise<void> {
  const startedAt = Date.now();

  // Resolve connection + decrypted token
  const tokenData = await ctx.runQuery(
    (internal as any).integrationConnections.getDecryptedTokenInternal,
    { connectionId },
  );
  if (!tokenData) throw new Error(`Connection ${connectionId} not found`);
  const { token, category, clientOrgId } = tokenData;

  // Insert running log
  const logId = await ctx.runMutation(
    (internal as any).integrationSyncLogs.insertLogInternal,
    {
      connectionId,
      clientOrgId,
      trigger,
      status: "running",
      metricsWritten: 0,
      startedAt,
    },
  );

  let metricsWritten = 0;
  let error: string | undefined;

  try {
    const client = getMergeClient();
    const metrics = await client.fetchMetrics({ accountToken: token, category: category as MergeCategory });

    for (const metric of metrics) {
      await ctx.runMutation(
        (internal as any).integrationData.upsertMetric,
        {
          connectionId,
          clientOrgId,
          metricKey: metric.metricKey,
          value: metric.value,
          unit: metric.unit,
          asOfDate: metric.asOfDate,
          period: metric.period,
          mergeSourceRef: metric.mergeSourceRef,
        },
      );
      metricsWritten++;
    }

    // Mark connection active
    await ctx.runMutation(
      (internal as any).integrationConnections.markSyncComplete,
      { connectionId, status: "success" },
    );
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    await ctx.runMutation(
      (internal as any).integrationConnections.markSyncComplete,
      { connectionId, status: "error", error },
    );
  }

  // Finalize log
  await ctx.runMutation(
    (internal as any).integrationSyncLogs.updateLogInternal,
    {
      logId,
      status: error ? "error" : "success",
      metricsWritten,
      error,
      durationMs: Date.now() - startedAt,
    },
  );

  if (error) throw new Error(error);
}

// ── Exported actions ────────────────────────────────────────────────────────

export const runInitialSync = internalAction({
  args: { connectionId: v.id("integrationConnections") },
  handler: async (ctx, args) => {
    await performSync(ctx, args.connectionId, "initial");

    // Fulfill any pending integration request for this connection
    const conn = await ctx.runQuery(
      (internal as any).integrationConnections.getInternal,
      { connectionId: args.connectionId },
    );
    if (conn?.integrationRequestId) {
      await ctx.runMutation(
        (internal as any).integrationRequests.markFulfilledInternal,
        { requestId: conn.integrationRequestId },
      );
    }
  },
});

export const runScheduledSync = internalAction({
  args: { connectionId: v.id("integrationConnections") },
  handler: async (ctx, args) => {
    // Skip if not active
    const conn = await ctx.runQuery(
      (internal as any).integrationConnections.getInternal,
      { connectionId: args.connectionId },
    );
    if (!conn || conn.status === "disconnected" || conn.status === "reauth_required") return;
    await performSync(ctx, args.connectionId, "scheduled");
  },
});

export const runWebhookDrivenSync = internalAction({
  args: {
    connectionId: v.id("integrationConnections"),
    modelName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await performSync(ctx, args.connectionId, "webhook");
  },
});

/**
 * Per-metric targeted resync (used by webhook `sync.completed` for a single model).
 */
export const syncMetric = internalAction({
  args: {
    connectionId: v.id("integrationConnections"),
    metricKey: v.string(),
  },
  handler: async (ctx, args) => {
    const tokenData = await ctx.runQuery(
      (internal as any).integrationConnections.getDecryptedTokenInternal,
      { connectionId: args.connectionId },
    );
    if (!tokenData) return;

    const client = getMergeClient();
    const metric = await client.fetchMetric({
      accountToken: tokenData.token,
      metricKey: args.metricKey,
    });
    if (!metric) return;

    await ctx.runMutation(
      (internal as any).integrationData.upsertMetric,
      {
        connectionId: args.connectionId,
        clientOrgId: tokenData.clientOrgId,
        metricKey: metric.metricKey,
        value: metric.value,
        unit: metric.unit,
        asOfDate: metric.asOfDate,
        period: metric.period,
        mergeSourceRef: metric.mergeSourceRef,
      },
    );
  },
});

/**
 * Cron entry point — enumerate all active connections and schedule per-connection syncs.
 * Jitter: each connection is delayed by (index * 5 seconds) to spread API load.
 */
export const scheduledSyncAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const connections = await ctx.runQuery(
      (internal as any).integrationConnections.listActiveInternal,
      {},
    );
    for (let i = 0; i < connections.length; i++) {
      await ctx.scheduler.runAfter(
        i * 5_000,
        (internal as any).actions.mergeSync.runScheduledSync,
        { connectionId: connections[i]._id },
      );
    }
  },
});
