/**
 * Factory that creates the 5 cl-pipelines contract mutations for a given table.
 *
 * Usage:
 *   // In your table's module (e.g. convex/policiesInternal.ts):
 *   export const { getJob, setStatus, setCheckpoint, appendLog, clearLog } =
 *     makePipelineMutations("policies");
 *
 * The returned functions are Convex internalQuery / internalMutation functions
 * ready to be exported from any Convex module.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { PipelineStatus } from "@claritylabs/cl-pipelines";

type SupportedTable = "policies" | "policyFiles" | "orgDocuments";

export function makePipelineMutations(tableName: SupportedTable) {
  const getJob = internalQuery({
    args: { jobId: v.string() },
    handler: async (ctx, { jobId }) => {
      const doc = await ctx.db
        .query(tableName)
        .filter((q) => q.eq(q.field("_id"), jobId))
        .first();
      if (!doc) return null;
      return {
        status: ((doc as any).pipelineStatus ?? "idle") as PipelineStatus,
        checkpoint: (doc as any).pipelineCheckpoint ?? null,
        error: (doc as any).pipelineError,
      };
    },
  });

  const setStatus = internalMutation({
    args: {
      jobId: v.string(),
      status: v.union(
        v.literal("idle"),
        v.literal("running"),
        v.literal("paused"),
        v.literal("complete"),
        v.literal("error"),
      ),
      // null means "clear the error" — do NOT use v.optional here, as that
      // would allow the adapter to omit the field and leave a stale error.
      error: v.union(v.string(), v.null()),
    },
    handler: async (ctx, { jobId, status, error }) => {
      await ctx.db.patch(jobId as any, {
        pipelineStatus: status,
        pipelineError: error ?? undefined, // clears on null
      });
    },
  });

  const setCheckpoint = internalMutation({
    args: { jobId: v.string(), checkpoint: v.optional(v.any()) },
    handler: async (ctx, { jobId, checkpoint }) => {
      await ctx.db.patch(jobId as any, {
        pipelineCheckpoint: checkpoint ?? undefined,
      });
    },
  });

  const appendLog = internalMutation({
    args: {
      jobId: v.string(),
      timestamp: v.number(),
      message: v.string(),
      phase: v.optional(v.string()),
      level: v.optional(v.string()),
    },
    handler: async (ctx, { jobId, timestamp, message, phase, level }) => {
      const doc = await ctx.db.get(jobId as any);
      if (!doc) return;
      const log = (doc as any).pipelineLog ?? [];
      await ctx.db.patch(jobId as any, {
        pipelineLog: [...log, { timestamp, message, phase, level }],
      });
    },
  });

  const clearLog = internalMutation({
    args: { jobId: v.string() },
    handler: async (ctx, { jobId }) => {
      await ctx.db.patch(jobId as any, { pipelineLog: [] });
    },
  });

  return { getJob, setStatus, setCheckpoint, appendLog, clearLog };
}
