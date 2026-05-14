"use node";

import { randomUUID } from "crypto";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { runPipeline } from "@claritylabs/cl-pipelines";
import {
  createConvexStorageAdapter,
  createConvexSchedulerAdapter,
} from "@claritylabs/cl-pipelines/convex";
import type { Phase, PhaseResult } from "@claritylabs/cl-pipelines";
import {
  buildExtractor,
  insuranceDocToPolicy,
  summarizeExtractionCheckpoint,
} from "../lib/extraction";
import { buildPdfSourceSpans } from "../lib/pdfSourceSpans";
import type { ExtractionResult, ExtractionState, PipelineCheckpoint } from "../lib/extraction";
import type { ExtractOptions } from "../lib/extraction";
import { makeEmbedText, makeGenerateObject } from "../lib/sdkCallbacks";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getModelForOrg } from "../lib/models";
import { generateObject } from "ai";
import { z } from "zod";

const CANCELLED_BY_USER = "Cancelled by user";
const NON_INSURANCE_DOCUMENT_ERROR = "This document is not an insurance policy or quote, so extraction was stopped.";
const ADVANCE_LEASE_MS = 2 * 60 * 1000;
const ADVANCE_LEASE_HEARTBEAT_MS = 30 * 1000;
const ADVANCE_LEASE_WATCHDOG_GRACE_MS = 15 * 1000;
const EMBEDDING_CONCURRENCY = readBoundedIntEnv("EXTRACTION_EMBEDDING_CONCURRENCY", 8, 1, 16);

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

function readBoundedIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
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
): Promise<string> {
  const blob = new Blob([JSON.stringify(value)], {
    type: "application/json",
  });
  const storageId = String(await ctx.storage.store(blob));
  await ctx.runMutation(internal.policies.pipelineSaveArtifact, {
    jobId,
    kind,
    storageId: storageId as Id<"_storage">,
  });
  return storageId;
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
  return await storeJsonArtifact(ctx, jobId, "embedding_payload", payload);
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
  pdfBytes: Uint8Array;
  sourceSpans: Array<{ pageStart?: number; text: string; metadata?: Record<string, unknown> }>;
}): Promise<ExtractionGateDecision> {
  const generateGateObject = makeGenerateObject("classification", {
    ctx: params.ctx,
    orgId: params.orgId,
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

const orgNameNormalizationSchema = z.object({
  carrier: z.string().nullable(),
  security: z.string().nullable(),
  mga: z.string().nullable(),
  broker: z.string().nullable(),
  brokerAgency: z.string().nullable(),
});

async function normalizeOrgNamesWithLlm(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const candidates = {
    carrier: typeof fields.carrier === "string" ? fields.carrier : undefined,
    security: typeof fields.security === "string" ? fields.security : undefined,
    mga: typeof fields.mga === "string" ? fields.mga : undefined,
    broker: typeof fields.broker === "string" ? fields.broker : undefined,
    brokerAgency: typeof fields.brokerAgency === "string" ? fields.brokerAgency : undefined,
  };
  if (!Object.values(candidates).some(Boolean)) return fields;

  try {
    const model = await getModelForOrg(ctx, orgId, "extraction");
    const result = await generateObject({
      model,
      schema: orgNameNormalizationSchema,
      prompt: `Normalize insurance organization display names.

Rules:
- Return concise user-facing names only.
- Remove legal/disclaimer suffixes, "administered by" clauses, and parenthetical metadata.
- Keep the canonical brand/entity name.
- If input is already concise, keep it unchanged.
- Return every schema key. Use null for missing input keys.

Input JSON:
${JSON.stringify(candidates)}`,
    });

    const normalized = result.object;
    return {
      ...fields,
      carrier: normalized.carrier ?? fields.carrier,
      security: normalized.security ?? fields.security,
      mga: normalized.mga ?? fields.mga,
      broker: normalized.broker ?? fields.broker,
      brokerAgency: normalized.brokerAgency ?? fields.brokerAgency,
    };
  } catch (err) {
    console.warn(
      `LLM org-name normalization failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return fields;
  }
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
    await ctx.runMutation(internal.policies.pipelineAppendLog, {
      jobId,
      timestamp: Date.now(),
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
      const pdfSource = await buildPdfSourceSpans({
        pdfBytes,
        documentId: policyId,
        sourceKind: "policy_pdf",
      });
      if (pdfSource.sourceSpans.length > 0) {
        await pCtx.log(`Prepared ${pdfSource.sourceSpans.length} raw source spans for source-grounded extraction`);
      }

      if (clSdkCheckpoint) {
        await pCtx.log(`Resuming extraction from cl-sdk phase "${clSdkCheckpoint.phase}"…`);
      } else {
        await pCtx.log("Checking whether the PDF is an insurance policy or quote…");
        try {
          const gateDecision = await classifyInsuranceExtractability({
            ctx: convexCtx,
            orgId: state.orgId as Id<"organizations">,
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
        log: async (msg) => { await pCtx.log(msg); },
        onProgress: async (msg) => { await pCtx.log(msg); },
        shouldCancel: async () => isExtractionCancelled(convexCtx, policyId),
        onCheckpointSave: async (cp) => {
          if (await isExtractionCancelled(convexCtx, policyId)) {
            throw new Error(CANCELLED_BY_USER);
          }
          // Route cl-sdk's checkpoint through cl-pipelines' saveState, storing
          // the large checkpoint payload outside the hot runtime document.
          const checkpointFileId = await storeJsonArtifact(convexCtx, policyId, "cl_sdk_checkpoint", cp);
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
          pdfBytes,
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
        const checkpointFileId = await storeJsonArtifact(convexCtx, policyId, "cl_sdk_checkpoint", result.checkpoint);
        await pCtx.saveState({
          ...state,
          clSdkCheckpoint: undefined,
          clSdkCheckpointFileId: checkpointFileId,
        });
      }

      const doc = result.document as Record<string, unknown>;
      const chunks = result.chunks;
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
      const tokenUsage = result.tokenUsage;

      await pCtx.log(
        `Extraction complete. Type: ${doc.type}. ${chunks.length} chunks, ${sourceSpans.length} source spans. Tokens: ${tokenUsage.inputTokens}in/${tokenUsage.outputTokens}out`,
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

      // Save extracted fields to the policy row
      const mappedFields = insuranceDocToPolicy(result.document);
      const fields = await normalizeOrgNamesWithLlm(
        convexCtx,
        state.orgId as Id<"organizations">,
        mappedFields,
      );
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
            rawExtractionResponse: undefined,
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
            await pCtx.log(
              `Warning: failed to embed chunk ${chunk.id}: ${err instanceof Error ? err.message : String(err)}`,
              "warn",
            );
          }
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
              await pCtx.log(
                `Warning: failed to embed source chunk ${chunk.id}: ${err instanceof Error ? err.message : String(err)}`,
                "warn",
              );
            }
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

  return [loadPdfPhase, extractPhase, embedAndStorePhase, postProcessPhase];
}

// ─── advance internal action ───────────────────────────────────────────────────

export const advance = internalAction({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const phases = makePhases(ctx);
    await advanceLeasedPhase(ctx, jobId, phases);
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
      },
    });
  },
});
