"use node";

import { randomUUID } from "crypto";
import dayjs from "dayjs";
import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { runPipeline } from "@claritylabs/cl-pipelines";
import {
  createConvexStorageAdapter,
  createConvexSchedulerAdapter,
} from "@claritylabs/cl-pipelines/convex";
import type { Phase, PhaseResult } from "@claritylabs/cl-pipelines";
import {
  buildExtractor,
  summarizeExtractionCheckpoint,
} from "../lib/extraction";
import { preparePdfTextWithDoclingFallback } from "../lib/doclingPreprocessor";
import type { ExtractionResult, ExtractionState, PipelineCheckpoint } from "../lib/extraction";
import type { ExtractOptions } from "../lib/extraction";
import { makeEmbedText, makeGenerateObject } from "../lib/sdkCallbacks";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  openExtractionReviewQuestions,
  postProcessExtractionDocument,
} from "../lib/extractionPostProcess";
import { z } from "zod";

const CANCELLED_BY_USER = "Cancelled by user";
const NON_INSURANCE_DOCUMENT_ERROR = "This document is not an insurance policy or quote, so extraction was stopped.";
const ADVANCE_LEASE_MS = 2 * 60 * 1000;
const ADVANCE_LEASE_HEARTBEAT_MS = 30 * 1000;
const ADVANCE_LEASE_WATCHDOG_GRACE_MS = 15 * 1000;
const EMBEDDING_CONCURRENCY = readBoundedIntEnv("EXTRACTION_EMBEDDING_CONCURRENCY", 8, 1, 16);
const CHECKPOINT_LOG_THRESHOLD_BYTES = 256 * 1024;
const EXTERNAL_WORKER_MODE = process.env.EXTRACTION_WORKER_MODE === "external";
const EXTERNAL_WORKER_LEASE_MS = readBoundedIntEnv(
  "EXTRACTION_WORKER_LEASE_MS",
  5 * 60 * 1000,
  60 * 1000,
  30 * 60 * 1000,
);

type StoredArtifact = {
  storageId: string;
  byteLength: number;
  durationMs: number;
};
type PipelineLogLevel = "info" | "warn" | "error";

type LeasedPolicyCheckpoint = {
  nextPhase: string;
  state: PolicyExtractionState;
  createdAt: number;
  lease?: {
    id: string;
    phase: string;
    expiresAt: number;
    heartbeatAt?: number;
  };
};

// ─── State Type ────────────────────────────────────────────────────────────────

export type PolicyExtractionState = {
  /** "upload" = direct file upload; "agent_email" = attachment forwarded to the email agent */
  sourceKind: "upload" | "agent_email";
  /** Convex storage ID of the PDF */
  fileId?: string;
  fileName?: string;
  orgId: string;
  userId: string;
  policyFileId?: string;
  traceId?: string;
  externalWorker?: boolean;
  /** Deprecated inline SDK checkpoint. Kept for legacy in-flight resumes. */
  clSdkCheckpoint?: PipelineCheckpoint<ExtractionState>;
  /** Storage-backed SDK checkpoint. Prevents near-1MB pipeline state documents. */
  clSdkCheckpointFileId?: string;
  chunkIds?: string[];
  sourceSpanIds?: string[];
  sourceChunkIds?: string[];
  /** Storage-backed embedding payload produced by extraction and consumed by embed_and_store. */
  embeddingPayloadFileId?: string;
  documentChunksForEmbedding?: Array<{
    id: string;
    type: string;
    text: string;
    metadata: Record<string, unknown>;
  }>;
  sourceSpansForStorage?: Array<{
    id: string;
    documentId?: string;
    sourceKind?: string;
    pageStart?: number;
    pageEnd?: number;
    sectionId?: string;
    formNumber?: string;
    text: string;
    textHash?: string;
    bbox?: unknown;
    metadata?: Record<string, unknown>;
  }>;
  sourceChunksForEmbedding?: Array<{
    id: string;
    documentId?: string;
    sourceSpanIds?: string[];
    text: string;
    metadata?: Record<string, unknown>;
  }>;
};

type EmbeddingPayload = Pick<
  PolicyExtractionState,
  "documentChunksForEmbedding" | "sourceSpansForStorage" | "sourceChunksForEmbedding"
>;

type ExternalClaimResult = {
  policyId: string;
  leaseId: string;
  leaseExpiresAt: number;
  state: PolicyExtractionState;
  fileUrl: string;
  clSdkCheckpoint?: PipelineCheckpoint<ExtractionState>;
  modelSettings?: {
    routes?: Record<string, { provider: string; model: string }>;
    providerKeys?: Record<string, string>;
  };
} | null;

type ExternalAckResult = {
  ok: boolean;
  leaseExpiresAt?: number;
  checkpointFileId?: string | undefined;
};

function readBoundedIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function nowMs(): number {
  return dayjs().valueOf();
}

async function startTraceSession(
  ctx: ActionCtx,
  args: {
    traceId: string;
    policyId: Id<"policies">;
    orgId: Id<"organizations">;
    userId: Id<"users">;
    sourceKind: PolicyExtractionState["sourceKind"];
    trigger: string;
    fileName?: string;
  },
) {
  try {
    await ctx.runMutation((internal as any).extractionTraces.startSession, args);
  } catch {
    // Extraction telemetry must not block extraction.
  }
}

async function traceEvent(
  ctx: ActionCtx,
  traceId: string | undefined,
  event: {
    kind: "session" | "phase" | "log" | "model_call" | "embedding_batch" | "worker" | "artifact";
    phase?: string;
    level?: string;
    message?: string;
    label?: string;
    task?: string;
    taskKind?: string;
    provider?: string;
    model?: string;
    routeSource?: string;
    transport?: string;
    attempt?: number;
    status?: string;
    durationMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    error?: string;
    details?: unknown;
  },
) {
  if (!traceId) return;
  try {
    await ctx.runMutation((internal as any).extractionTraces.recordEvent, {
      traceId,
      ...event,
    });
  } catch {
    // Extraction telemetry must not block extraction.
  }
}

