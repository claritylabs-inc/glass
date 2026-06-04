import dayjs from "dayjs";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

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

export const saveExternalCompletionPayload = action({
  args: {
    secret: v.string(),
    policyId: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args): Promise<{ storageId: string; byteLength: number }> => {
    requireExtractionWorkerSecret(args.secret);
    const json = JSON.stringify(args.payload);
    const byteLength = new TextEncoder().encode(json).byteLength;
    const storageId = String(await ctx.storage.store(new Blob([json], {
      type: "application/json",
    })));
    await ctx.runMutation(internal.policies.pipelineSaveArtifact, {
      jobId: args.policyId,
      kind: "external_completion_payload",
      storageId: storageId as Id<"_storage">,
    });
    await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
      jobId: args.policyId,
      timestamp: nowMs(),
      message: `Saved external extraction completion payload (${formatBytes(byteLength)})`,
      phase: "worker",
      level: byteLength >= 4 * 1024 * 1024 ? "warn" : "info",
    });
    return { storageId, byteLength };
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
    storageId: v.string(),
    byteLength: v.number(),
  },
  handler: async (ctx, args): Promise<{ storageId: string; byteLength: number }> => {
    requireExtractionWorkerSecret(args.secret);
    await ctx.runMutation(internal.policies.pipelineSaveArtifact, {
      jobId: args.policyId,
      kind: "external_completion_payload",
      storageId: args.storageId as Id<"_storage">,
    });
    await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
      jobId: args.policyId,
      timestamp: nowMs(),
      message: `Saved external extraction completion payload (${formatBytes(args.byteLength)})`,
      phase: "worker",
      level: args.byteLength >= 4 * 1024 * 1024 ? "warn" : "info",
    });
    return { storageId: args.storageId, byteLength: args.byteLength };
  },
});
