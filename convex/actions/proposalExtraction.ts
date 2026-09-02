"use node";

import { randomUUID } from "node:crypto";
import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

const internalApi = internal as any;
const LEASE_MS = 5 * 60 * 1000;
const STORAGE_BATCH_SIZE = 100;

function requireWorkerSecret(secret: string) {
  if (
    !process.env.EXTRACTION_WORKER_SECRET ||
    secret !== process.env.EXTRACTION_WORKER_SECRET
  ) {
    throw new Error("Unauthorized extraction worker");
  }
}

function normalizedVersion(value: string | undefined) {
  return value?.trim().replace(/^[~^=v]+/, "");
}

function compatibleWorker(args: {
  workerId?: string;
  workerProtocolVersion?: string;
  clSdkVersion?: string;
}) {
  const expectedProtocol =
    process.env.EXTRACTION_WORKER_EXPECTED_PROTOCOL_VERSION;
  const allowedProtocols =
    expectedProtocol === "source-tree-v2"
      ? new Set(["source-tree-v2"])
      : new Set(["source-tree-v1", "source-tree-v2"]);
  if (
    expectedProtocol &&
    (!args.workerProtocolVersion ||
      !allowedProtocols.has(args.workerProtocolVersion))
  ) {
    return false;
  }
  const expectedSdk = normalizedVersion(
    process.env.EXTRACTION_WORKER_EXPECTED_CL_SDK_VERSION,
  );
  return !expectedSdk || normalizedVersion(args.clSdkVersion) === expectedSdk;
}

async function deleteOtherProposalSources(
  ctx: any,
  proposalId: Id<"procurementProposals">,
  keepFingerprint: string,
) {
  for (const owner of [
    internalApi.proposalSourceSpans,
    internalApi.proposalSourceNodes,
  ]) {
    let done = false;
    while (!done) {
      const result = (await ctx.runMutation(
        owner.deleteOtherFingerprintsBatch,
        {
          proposalId,
          keepFingerprint,
          limit: STORAGE_BATCH_SIZE,
        },
      )) as { done: boolean };
      done = result.done;
    }
  }
}

function chunks<T>(values: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export const claimExternalJob = action({
  args: {
    secret: v.string(),
    workerId: v.optional(v.string()),
    workerVersion: v.optional(v.string()),
    workerProtocolVersion: v.optional(v.string()),
    clSdkVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.secret);
    if (!compatibleWorker(args)) return null;
    const leaseId = `${args.workerId ?? "worker"}:proposal:${randomUUID()}`;
    const leaseExpiresAt = dayjs().valueOf() + LEASE_MS;
    const claimed = await ctx.runMutation(
      internalApi.proposalExtraction.claimExternalJobInternal,
      {
        leaseId,
        leaseExpiresAt,
        workerId: args.workerId,
      },
    );
    if (!claimed) return null;

    const documents = [];
    for (const [order, document] of claimed.documents.entries()) {
      const fileUrl = await ctx.storage.getUrl(document.fileId);
      if (!fileUrl) {
        await ctx.runMutation(
          internalApi.proposalExtraction.failExternalJobInternal,
          {
            jobId: claimed.job._id,
            proposalId: claimed.job.proposalId,
            leaseId,
            extractionFingerprint: claimed.job.extractionFingerprint,
            error: `Could not resolve proposal document ${document.fileName}`,
          },
        );
        return null;
      }
      documents.push({
        proposalDocumentId: document._id,
        fileId: document.fileId,
        fileName: document.fileName,
        contentType: document.contentType,
        fileUrl,
        order,
      });
    }
    let modelSettings;
    try {
      modelSettings = await ctx.runQuery(
        internalApi.modelSettings.resolveForOrg,
        {
          orgId: claimed.job.clientOrgId,
        },
      );
    } catch {
      // Static routes remain available when a settings snapshot cannot be loaded.
    }
    return {
      jobId: claimed.job._id,
      proposalId: claimed.job.proposalId,
      leaseId,
      leaseExpiresAt,
      fingerprint: claimed.job.extractionFingerprint,
      orgId: claimed.job.clientOrgId,
      requestedByUserId: claimed.job.requestedByUserId,
      documents,
      modelSettings,
    };
  },
});

export const heartbeatExternalJob = action({
  args: {
    secret: v.string(),
    jobId: v.id("procurementProposalExtractionJobs"),
    leaseId: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.secret);
    const leaseExpiresAt = dayjs().valueOf() + LEASE_MS;
    const ok = await ctx.runMutation(
      internalApi.proposalExtraction.heartbeatExternalJobInternal,
      {
        jobId: args.jobId,
        leaseId: args.leaseId,
        leaseExpiresAt,
      },
    );
    return { ok, leaseExpiresAt };
  },
});

export const logExternalJob = action({
  args: {
    secret: v.string(),
    jobId: v.id("procurementProposalExtractionJobs"),
    leaseId: v.string(),
    message: v.string(),
    phase: v.optional(v.string()),
    level: v.optional(
      v.union(v.literal("info"), v.literal("warn"), v.literal("error")),
    ),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.secret);
    const ok = await ctx.runMutation(
      internalApi.proposalExtraction.recordLogInternal,
      {
        jobId: args.jobId,
        leaseId: args.leaseId,
        message: args.message,
        phase: args.phase,
        level: args.level,
      },
    );
    return { ok };
  },
});

