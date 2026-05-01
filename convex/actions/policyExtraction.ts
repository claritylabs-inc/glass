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
import type { ExtractionResult, ExtractionState, PipelineCheckpoint } from "../lib/extraction";
import { makeEmbedText } from "../lib/sdkCallbacks";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getModelForOrg } from "../lib/models";
import { generateObject } from "ai";
import { z } from "zod";

const CANCELLED_BY_USER = "Cancelled by user";
const ADVANCE_LEASE_MS = 2 * 60 * 1000;
const ADVANCE_LEASE_HEARTBEAT_MS = 30 * 1000;
const ADVANCE_LEASE_WATCHDOG_GRACE_MS = 15 * 1000;

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
  clSdkCheckpoint?: PipelineCheckpoint<ExtractionState>;
  extractedDocumentJson?: string;
  chunkIds?: string[];
};

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

function stripLease(
  checkpoint: LeasedPolicyCheckpoint,
): Omit<LeasedPolicyCheckpoint, "lease"> {
  const { lease: _lease, ...rest } = checkpoint;
  return rest;
}

const orgNameNormalizationSchema = z.object({
  carrier: z.string().optional(),
  security: z.string().optional(),
  mga: z.string().optional(),
  broker: z.string().optional(),
  brokerAgency: z.string().optional(),
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
- Return only keys present in the input object.

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

  const saveState = async (state: PolicyExtractionState) => {
    const ok = await ctx.runMutation(
      internal.policies.pipelineSaveStateForLease,
      {
        jobId,
        leaseId,
        nextPhase: phase.name,
        state,
        leaseExpiresAt: Date.now() + ADVANCE_LEASE_MS,
      },
    );
    if (!ok) {
      throw new Error("Pipeline phase lease lost");
    }
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
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    void (async () => {
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
        checkpoint: stripLease(checkpoint),
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
      checkpoint: stripLease(checkpoint),
    });
  } finally {
    clearInterval(heartbeat);
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
      const clSdkCheckpoint = state.clSdkCheckpoint;

      if (clSdkCheckpoint) {
        await pCtx.log(`Resuming extraction from cl-sdk phase "${clSdkCheckpoint.phase}"…`);
      }

      const extractor = buildExtractor({
        log: async (msg) => { await pCtx.log(msg); },
        onProgress: async (msg) => { await pCtx.log(msg); },
        shouldCancel: async () => isExtractionCancelled(convexCtx, policyId),
        onCheckpointSave: async (cp) => {
          if (await isExtractionCancelled(convexCtx, policyId)) {
            throw new Error(CANCELLED_BY_USER);
          }
          // Route cl-sdk's checkpoint through cl-pipelines' saveState
          await pCtx.saveState({ ...state, clSdkCheckpoint: cp });
        },
      });

      const extractOptions = clSdkCheckpoint ? { resumeFrom: clSdkCheckpoint } : undefined;

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

      const doc = result.document as Record<string, unknown>;
      const chunks = result.chunks;
      const tokenUsage = result.tokenUsage;

      await pCtx.log(
        `Extraction complete. Type: ${doc.type}. ${chunks.length} chunks. Tokens: ${tokenUsage.inputTokens}in/${tokenUsage.outputTokens}out`,
      );
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
            rawExtractionResponse: JSON.stringify(result.document),
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

      // Carry extracted document JSON for embed phase
      const chunkIds = chunks.map((c: { id: string }) => c.id);
      const nextState: PolicyExtractionState = {
        ...state,
        clSdkCheckpoint: undefined, // clear — extraction done
        extractedDocumentJson: JSON.stringify(result.document),
        chunkIds,
        fileName: resolvedFileName,
      };

      // Store chunks in-state temporarily (size may be large — keep only IDs + text inline)
      // Pass full chunks as pCtx state just for the embed phase
      (nextState as any)._chunks = chunks;

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

      // chunks may have been passed in-state from extract phase (same execution)
      // or we skip re-embedding since chunks are not re-fetchable without re-extracting.
      // On resume from a serialized checkpoint, _chunks won't be present — skip embedding gracefully.
      const chunks = (state as any)._chunks as Array<{
        id: string;
        type: string;
        text: string;
        metadata: Record<string, unknown>;
      }> | undefined;

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
        for (const chunk of chunks) {
          if (await isExtractionCancelled(convexCtx, policyId)) {
            return { kind: "error", error: CANCELLED_BY_USER };
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
            await pCtx.log(
              `Warning: failed to embed chunk ${chunk.id}: ${err instanceof Error ? err.message : String(err)}`,
              "warn",
            );
          }
        }
        await pCtx.log(`Stored ${embedded}/${chunks.length} chunks`);
      }

      // Drop the raw chunks from state (not needed downstream)
      const { _chunks: _dropped, ...cleanState } = state as any;
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
