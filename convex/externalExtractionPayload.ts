import dayjs from "dayjs";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

function nowMs(): number {
  return dayjs().valueOf();
}

function requireExtractionWorkerSecret(secret: string): void {
  const expected = process.env.EXTRACTION_WORKER_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("Unauthorized extraction worker");
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function appendPayloadSavedLog(
  ctx: ActionCtx,
  policyId: string,
  byteLength: number,
): Promise<{ logSaved: boolean; logError?: string }> {
  try {
    await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
      jobId: policyId,
      timestamp: nowMs(),
      message: `Saved external extraction completion payload (${formatBytes(byteLength)})`,
      phase: "worker",
      level: byteLength >= 4 * 1024 * 1024 ? "warn" : "info",
      audience: "operator",
    });
    return { logSaved: true };
  } catch (error) {
    return {
      logSaved: false,
      logError: error instanceof Error ? error.message : String(error),
    };
  }
}

type CompletionPayloadSaveResult = {
  storageId: string;
  byteLength: number;
  logSaved: boolean;
  logError?: string;
};

async function externalLeaseMatches(
  ctx: ActionCtx,
  args: { policyId: string; leaseId?: string },
): Promise<boolean> {
  if (!args.leaseId) return true;
  const job = await ctx.runQuery(internal.policies.pipelineGetJob, {
    jobId: args.policyId,
  }) as {
    status?: string;
    checkpoint?: {
      nextPhase?: string;
      lease?: { id?: string };
    } | null;
  } | null;
  return (
    job?.status === "running" &&
    job.checkpoint?.nextPhase === "extract" &&
    job.checkpoint.lease?.id === args.leaseId
  );
}

export const saveExternalCompletionPayload = action({
  args: {
    secret: v.string(),
    policyId: v.string(),
    leaseId: v.optional(v.string()),
    payload: v.any(),
  },
  handler: async (ctx, args): Promise<CompletionPayloadSaveResult> => {
    requireExtractionWorkerSecret(args.secret);
    const json = JSON.stringify(args.payload);
    const byteLength = new TextEncoder().encode(json).byteLength;
    if (!await externalLeaseMatches(ctx, args)) {
      throw new Error("Stale external extraction lease");
    }
    const storageId = String(await ctx.storage.store(new Blob([json], {
      type: "application/json",
    })));
    await ctx.runMutation(internal.policies.pipelineSaveArtifact, {
      jobId: args.policyId,
      kind: "external_completion_payload",
      storageId: storageId as Id<"_storage">,
    });
    return {
      storageId,
      byteLength,
      ...await appendPayloadSavedLog(ctx, args.policyId, byteLength),
    };
  },
});

export const createExternalCompletionUploadUrl = action({
  args: {
    secret: v.string(),
  },
  handler: async (ctx, args): Promise<{ uploadUrl: string }> => {
    requireExtractionWorkerSecret(args.secret);
    return { uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

export const finalizeExternalCompletionPayload = action({
  args: {
    secret: v.string(),
    policyId: v.string(),
    leaseId: v.optional(v.string()),
    storageId: v.string(),
    byteLength: v.number(),
  },
  handler: async (ctx, args): Promise<CompletionPayloadSaveResult> => {
    requireExtractionWorkerSecret(args.secret);
    if (!await externalLeaseMatches(ctx, args)) {
      return {
        storageId: args.storageId,
        byteLength: args.byteLength,
        logSaved: false,
        logError: "Stale external extraction lease",
      };
    }
    await ctx.runMutation(internal.policies.pipelineSaveArtifact, {
      jobId: args.policyId,
      kind: "external_completion_payload",
      storageId: args.storageId as Id<"_storage">,
    });
    return {
      storageId: args.storageId,
      byteLength: args.byteLength,
      ...await appendPayloadSavedLog(ctx, args.policyId, args.byteLength),
    };
  },
});