export const createExternalCompletionUploadUrl = action({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.secret);
    return { uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

export const completeExternalJob = action({
  args: {
    secret: v.string(),
    jobId: v.id("procurementProposalExtractionJobs"),
    proposalId: v.id("procurementProposals"),
    leaseId: v.string(),
    extractionFingerprint: v.string(),
    payloadStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.secret);
    const accepted = await ctx.runQuery(
      internalApi.proposalExtraction.assertExternalCompletionInternal,
      {
        jobId: args.jobId,
        proposalId: args.proposalId,
        leaseId: args.leaseId,
        extractionFingerprint: args.extractionFingerprint,
      },
    );
    if (!accepted) return { ok: false };
    const blob = await ctx.storage.get(args.payloadStorageId);
    if (!blob) throw new Error("Proposal completion payload was not found");
    const payload = JSON.parse(await blob.text()) as Record<string, any>;
    if (
      payload.version !== "proposal-extraction-v1" ||
      payload.fingerprint !== args.extractionFingerprint ||
      !Array.isArray(payload.documents) ||
      !payload.aggregate
    )
      throw new Error("Invalid proposal completion payload");

    const knownDocuments = new Map<string, any>(
      accepted.documents.map((document: any) => [
        String(document._id),
        document,
      ]),
    );
    const now = dayjs().valueOf();
    const spans: any[] = [];
    const nodes: any[] = [];
    for (const extracted of payload.documents) {
      const proposalDocumentId = optionalString(extracted.proposalDocumentId);
      const document = proposalDocumentId
        ? knownDocuments.get(proposalDocumentId)
        : undefined;
      if (!document)
        throw new Error(
          "Completion payload references an unknown proposal document",
        );
      for (const span of Array.isArray(extracted.sourceSpans)
        ? extracted.sourceSpans
        : []) {
        const spanId = optionalString(span.id) ?? optionalString(span.spanId);
        const text = optionalString(span.text);
        const textHash =
          optionalString(span.textHash) ?? optionalString(span.hash);
        if (!spanId || !text || !textHash) continue;
        spans.push({
          orgId: accepted.job.clientOrgId,
          proposalId: args.proposalId,
          proposalDocumentId: document._id,
          extractionFingerprint: args.extractionFingerprint,
          documentId: optionalString(span.documentId) ?? proposalDocumentId,
          spanId,
          pageStart: optionalNumber(span.pageStart),
          pageEnd: optionalNumber(span.pageEnd),
          text,
          textHash,
          bbox: span.bbox,
          metadata: span.metadata,
          createdAt: now,
        });
      }
      for (const node of Array.isArray(extracted.sourceNodes)
        ? extracted.sourceNodes
        : []) {
        const nodeId = optionalString(node.id) ?? optionalString(node.nodeId);
        if (!nodeId) continue;
        nodes.push({
          orgId: accepted.job.clientOrgId,
          proposalId: args.proposalId,
          proposalDocumentId: document._id,
          extractionFingerprint: args.extractionFingerprint,
          documentId: optionalString(node.documentId) ?? proposalDocumentId,
          nodeId,
          parentNodeId:
            optionalString(node.parentId) ?? optionalString(node.parentNodeId),
          kind: optionalString(node.kind) ?? "text",
          title: optionalString(node.title) ?? "Source",
          textExcerpt: optionalString(node.textExcerpt),
          sourceSpanIds: stringArray(node.sourceSpanIds),
          pageStart: optionalNumber(node.pageStart),
          pageEnd: optionalNumber(node.pageEnd),
          order: optionalNumber(node.order) ?? nodes.length,
          path: optionalString(node.path) ?? String(nodes.length + 1),
          metadata: {
            ...(node.metadata && typeof node.metadata === "object"
              ? node.metadata
              : {}),
            ...(optionalString(node.description)
              ? { description: node.description }
              : {}),
            ...(node.bbox === undefined ? {} : { bbox: node.bbox }),
          },
          createdAt: now,
        });
      }
    }

    for (const batch of chunks(spans, STORAGE_BATCH_SIZE)) {
      await ctx.runMutation(internalApi.proposalSourceSpans.insertBatch, {
        spans: batch,
      });
    }
    for (const batch of chunks(nodes, STORAGE_BATCH_SIZE)) {
      await ctx.runMutation(internalApi.proposalSourceNodes.insertBatch, {
        nodes: batch,
      });
    }
    const ok = await ctx.runMutation(
      internalApi.proposalExtraction.completeExternalJobInternal,
      {
        jobId: args.jobId,
        proposalId: args.proposalId,
        leaseId: args.leaseId,
        extractionFingerprint: args.extractionFingerprint,
        completionPayloadStorageId: args.payloadStorageId,
        extractedOffer: payload.aggregate,
      },
    );
    if (ok) {
      try {
        await deleteOtherProposalSources(
          ctx,
          args.proposalId,
          args.extractionFingerprint,
        );
      } catch (error) {
        console.warn(
          "Could not remove superseded proposal source evidence",
          error,
        );
      }
    }
    return { ok };
  },
});

export const failExternalJob = action({
  args: {
    secret: v.string(),
    jobId: v.id("procurementProposalExtractionJobs"),
    proposalId: v.id("procurementProposals"),
    leaseId: v.string(),
    extractionFingerprint: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.secret);
    const ok = await ctx.runMutation(
      internalApi.proposalExtraction.failExternalJobInternal,
      {
        jobId: args.jobId,
        proposalId: args.proposalId,
        leaseId: args.leaseId,
        extractionFingerprint: args.extractionFingerprint,
        error: args.error,
      },
    );
    return { ok };
  },
});