async function completeTraceSession(
  ctx: ActionCtx,
  traceId: string | undefined,
  status: "complete" | "error" | "cancelled",
  error?: string,
) {
  if (!traceId) return;
  try {
    await ctx.runMutation((internal as any).extractionTraces.completeSession, {
      traceId,
      status,
      error,
    });
  } catch {
    // Extraction telemetry must not block extraction.
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function requireExtractionWorkerSecret(secret: string): void {
  const expected = process.env.EXTRACTION_WORKER_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("Unauthorized extraction worker");
  }
}

function compactClSdkCheckpoint(
  checkpoint: PipelineCheckpoint<ExtractionState>,
): {
  checkpoint: PipelineCheckpoint<ExtractionState>;
  omittedDocument: boolean;
} {
  const raw = checkpoint as PipelineCheckpoint<ExtractionState> & {
    state?: Record<string, unknown>;
  };

  // The SDK can checkpoint the assembled document alongside extraction memory.
  // Memory is sufficient to resume and reassemble, while storing both can push
  // the JSON artifact close to Convex's practical size/timeout limits.
  if (checkpoint.phase !== "assemble" || !raw.state || raw.state.document === undefined) {
    return { checkpoint, omittedDocument: false };
  }

  const { document: _document, ...stateWithoutDocument } = raw.state;
  return {
    checkpoint: {
      ...checkpoint,
      state: stateWithoutDocument as ExtractionState,
    },
    omittedDocument: true,
  };
}

async function runBounded<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function isExtractionCancelled(
  ctx: ActionCtx,
  policyId: string,
): Promise<boolean> {
  const policy = await ctx.runQuery(internal.policies.getInternal, {
    id: policyId as Id<"policies">,
  });
  return policy?.pipelineError === CANCELLED_BY_USER;
}

function isCancelledError(error: unknown): boolean {
  return error instanceof Error && error.message === CANCELLED_BY_USER;
}

async function loadPdfBytes(
  ctx: ActionCtx,
  fileId: string,
): Promise<Uint8Array | null> {
  const blob = await ctx.storage.get(fileId as Id<"_storage">);
  if (!blob) return null;
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

async function storeJsonArtifact(
  ctx: ActionCtx,
  jobId: string,
  kind: "cl_sdk_checkpoint" | "embedding_payload",
  value: unknown,
): Promise<StoredArtifact> {
  const json = JSON.stringify(value);
  const byteLength = new TextEncoder().encode(json).byteLength;
  const startedAt = nowMs();
  const blob = new Blob([json], {
    type: "application/json",
  });
  const storageId = String(await ctx.storage.store(blob));
  await ctx.runMutation(internal.policies.pipelineSaveArtifact, {
    jobId,
    kind,
    storageId: storageId as Id<"_storage">,
  });
  return {
    storageId,
    byteLength,
    durationMs: nowMs() - startedAt,
  };
}

async function loadJsonArtifact<T>(
  ctx: ActionCtx,
  storageId: string | undefined,
): Promise<T | undefined> {
  if (!storageId) return undefined;
  const blob = await ctx.storage.get(storageId as Id<"_storage">);
  if (!blob) return undefined;
  return JSON.parse(await blob.text()) as T;
}

async function getLatestArtifactStorageId(
  ctx: ActionCtx,
  jobId: string,
  kind: "cl_sdk_checkpoint" | "embedding_payload",
): Promise<string | undefined> {
  const artifact = await ctx.runQuery(internal.policies.pipelineGetArtifact, {
    jobId,
    kind,
  }) as { storageId?: string } | null;
  return artifact?.storageId ? String(artifact.storageId) : undefined;
}

async function loadClSdkCheckpoint(
  ctx: ActionCtx,
  jobId: string,
  state: PolicyExtractionState,
): Promise<PipelineCheckpoint<ExtractionState> | undefined> {
  if (state.clSdkCheckpoint) return state.clSdkCheckpoint;
  const storageId = state.clSdkCheckpointFileId
    ?? await getLatestArtifactStorageId(ctx, jobId, "cl_sdk_checkpoint");
  return await loadJsonArtifact<PipelineCheckpoint<ExtractionState>>(ctx, storageId);
}

async function storeEmbeddingPayload(
  ctx: ActionCtx,
  jobId: string,
  payload: EmbeddingPayload,
): Promise<string> {
  return (await storeJsonArtifact(ctx, jobId, "embedding_payload", payload)).storageId;
}

async function storeClSdkCheckpoint(
  ctx: ActionCtx,
  jobId: string,
  checkpoint: PipelineCheckpoint<ExtractionState>,
  log?: (message: string, level?: PipelineLogLevel) => Promise<void>,
): Promise<string> {
  const compacted = compactClSdkCheckpoint(checkpoint);
  const stored = await storeJsonArtifact(
    ctx,
    jobId,
    "cl_sdk_checkpoint",
    compacted.checkpoint,
  );

  const shouldLog =
    compacted.omittedDocument ||
    stored.byteLength >= CHECKPOINT_LOG_THRESHOLD_BYTES ||
    stored.durationMs >= 1000;
  if (shouldLog && log) {
    const compactNote = compacted.omittedDocument ? "; omitted assembled document" : "";
    await log(
      `Saved cl-sdk ${checkpoint.phase} checkpoint (${formatBytes(stored.byteLength)} in ${stored.durationMs}ms${compactNote})`,
      stored.byteLength >= 900 * 1024 ? "warn" : "info",
    );
  }

  return stored.storageId;
}

async function loadEmbeddingPayload(
  ctx: ActionCtx,
  jobId: string,
  state: PolicyExtractionState,
): Promise<EmbeddingPayload> {
  if (
    state.documentChunksForEmbedding ||
    state.sourceSpansForStorage ||
    state.sourceChunksForEmbedding
  ) {
    return {
      documentChunksForEmbedding: state.documentChunksForEmbedding,
      sourceSpansForStorage: state.sourceSpansForStorage,
      sourceChunksForEmbedding: state.sourceChunksForEmbedding,
    };
  }
  const storageId = state.embeddingPayloadFileId
    ?? await getLatestArtifactStorageId(ctx, jobId, "embedding_payload");
  return await loadJsonArtifact<EmbeddingPayload>(ctx, storageId) ?? {};
}

async function clearArtifacts(
  ctx: ActionCtx,
  jobId: string,
  kind?: "cl_sdk_checkpoint" | "embedding_payload",
): Promise<void> {
  await ctx.runMutation(internal.policies.pipelineClearArtifacts, {
    jobId,
    ...(kind ? { kind } : {}),
  });
}

function stripLease(
  checkpoint: LeasedPolicyCheckpoint,
): Omit<LeasedPolicyCheckpoint, "lease"> {
  const { lease: _lease, ...rest } = checkpoint;
  return rest;
}


const extractionGateSchema = z.object({
  shouldExtract: z.boolean(),
  classification: z.enum([
    "insurance_policy_or_quote",
    "insurance_related_but_not_policy_or_quote",
    "non_insurance",
    "unknown",
  ]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  detectedTitle: z.string().nullable(),
});

type ExtractionGateDecision = z.infer<typeof extractionGateSchema>;

function buildDocumentGateExcerpt(
  sourceSpans: Array<{ pageStart?: number; text: string; metadata?: Record<string, unknown> }>,
): string {
  const pageSpans = sourceSpans.filter((span) => span.metadata?.sourceUnit !== "section_candidate");
  const uniquePages = new Set<number>();
  const excerpts: string[] = [];

  for (const span of pageSpans) {
    const page = typeof span.pageStart === "number" ? span.pageStart : excerpts.length + 1;
    if (uniquePages.has(page)) continue;
    uniquePages.add(page);
    const text = span.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    excerpts.push(`Page ${page}: ${text.slice(0, 1200)}`);
    if (excerpts.join("\n\n").length >= 7000 || uniquePages.size >= 8) break;
  }

  return excerpts.join("\n\n") || "No machine-readable text was extracted from the PDF.";
}

async function classifyInsuranceExtractability(params: {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  traceId?: string;
  policyId?: string;
  pdfBytes: Uint8Array;
  sourceSpans: Array<{ pageStart?: number; text: string; metadata?: Record<string, unknown> }>;
}): Promise<ExtractionGateDecision> {
  const generateGateObject = makeGenerateObject("classification", {
    ctx: params.ctx,
    orgId: params.orgId,
    traceId: params.traceId,
    tracePolicyId: params.policyId,
  });
  const excerpt = buildDocumentGateExcerpt(params.sourceSpans);
  const result = await generateGateObject({
    schema: extractionGateSchema,
    maxTokens: 600,
    system: `You are a strict intake gate for Glass insurance extraction.

Decide whether an uploaded PDF should be processed by a policy/quote extractor. Only allow extraction when the document is clearly an insurance policy, quote, binder, declarations page, renewal proposal, insurance schedule, policy wording, or endorsement/supplement that contains policy or quote terms.

Reject novels, books, textbooks, resumes, invoices, generic contracts, marketing material, unrelated legal documents, and any document that is merely about insurance but is not itself a policy or quote artifact. If uncertain, return classification "unknown" and shouldExtract false only when the document is more likely not extractable than extractable.`,
    prompt: `Classify this PDF before extraction.

Return shouldExtract=true only for insurance policy/quote artifacts.

Machine-readable excerpts:
${excerpt}`,
    providerOptions: {
      pdfBytes: params.pdfBytes,
      mimeType: "application/pdf",
    },
  });
  return result.object as ExtractionGateDecision;
}

function shouldRejectDocument(decision: ExtractionGateDecision): boolean {
  if (decision.classification === "insurance_policy_or_quote" && decision.shouldExtract) {
    return false;
  }
  if (decision.classification === "non_insurance" && decision.confidence >= 0.5) {
    return true;
  }
  if (decision.classification === "insurance_related_but_not_policy_or_quote" && decision.confidence >= 0.65) {
    return true;
  }
  return !decision.shouldExtract && decision.confidence >= 0.7;
}

async function notifyExtractionReviewRequired(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    policyId: string;
    policyNumber?: string;
    carrier?: string;
    questionCount: number;
  },
) {
  const label = args.policyNumber && args.policyNumber !== "Unknown"
    ? `policy ${args.policyNumber}`
    : args.carrier
      ? `${args.carrier} policy`
      : "a policy";
  await ctx.runMutation((internal as any).lib.notify.notifyInternal, {
    orgId: args.orgId,
    type: "incomplete_extraction",
    title: "Policy extraction needs review",
    body: `Glass finished extracting ${label}, but ${args.questionCount} coverage ${args.questionCount === 1 ? "term needs" : "terms need"} review.`,
    severity: "warning",
    actionType: "view_policy",
    actionPayload: { policyId: args.policyId, tab: "review" },
    sourceRef: { policyId: args.policyId, kind: "extraction_review" },
  });
}

async function advanceLeasedPhase(
  ctx: ActionCtx,
  jobId: string,
  phases: Phase<PolicyExtractionState>[],
): Promise<void> {
  const leaseId = randomUUID();
  const leaseExpiresAt = Date.now() + ADVANCE_LEASE_MS;
  const checkpoint = await ctx.runMutation(
    internal.policies.pipelineAcquireLease,
    { jobId, leaseId, leaseExpiresAt },
  ) as LeasedPolicyCheckpoint | null;

  if (!checkpoint) return;
  const traceId = checkpoint.state?.traceId;

  const scheduleWatchdog = async (expiresAt: number) => {
    await ctx.scheduler.runAfter(
      Math.max(0, expiresAt - Date.now() + ADVANCE_LEASE_WATCHDOG_GRACE_MS),
      internal.actions.policyExtraction.advance,
      { jobId },
    );
  };

  await scheduleWatchdog(leaseExpiresAt);

  const phase = phases.find((p) => p.name === checkpoint.nextPhase);
  if (!phase) {
    await ctx.runMutation(internal.policies.pipelineCompleteLease, {
      jobId,
      leaseId,
      status: "error",
      error: `Unknown phase: ${checkpoint.nextPhase}`,
      checkpoint: stripLease(checkpoint),
    });
    return;
  }

  let latestCheckpoint = stripLease(checkpoint);
  const saveState = async (state: PolicyExtractionState) => {
    const createdAt = Date.now();
    const ok = await ctx.runMutation(
      internal.policies.pipelineSaveStateForLease,
      {
        jobId,
        leaseId,
        nextPhase: phase.name,
        state,
        leaseExpiresAt: createdAt + ADVANCE_LEASE_MS,
      },
    );
    if (!ok) {
      throw new Error("Pipeline phase lease lost");
    }
    await scheduleWatchdog(createdAt + ADVANCE_LEASE_MS);
    latestCheckpoint = {
      nextPhase: phase.name,
      state,
      createdAt,
    };
  };

  const log = async (message: string, level: string = "info") => {
    const timestamp = Date.now();
    await ctx.runMutation(internal.policies.pipelineAppendLog, {
      jobId,
      timestamp,
      message,
      phase: phase.name,
      level,
    });
  };

  let heartbeatInFlight = false;
  let heartbeatPromise: Promise<void> | null = null;
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    heartbeatPromise = (async () => {
      try {
        const nextExpiresAt = Date.now() + ADVANCE_LEASE_MS;
        const ok = await ctx.runMutation(internal.policies.pipelineExtendLease, {
          jobId,
          leaseId,
          leaseExpiresAt: nextExpiresAt,
        });
        if (ok) {
          await scheduleWatchdog(nextExpiresAt);
        }
      } catch {
        // The phase will fail its next checkpoint/complete call if the lease was lost.
      } finally {
        heartbeatInFlight = false;
      }
    })();
  }, ADVANCE_LEASE_HEARTBEAT_MS);

  try {
    const result = await phase.run({
      jobId,
      checkpoint: stripLease(checkpoint),
      log,
      saveState,
    });

    if (result.kind === "done") {
      await ctx.runMutation(internal.policies.pipelineCompleteLease, {
        jobId,
        leaseId,
        status: "complete",
        error: null,
        checkpoint: null,
      });
      await completeTraceSession(ctx, traceId, "complete");
      return;
    }

    if (result.kind === "error") {
      await ctx.runMutation(internal.policies.pipelineCompleteLease, {
        jobId,
        leaseId,
        status: "error",
        error: result.error,
        checkpoint: latestCheckpoint,
      });
      await completeTraceSession(
        ctx,
        traceId,
        result.error === CANCELLED_BY_USER ? "cancelled" : "error",
        result.error,
      );
      return;
    }

    const checkpointUpdated = await ctx.runMutation(
      internal.policies.pipelineCompleteLease,
      {
        jobId,
        leaseId,
        checkpoint: {
          nextPhase: result.nextPhase,
          state: result.state,
          createdAt: Date.now(),
        },
      },
    );
    if (checkpointUpdated) {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.policyExtraction.advance,
        { jobId },
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await log(`Phase "${phase.name}" threw: ${msg}`, "error");
    await ctx.runMutation(internal.policies.pipelineCompleteLease, {
      jobId,
      leaseId,
      status: "error",
      error: msg,
      checkpoint: latestCheckpoint,
    });
    await completeTraceSession(
      ctx,
      traceId,
      msg === CANCELLED_BY_USER ? "cancelled" : "error",
      msg,
    );
  } finally {
    clearInterval(heartbeat);
    if (heartbeatPromise) {
      await heartbeatPromise;
    }
  }
}

// ─── Convex mutations ref builder ──────────────────────────────────────────────

function makeMutations() {
  return {
    getJob: internal.policies.pipelineGetJob,
    setStatus: internal.policies.pipelineSetStatus,
    setCheckpoint: internal.policies.pipelineSetCheckpoint,
    appendLog: internal.policies.pipelineAppendLog,
    clearLog: internal.policies.pipelineClearLog,
  };
}

// ─── Phase factory ─────────────────────────────────────────────────────────────

export function makePhases(convexCtx: ActionCtx): Phase<PolicyExtractionState>[] {
  // ── Phase 1: load_pdf ─────────────────────────────────────────────────────────
  const loadPdfPhase: Phase<PolicyExtractionState> = {
    name: "load_pdf",
    run: async (pCtx): Promise<PhaseResult<PolicyExtractionState>> => {
      const { state } = pCtx.checkpoint;
      if (await isExtractionCancelled(convexCtx, pCtx.jobId)) {
        return { kind: "error", error: CANCELLED_BY_USER };
      }

      if (!state.fileId) {
        return { kind: "error", error: "load_pdf: missing fileId" };
      }
      await pCtx.log("Loading PDF from storage…");
      const pdfBytes = await loadPdfBytes(convexCtx, state.fileId);
      if (!pdfBytes) return { kind: "error", error: "File not found in storage" };
      await pCtx.log(`PDF ready for extraction (${pdfBytes.byteLength} bytes)`);
      return { kind: "next", nextPhase: "extract", state };
    },
  };

  // ── Phase 2: extract ──────────────────────────────────────────────────────────
  // Wraps cl-sdk buildExtractor. cl-sdk's internal checkpoint is the ONLY state
  // this phase carries on cl-pipelines' checkpoint.
  const extractPhase: Phase<PolicyExtractionState> = {
    name: "extract",
    run: async (pCtx): Promise<PhaseResult<PolicyExtractionState>> => {
      const { state } = pCtx.checkpoint;
      if (await isExtractionCancelled(convexCtx, pCtx.jobId)) {
        return { kind: "error", error: CANCELLED_BY_USER };
      }

      if (!state.fileId) {
        return { kind: "error", error: "extract: missing fileId — load_pdf phase must run first" };
      }

      await pCtx.log("Starting policy extraction…");

      const pdfBytes = await loadPdfBytes(convexCtx, state.fileId);
      if (!pdfBytes) return { kind: "error", error: "File not found in storage" };

      const policyId = pCtx.jobId;
      const clSdkCheckpoint = await loadClSdkCheckpoint(convexCtx, policyId, state);
      const pdfSource = await preparePdfTextWithDoclingFallback({
        pdfBytes,
        documentId: policyId,
        sourceKind: "policy_pdf",
      });
      if (pdfSource.sourceSpans.length > 0) {
        await pCtx.log(`Prepared ${pdfSource.sourceSpans.length} ${pdfSource.parserBackend} source spans for source-grounded extraction`);
      }

      if (clSdkCheckpoint) {
        await pCtx.log(`Resuming extraction from cl-sdk phase "${clSdkCheckpoint.phase}"…`);
      } else {
        await pCtx.log("Checking whether the PDF is an insurance policy or quote…");
        try {
          const gateDecision = await classifyInsuranceExtractability({
            ctx: convexCtx,
            orgId: state.orgId as Id<"organizations">,
            traceId: state.traceId,
            policyId,
            pdfBytes,
            sourceSpans: pdfSource.sourceSpans,
          });
          await pCtx.log(
            `Document gate: ${gateDecision.classification} (${Math.round(gateDecision.confidence * 100)}% confidence) — ${gateDecision.reason}`,
          );

          if (shouldRejectDocument(gateDecision)) {
            const rejectionSummary = `${NON_INSURANCE_DOCUMENT_ERROR} ${gateDecision.reason}`.slice(0, 1000);
            await convexCtx.runMutation(
              (internal as any).policies.updateExtractionInternal,
              {
                id: policyId,
                fields: {
                  carrier: "Non-insurance document",
                  policyNumber: "Not applicable",
                  policyTypes: ["other"],
                  insuredName: "Not applicable",
                  effectiveDate: "Not applicable",
                  expirationDate: "Not applicable",
                  summary: rejectionSummary,
                  excludeFromSearch: true,
                },
              },
            );

            if (state.fileId) {
              await convexCtx.runMutation((internal as any).policies.updateFiles, {
                id: policyId,
                files: [
                  {
                    fileId: state.fileId as Id<"_storage">,
                    fileName: state.fileName || "upload.pdf",
                    fileType: "unknown",
                    status: "not_insurance",
                  },
                ],
                reconciliationStatus: "error" as const,
              });
            }

            return { kind: "error", error: rejectionSummary };
          }
        } catch (error) {
          await pCtx.log(
            `Warning: document gate failed; continuing extraction (${error instanceof Error ? error.message : String(error)})`,
            "warn",
          );
        }
      }

      const extractor = buildExtractor({
        ctx: convexCtx,
        orgId: state.orgId as Id<"organizations">,
        traceId: state.traceId,
        tracePolicyId: policyId,
        log: async (msg) => { await pCtx.log(msg); },
        onProgress: async (msg) => { await pCtx.log(msg); },
        shouldCancel: async () => isExtractionCancelled(convexCtx, policyId),
        onCheckpointSave: async (cp) => {
          if (await isExtractionCancelled(convexCtx, policyId)) {
            throw new Error(CANCELLED_BY_USER);
          }
          // Route cl-sdk's checkpoint through cl-pipelines' saveState, storing
          // the large checkpoint payload outside the hot runtime document.
          if (cp.phase === "assemble") {
            await pCtx.log("Saving compact assemble checkpoint...");
          }
          const checkpointFileId = await storeClSdkCheckpoint(convexCtx, policyId, cp, pCtx.log);
          await pCtx.saveState({
            ...state,
            clSdkCheckpoint: undefined,
            clSdkCheckpointFileId: checkpointFileId,
          });
          if (cp.phase === "assemble") {
            await pCtx.log("Assemble checkpoint saved; continuing with summary and formatting...");
          }
        },
      });

      const extractOptions: ExtractOptions = {
        ...(clSdkCheckpoint ? { resumeFrom: clSdkCheckpoint } : {}),
        ...(pdfSource.sourceSpans.length > 0
          ? { sourceSpans: pdfSource.sourceSpans as Array<Record<string, any>> }
          : {}),
      };

      let result: ExtractionResult;
      try {
        result = await extractor.extract(
          pdfSource.doclingDocument
            ? {
                kind: "docling_document",
                document: pdfSource.doclingDocument,
                sourceKind: "policy_pdf",
              }
            : pdfBytes,
          policyId,
          extractOptions,
        );
      } catch (error) {
        if (isCancelledError(error)) {
          await pCtx.log("Extraction cancelled by user", "warn");
          return { kind: "error", error: CANCELLED_BY_USER };
        }
        throw error;
      }

      if (await isExtractionCancelled(convexCtx, pCtx.jobId)) {
        return { kind: "error", error: CANCELLED_BY_USER };
      }

      if (result.checkpoint) {
        const checkpointFileId = await storeClSdkCheckpoint(
          convexCtx,
          policyId,
          result.checkpoint,
          pCtx.log,
        );
        await pCtx.saveState({
          ...state,
          clSdkCheckpoint: undefined,
          clSdkCheckpointFileId: checkpointFileId,
        });
      }

      const resultSourceSpans = Array.isArray((result as any).sourceSpans)
        ? (result as any).sourceSpans as Array<Record<string, any>>
        : [];
      const resultSourceChunks = Array.isArray((result as any).sourceChunks)
        ? (result as any).sourceChunks as Array<Record<string, any>>
        : [];
      const sourceSpans = resultSourceSpans.length > 0
        ? resultSourceSpans
        : pdfSource.sourceSpans as Array<Record<string, any>>;
      const sourceChunks = resultSourceChunks.length > 0
        ? resultSourceChunks
        : pdfSource.sourceChunks as Array<Record<string, any>>;
      const chunks = result.chunks;
      const tokenUsage = result.tokenUsage;

      await pCtx.log(
        `Extraction complete. Type: ${(result.document as Record<string, unknown>).type}. ${chunks.length} chunks, ${sourceSpans.length} source spans. Tokens: ${tokenUsage.inputTokens}in/${tokenUsage.outputTokens}out`,
      );
      if (result.performanceReport) {
        const totalSeconds = Math.round(result.performanceReport.totalModelCallDurationMs / 1000);
        await pCtx.log(
          `Extraction model calls: ${result.performanceReport.modelCalls.length}; total model time: ${totalSeconds}s`,
        );
      }
      for (const line of summarizeExtractionCheckpoint(result)) {
        await pCtx.log(line);
      }

      const processed = await postProcessExtractionDocument({
        ctx: convexCtx,
        orgId: state.orgId as Id<"organizations">,
        document: result.document as Record<string, unknown>,
        sourceSpans: [...sourceSpans, ...(pdfSource.sourceSpans as Array<Record<string, any>>)],
        log: async (message, level) => { await pCtx.log(message, level); },
      });
      result.document = processed.document as typeof result.document;
      const doc = processed.document;
      const fields = processed.fields;
      const docName = doc.type === "quote"
        ? (doc.quoteNumber || "quote")
        : (doc.policyNumber || "policy");
      const resolvedFileName = state.fileName || `${String(docName)}.pdf`;

      await convexCtx.runMutation(
        (internal as any).policies.updateExtractionInternal,
        {
          id: policyId,
          fields: {
            fileName: resolvedFileName,
            ...fields,
          },
        },
      );

      // Update policyFiles record if present
      if (state.policyFileId) {
        await convexCtx.runMutation(
          (internal as any).policyFiles.updateExtraction,
          {
            id: state.policyFileId,
            extractedData: result.document,
          },
        );
      }

      const embeddingPayloadFileId = await storeEmbeddingPayload(convexCtx, policyId, {
        documentChunksForEmbedding: chunks,
        sourceSpansForStorage: sourceSpans as PolicyExtractionState["sourceSpansForStorage"],
        sourceChunksForEmbedding: sourceChunks as PolicyExtractionState["sourceChunksForEmbedding"],
      });
      const chunkIds = chunks.map((c: { id: string }) => c.id);
      const nextState: PolicyExtractionState = {
        ...state,
        clSdkCheckpoint: undefined, // clear — extraction done
        clSdkCheckpointFileId: undefined,
        embeddingPayloadFileId,
        chunkIds,
        sourceSpanIds: sourceSpans.map((span) => String(span.id)),
        sourceChunkIds: sourceChunks.map((chunk) => String(chunk.id)),
        fileName: resolvedFileName,
      };

      return { kind: "next", nextPhase: "embed_and_store", state: nextState };
    },
  };

  // ── Phase 3: embed_and_store ──────────────────────────────────────────────────
  const embedAndStorePhase: Phase<PolicyExtractionState> = {
    name: "embed_and_store",
    run: async (pCtx): Promise<PhaseResult<PolicyExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const policyId = pCtx.jobId;
      if (await isExtractionCancelled(convexCtx, policyId)) {
        return { kind: "error", error: CANCELLED_BY_USER };
      }

      const embeddingPayload = await loadEmbeddingPayload(convexCtx, policyId, state);
      const chunks = embeddingPayload.documentChunksForEmbedding;
      const sourceSpans = embeddingPayload.sourceSpansForStorage;
      const sourceChunks = embeddingPayload.sourceChunksForEmbedding;

      if (!chunks || chunks.length === 0) {
        await pCtx.log("No chunks to embed (phase resumed or no chunks extracted)");
      } else {
        await pCtx.log(`Embedding ${chunks.length} chunks for vector search…`);
        await convexCtx.runMutation(
          (internal as any).documentChunks.deleteByPolicy,
          { policyId },
        );
        const embed = makeEmbedText(convexCtx, state.orgId as Id<"organizations">);
        let embedded = 0;
        let embedFailures = 0;
        const embedStartedAt = nowMs();
        await runBounded(chunks, EMBEDDING_CONCURRENCY, async (chunk) => {
          if (await isExtractionCancelled(convexCtx, policyId)) {
            throw new Error(CANCELLED_BY_USER);
          }
          try {
            const embedding = await embed(chunk.text);
            await convexCtx.runMutation(
              (internal as any).documentChunks.insert,
              {
                orgId: state.orgId,
                policyId,
                chunkId: chunk.id,
                chunkType: chunk.type,
                text: chunk.text,
                metadata: chunk.metadata,
                embedding,
                createdAt: Date.now(),
              },
            );
            embedded++;
          } catch (err) {
            if (isCancelledError(err)) throw err;
            embedFailures++;
            await pCtx.log(
              `Warning: failed to embed chunk ${chunk.id}: ${err instanceof Error ? err.message : String(err)}`,
              "warn",
            );
          }
        });
        await traceEvent(convexCtx, state.traceId, {
          kind: "embedding_batch",
          label: "document chunks",
          task: "embeddings",
          provider: "openai",
          model: "text-embedding-3-small",
          status: embedFailures > 0 ? "partial" : "complete",
          durationMs: nowMs() - embedStartedAt,
          details: {
            requested: chunks.length,
            embedded,
            failures: embedFailures,
          },
        });
        await pCtx.log(`Stored ${embedded}/${chunks.length} chunks`);
      }

      if (sourceSpans?.length || sourceChunks?.length) {
        await pCtx.log(`Storing ${sourceSpans?.length ?? 0} source spans and ${sourceChunks?.length ?? 0} source chunks…`);
        await convexCtx.runMutation(
          (internal as any).sourceSpans.deleteByPolicy,
          { policyId },
        );

        for (const span of sourceSpans ?? []) {
          await convexCtx.runMutation(
            (internal as any).sourceSpans.insertSpan,
            {
              orgId: state.orgId,
              policyId,
              spanId: span.id,
              documentId: span.documentId ?? policyId,
              sourceKind: span.sourceKind ?? "policy_pdf",
              pageStart: span.pageStart,
              pageEnd: span.pageEnd,
              sectionId: span.sectionId,
              formNumber: span.formNumber,
              text: span.text,
              textHash: span.textHash ?? span.id,
              bbox: span.bbox,
              metadata: span.metadata,
              createdAt: Date.now(),
            },
          );
        }

        if (sourceChunks?.length) {
          const embed = makeEmbedText(convexCtx, state.orgId as Id<"organizations">);
          let embeddedSourceChunks = 0;
          let sourceChunkFailures = 0;
          const sourceEmbedStartedAt = nowMs();
          await runBounded(sourceChunks, EMBEDDING_CONCURRENCY, async (chunk) => {
            if (await isExtractionCancelled(convexCtx, policyId)) {
              throw new Error(CANCELLED_BY_USER);
            }
            try {
              const embedding = await embed(chunk.text);
              await convexCtx.runMutation(
                (internal as any).sourceSpans.insertChunk,
                {
                  orgId: state.orgId,
                  policyId,
                  chunkId: chunk.id,
                  documentId: chunk.documentId ?? policyId,
                  sourceSpanIds: chunk.sourceSpanIds ?? [],
                  text: chunk.text,
                  metadata: chunk.metadata,
                  embedding,
                  createdAt: Date.now(),
                },
              );
              embeddedSourceChunks++;
            } catch (err) {
              if (isCancelledError(err)) throw err;
              sourceChunkFailures++;
              await pCtx.log(
                `Warning: failed to embed source chunk ${chunk.id}: ${err instanceof Error ? err.message : String(err)}`,
                "warn",
              );
            }
          });
          await traceEvent(convexCtx, state.traceId, {
            kind: "embedding_batch",
            label: "source chunks",
            task: "embeddings",
            provider: "openai",
            model: "text-embedding-3-small",
            status: sourceChunkFailures > 0 ? "partial" : "complete",
            durationMs: nowMs() - sourceEmbedStartedAt,
            details: {
              requested: sourceChunks.length,
              embedded: embeddedSourceChunks,
              failures: sourceChunkFailures,
            },
          });
          await pCtx.log(`Stored ${embeddedSourceChunks}/${sourceChunks.length} source chunks`);
        }
      }

      await clearArtifacts(convexCtx, policyId, "embedding_payload");
      await clearArtifacts(convexCtx, policyId, "cl_sdk_checkpoint");

      // Drop the raw chunks from state after durable storage.
      const {
        documentChunksForEmbedding: _dropped,
        sourceSpansForStorage: _droppedSpans,
        sourceChunksForEmbedding: _droppedSourceChunks,
        embeddingPayloadFileId: _droppedEmbeddingPayload,
        ...cleanState
      } = state;
      return { kind: "next", nextPhase: "post_process", state: cleanState };
    },
  };

  // ── Phase 4: post_process (terminal — schedules downstream work) ──────────────
  const postProcessPhase: Phase<PolicyExtractionState> = {
    name: "post_process",
    run: async (pCtx): Promise<PhaseResult<PolicyExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const policyId = pCtx.jobId;
      if (await isExtractionCancelled(convexCtx, policyId)) {
        return { kind: "error", error: CANCELLED_BY_USER };
      }

      // Audit log
      try {
        await convexCtx.runMutation(
          (internal as any).policyAuditLog.append,
          {
            policyId,
            userId: state.userId,
            orgId: state.orgId,
            action: "extraction_complete",
          },
        );
      } catch { /* non-critical */ }

      // Broker activity record
      try {
        const finalPolicy = await convexCtx.runQuery(
          internal.policies.getInternal,
          { id: policyId as any },
        ) as {
          uploadedByBrokerOrgId?: string;
          orgId?: string;
          documentType?: string;
          uploadedBySide?: string;
          extractionReview?: unknown;
          policyNumber?: string;
          carrier?: string;
        } | null;
        if (finalPolicy?.uploadedByBrokerOrgId && finalPolicy.orgId) {
          const docType = (finalPolicy.documentType ?? "policy") as "policy" | "quote";
          await convexCtx.runMutation(
            (internal as any).brokerActivity.record,
            {
              brokerOrgId: finalPolicy.uploadedByBrokerOrgId,
              clientOrgId: finalPolicy.orgId,
              type: "policy_extraction_completed" as const,
              actorSide: "system" as const,
              payload: { policyId, documentType: docType, uploadedBySide: finalPolicy.uploadedBySide ?? "client" },
              summary: `${docType === "quote" ? "Quote" : "Policy"} extraction completed`,
            },
          );
        }
        if (finalPolicy?.orgId) {
          await convexCtx.runMutation(
            (internal as any).declarationFacts.syncPolicyInternal,
            { policyId },
          );
          await convexCtx.runMutation(
            (internal as any).declarationFacts.scanOrgInternal,
            { orgId: finalPolicy.orgId, notifyExternal: true },
          );
          const reviewQuestions = openExtractionReviewQuestions(finalPolicy.extractionReview);
          if (reviewQuestions.length > 0) {
            await notifyExtractionReviewRequired(convexCtx, {
              orgId: finalPolicy.orgId as Id<"organizations">,
              policyId,
              policyNumber: finalPolicy.policyNumber,
              carrier: finalPolicy.carrier,
              questionCount: reviewQuestions.length,
            });
            await pCtx.log(
              `Created extraction review notification for ${reviewQuestions.length} coverage ${reviewQuestions.length === 1 ? "term" : "terms"}`,
            );
          }
        }
      } catch { /* non-critical */ }

      // Schedule duplicate detection
      try {
        await convexCtx.scheduler.runAfter(
          2000,
          (internal as any).actions.detectDuplicatePolicies.detectDuplicates,
          { policyId, orgId: state.orgId },
        );
      } catch { /* non-critical */ }

      await pCtx.log("Post-processing complete");
      return { kind: "done" };
    },
  };

  const withTrace = (
    phase: Phase<PolicyExtractionState>,
  ): Phase<PolicyExtractionState> => ({
    ...phase,
    run: async (pCtx) => {
      const traceId = pCtx.checkpoint.state.traceId;
      const startedAt = nowMs();
      await traceEvent(convexCtx, traceId, {
        kind: "phase",
        phase: phase.name,
        label: phase.name,
        status: "started",
      });
      try {
        const result = await phase.run(pCtx);
        await traceEvent(convexCtx, traceId, {
          kind: "phase",
          phase: phase.name,
          label: phase.name,
          status: result.kind,
          durationMs: nowMs() - startedAt,
          error: result.kind === "error" ? result.error : undefined,
        });
        return result;
      } catch (error) {
        await traceEvent(convexCtx, traceId, {
          kind: "phase",
          phase: phase.name,
          label: phase.name,
          status: "error",
          durationMs: nowMs() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  return [loadPdfPhase, extractPhase, embedAndStorePhase, postProcessPhase].map(withTrace);
}

// ─── advance internal action ───────────────────────────────────────────────────

export const advance = internalAction({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const phases = makePhases(ctx);
    await advanceLeasedPhase(ctx, jobId, phases);
  },
});

export const sweepStale = internalAction({
  args: {
    olderThanMs: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.runMutation((internal as any).policies.pipelineRequeueStale, {
      olderThanMs: args.olderThanMs,
      batchSize: args.batchSize,
    }) as {
      requeued: string[];
      markedError: string[];
      scanned: number;
    };
    if (result.requeued.length || result.markedError.length) {
      console.log(
        `Stale extraction sweep scanned ${result.scanned}; requeued ${result.requeued.length}; marked error ${result.markedError.length}`,
      );
    }
    return result;
  },
});

export const claimExternalJob = action({
  args: {
    secret: v.string(),
    workerId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ExternalClaimResult> => {
    requireExtractionWorkerSecret(args.secret);
    const leaseId = `${args.workerId ?? "worker"}:${randomUUID()}`;
    const leaseExpiresAt = nowMs() + EXTERNAL_WORKER_LEASE_MS;
    const claimed = await ctx.runMutation(
      (internal as any).policies.pipelineClaimExternalWorkerJob,
      { leaseId, leaseExpiresAt },
    ) as
      | {
          policyId: string;
          checkpoint: {
            state: PolicyExtractionState;
          };
        }
      | null;

    if (!claimed) return null;
    const fileId = claimed.checkpoint.state.fileId;
    if (!fileId) {
      await ctx.runMutation((internal as any).policies.pipelineCompleteLease, {
        jobId: claimed.policyId,
        leaseId,
        status: "error",
        error: "External worker claimed job without fileId",
        checkpoint: null,
      });
      await completeTraceSession(ctx, claimed.checkpoint.state.traceId, "error", "External worker claimed job without fileId");
      return null;
    }

    const fileUrl = await ctx.storage.getUrl(fileId as Id<"_storage">);
    if (!fileUrl) {
      await ctx.runMutation((internal as any).policies.pipelineCompleteLease, {
        jobId: claimed.policyId,
        leaseId,
        status: "error",
        error: "External worker could not resolve source file URL",
        checkpoint: null,
      });
      await completeTraceSession(ctx, claimed.checkpoint.state.traceId, "error", "External worker could not resolve source file URL");
      return null;
    }
    await traceEvent(ctx, claimed.checkpoint.state.traceId, {
      kind: "worker",
      phase: "worker",
      label: "external worker claim",
      status: "claimed",
      message: `External worker claimed job${args.workerId ? ` (${args.workerId})` : ""}`,
      details: { workerId: args.workerId, leaseId },
    });

    let modelSettings:
      | {
          routes?: Record<string, { provider: string; model: string }>;
          providerKeys?: Record<string, string>;
        }
      | undefined;
    try {
      modelSettings = await ctx.runQuery((internal as any).modelSettings.resolveForOrg, {
        orgId: claimed.checkpoint.state.orgId as Id<"organizations">,
      }) as typeof modelSettings;
    } catch (error) {
      console.warn(
        `External worker model settings unavailable for ${claimed.policyId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      policyId: claimed.policyId,
      leaseId,
      leaseExpiresAt,
      state: claimed.checkpoint.state,
      fileUrl,
      clSdkCheckpoint: await loadClSdkCheckpoint(ctx, claimed.policyId, claimed.checkpoint.state),
      modelSettings,
    };
  },
});

export const heartbeatExternalJob = action({
  args: {
    secret: v.string(),
    policyId: v.string(),
    leaseId: v.string(),
  },
  handler: async (ctx, args): Promise<ExternalAckResult> => {
    requireExtractionWorkerSecret(args.secret);
    const leaseExpiresAt = nowMs() + EXTERNAL_WORKER_LEASE_MS;
    const ok = await ctx.runMutation((internal as any).policies.pipelineExtendLease, {
      jobId: args.policyId,
      leaseId: args.leaseId,
      leaseExpiresAt,
    }) as boolean;
    return { ok, leaseExpiresAt };
  },
});

export const logExternalJob = action({
  args: {
    secret: v.string(),
    policyId: v.string(),
    message: v.string(),
    phase: v.optional(v.string()),
    level: v.optional(v.union(v.literal("info"), v.literal("warn"), v.literal("error"))),
  },
  handler: async (ctx, args): Promise<ExternalAckResult> => {
    requireExtractionWorkerSecret(args.secret);
    await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
      jobId: args.policyId,
      timestamp: nowMs(),
      message: args.message,
      phase: args.phase ?? "worker",
      level: args.level ?? "info",
    });
    return { ok: true };
  },
});

export const recordExternalTraceEvent = action({
  args: {
    secret: v.string(),
    traceId: v.optional(v.string()),
    kind: v.union(
      v.literal("model_call"),
      v.literal("worker"),
      v.literal("phase"),
      v.literal("embedding_batch"),
      v.literal("artifact"),
    ),
    phase: v.optional(v.string()),
    label: v.optional(v.string()),
    task: v.optional(v.string()),
    taskKind: v.optional(v.string()),
    provider: v.optional(v.string()),
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
  handler: async (ctx, args): Promise<ExternalAckResult> => {
    requireExtractionWorkerSecret(args.secret);
    await traceEvent(ctx, args.traceId, {
      kind: args.kind,
      phase: args.phase,
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
    });
    return { ok: true };
  },
});

export const saveExternalCheckpoint = action({
  args: {
    secret: v.string(),
    policyId: v.string(),
    leaseId: v.string(),
    state: v.any(),
    checkpoint: v.any(),
  },
  handler: async (ctx, args): Promise<ExternalAckResult> => {
    requireExtractionWorkerSecret(args.secret);
    const checkpointFileId = await storeClSdkCheckpoint(
      ctx,
      args.policyId,
      args.checkpoint as PipelineCheckpoint<ExtractionState>,
      async (message, level = "info") => {
        await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
          jobId: args.policyId,
          timestamp: nowMs(),
          message,
          phase: "worker",
          level,
        });
      },
    );
    const leaseExpiresAt = nowMs() + EXTERNAL_WORKER_LEASE_MS;
    const ok = await ctx.runMutation((internal as any).policies.pipelineSaveStateForLease, {
      jobId: args.policyId,
      leaseId: args.leaseId,
      nextPhase: "extract",
      state: {
        ...(args.state as PolicyExtractionState),
        externalWorker: true,
        clSdkCheckpoint: undefined,
        clSdkCheckpointFileId: checkpointFileId,
      },
      leaseExpiresAt,
    }) as boolean;
    return { ok, checkpointFileId, leaseExpiresAt };
  },
});

export const completeExternalExtract = action({
  args: {
    secret: v.string(),
    policyId: v.string(),
    leaseId: v.string(),
    state: v.any(),
    document: v.any(),
    chunks: v.array(v.any()),
    sourceSpans: v.array(v.any()),
    sourceChunks: v.array(v.any()),
    tokenUsage: v.optional(v.any()),
    performanceReport: v.optional(v.any()),
    checkpoint: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<ExternalAckResult> => {
    requireExtractionWorkerSecret(args.secret);
    const state = args.state as PolicyExtractionState;
    const policyId = args.policyId;
    let doc = args.document as Record<string, unknown>;
    if (!state.orgId || !state.userId) {
      throw new Error("External extraction completion missing orgId or userId");
    }

    await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
      jobId: policyId,
      timestamp: nowMs(),
      message: `External extraction complete. Type: ${String(doc.type ?? "policy")}. ${args.chunks.length} chunks, ${args.sourceSpans.length} source spans.`,
      phase: "extract",
      level: "info",
    });
    if (args.performanceReport?.modelCalls?.length) {
      const totalSeconds = Math.round((args.performanceReport.totalModelCallDurationMs ?? 0) / 1000);
      await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
        jobId: policyId,
        timestamp: nowMs(),
        message: `External extraction model calls: ${args.performanceReport.modelCalls.length}; total model time: ${totalSeconds}s`,
        phase: "extract",
        level: "info",
      });
    }
    if (args.checkpoint) {
      for (const line of summarizeExtractionCheckpoint({ checkpoint: args.checkpoint })) {
        await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
          jobId: policyId,
          timestamp: nowMs(),
          message: line,
          phase: "extract",
          level: "info",
        });
      }
    }

    const processed = await postProcessExtractionDocument({
      ctx,
      orgId: state.orgId as Id<"organizations">,
      document: doc,
      sourceSpans: args.sourceSpans,
      log: async (message, level = "info") => {
        await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
          jobId: policyId,
          timestamp: nowMs(),
          message,
          phase: "extract",
          level,
        });
      },
    });
    doc = processed.document;
    const fields = processed.fields;
    if (processed.coverageReviewQuestionCount > 0) {
      await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
        jobId: policyId,
        timestamp: nowMs(),
        message: `Extraction review has ${processed.coverageReviewQuestionCount} open question${processed.coverageReviewQuestionCount === 1 ? "" : "s"}`,
        phase: "extract",
        level: "warn",
      });
    }
    const docName = doc.type === "quote"
      ? (doc.quoteNumber || "quote")
      : (doc.policyNumber || "policy");
    const resolvedFileName = state.fileName || `${String(docName)}.pdf`;

    await ctx.runMutation((internal as any).policies.updateExtractionInternal, {
      id: policyId,
      fields: {
        fileName: resolvedFileName,
        ...fields,
      },
    });

    if (state.policyFileId) {
      await ctx.runMutation((internal as any).policyFiles.updateExtraction, {
        id: state.policyFileId,
        extractedData: doc,
      });
    }

    const embeddingPayloadFileId = await storeEmbeddingPayload(ctx, policyId, {
      documentChunksForEmbedding: args.chunks as PolicyExtractionState["documentChunksForEmbedding"],
      sourceSpansForStorage: args.sourceSpans as PolicyExtractionState["sourceSpansForStorage"],
      sourceChunksForEmbedding: args.sourceChunks as PolicyExtractionState["sourceChunksForEmbedding"],
    });
    const nextState: PolicyExtractionState = {
      ...state,
      clSdkCheckpoint: undefined,
      clSdkCheckpointFileId: undefined,
      embeddingPayloadFileId,
      chunkIds: args.chunks.map((chunk: { id: string }) => chunk.id),
      sourceSpanIds: args.sourceSpans.map((span: { id: unknown }) => String(span.id)),
      sourceChunkIds: args.sourceChunks.map((chunk: { id: unknown }) => String(chunk.id)),
      fileName: resolvedFileName,
      externalWorker: undefined,
    };

    const checkpointUpdated = await ctx.runMutation((internal as any).policies.pipelineCompleteLease, {
      jobId: policyId,
      leaseId: args.leaseId,
      checkpoint: {
        nextPhase: "embed_and_store",
        state: nextState,
        createdAt: nowMs(),
      },
    }) as boolean;
    if (checkpointUpdated) {
      await ctx.scheduler.runAfter(0, (internal as any).actions.policyExtraction.advance, { jobId: policyId });
      await traceEvent(ctx, state.traceId, {
        kind: "phase",
        phase: "external_extract",
        label: "external_extract",
        status: "next",
        message: "External extraction handed off to embed_and_store",
      });
    }
    return { ok: checkpointUpdated };
  },
});

export const failExternalJob = action({
  args: {
    secret: v.string(),
    policyId: v.string(),
    leaseId: v.string(),
    state: v.optional(v.any()),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    requireExtractionWorkerSecret(args.secret);
    const checkpoint = args.state
      ? {
          nextPhase: "extract",
          state: args.state,
          createdAt: nowMs(),
        }
      : null;
    await ctx.runMutation((internal as any).policies.pipelineCompleteLease, {
      jobId: args.policyId,
      leaseId: args.leaseId,
      status: "error",
      error: args.error,
      checkpoint,
    });
    await completeTraceSession(
      ctx,
      (args.state as PolicyExtractionState | undefined)?.traceId,
      args.error === CANCELLED_BY_USER ? "cancelled" : "error",
      args.error,
    );
    return { ok: true };
  },
});

// ─── Entry point: start from upload ───────────────────────────────────────────

export const startPolicyExtractionFromUpload = internalAction({
  args: {
    policyId: v.id("policies"),
    fileId: v.id("_storage"),
    fileName: v.optional(v.string()),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    policyFileId: v.optional(v.id("policyFiles")),
  },
  handler: async (ctx, { policyId, fileId, fileName, orgId, userId, policyFileId }) => {
    const traceId = randomUUID();
    await startTraceSession(ctx, {
      traceId,
      policyId,
      orgId,
      userId,
      sourceKind: "upload",
      trigger: "upload",
      fileName,
    });
    if (EXTERNAL_WORKER_MODE) {
      await ctx.runMutation(internal.policies.pipelineClearLog, {
        jobId: String(policyId),
      });
      await clearArtifacts(ctx, String(policyId));
      await ctx.runMutation((internal as any).policies.pipelineStartExternalWorkerJob, {
        jobId: String(policyId),
        state: {
          sourceKind: "upload",
          fileId: String(fileId),
          fileName,
          orgId: String(orgId),
          userId: String(userId),
          policyFileId: policyFileId ? String(policyFileId) : undefined,
          traceId,
        },
      });
      return;
    }

    const mutations = makeMutations();
    const storage = createConvexStorageAdapter<PolicyExtractionState>({
      ctx: ctx as any,
      mutations,
    });
    const scheduler = createConvexSchedulerAdapter({
      ctx: ctx as any,
      advanceAction: internal.actions.policyExtraction.advance,
    });
    await ctx.runMutation(internal.policies.pipelineClearLog, {
      jobId: String(policyId),
    });
    await clearArtifacts(ctx, String(policyId));
    const phases = makePhases(ctx);
    await runPipeline<PolicyExtractionState>({
      jobId: String(policyId),
      phases,
      storage,
      scheduler,
      initialState: {
        sourceKind: "upload",
        fileId: String(fileId),
        fileName,
        orgId: String(orgId),
        userId: String(userId),
        policyFileId: policyFileId ? String(policyFileId) : undefined,
        traceId,
      },
    });
  },
});

// ─── Entry point: retry ────────────────────────────────────────────────────────

export const retryPolicyExtraction = internalAction({
  args: {
    policyId: v.id("policies"),
    mode: v.union(v.literal("resume"), v.literal("full")),
  },
  handler: async (ctx, { policyId, mode }) => {
    const mutations = makeMutations();
    const storage = createConvexStorageAdapter<PolicyExtractionState>({
      ctx: ctx as any,
      mutations,
    });
    const scheduler = createConvexSchedulerAdapter({
      ctx: ctx as any,
      advanceAction: internal.actions.policyExtraction.advance,
    });

    if (mode === "full") {
      await ctx.runMutation(internal.policies.pipelineClearLog, {
        jobId: String(policyId),
      });
      await clearArtifacts(ctx, String(policyId));
    }

    // Fetch policy to recover initial state for "full" restart
    const policy = await ctx.runQuery(
      internal.policies.getInternal,
      { id: policyId },
    ) as {
      orgId?: string;
      userId?: string;
      fileId?: string;
      pipelineCheckpoint?: { state?: PolicyExtractionState };
    } | null;
    if (!policy) throw new Error("Policy not found");

    const existingState = policy.pipelineCheckpoint?.state;
    const traceId = mode === "resume" && existingState?.traceId
      ? existingState.traceId
      : randomUUID();
    if (mode === "full" || !existingState?.traceId) {
      await startTraceSession(ctx, {
        traceId,
        policyId,
        orgId: String(policy.orgId ?? "") as Id<"organizations">,
        userId: String(policy.userId ?? "") as Id<"users">,
        sourceKind: existingState?.sourceKind ?? "upload",
        trigger: `retry_${mode}`,
        fileName: existingState?.fileName,
      });
    } else {
      await traceEvent(ctx, traceId, {
        kind: "session",
        status: "resumed",
        message: "Extraction retry resumed existing trace",
      });
    }
    if (EXTERNAL_WORKER_MODE) {
      const nextState = {
        sourceKind: existingState?.sourceKind ?? "upload",
        fileId: existingState?.fileId ?? (policy.fileId ? String(policy.fileId) : undefined),
        fileName: existingState?.fileName,
        orgId: existingState?.orgId ?? String(policy.orgId ?? ""),
        userId: existingState?.userId ?? String(policy.userId ?? ""),
        policyFileId: existingState?.policyFileId,
        traceId,
        clSdkCheckpointFileId: mode === "resume" ? existingState?.clSdkCheckpointFileId : undefined,
        clSdkCheckpoint: mode === "resume" ? existingState?.clSdkCheckpoint : undefined,
      };
      if (!nextState.fileId) throw new Error("Policy source file is missing");
      if (mode === "full") {
        await ctx.runMutation(internal.policies.pipelineClearLog, {
          jobId: String(policyId),
        });
        await clearArtifacts(ctx, String(policyId));
      }
      await ctx.runMutation((internal as any).policies.pipelineStartExternalWorkerJob, {
        jobId: String(policyId),
        state: nextState,
      });
      return;
    }

    const phases = makePhases(ctx);
    await runPipeline<PolicyExtractionState>({
      jobId: String(policyId),
      phases,
      storage,
      scheduler,
      retryMode: mode,
      initialState: {
        sourceKind: existingState?.sourceKind ?? "upload",
        fileId: existingState?.fileId ?? (policy.fileId ? String(policy.fileId) : undefined),
        orgId: existingState?.orgId ?? String(policy.orgId ?? ""),
        userId: existingState?.userId ?? String(policy.userId ?? ""),
        traceId,
      },
    });
  },
});
