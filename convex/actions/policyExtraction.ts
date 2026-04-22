"use node";

import { v } from "convex/values";
import { internalAction, action } from "../_generated/server";
import { internal } from "../_generated/api";
import { advancePhase, runPipeline } from "@claritylabs/cl-pipelines";
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
import type { ExtractionState, PipelineCheckpoint } from "../lib/extraction";
import { makeEmbedText } from "../lib/sdkCallbacks";
import { ImapFlow } from "imapflow";
import type { ActionCtx } from "../_generated/server";

// ─── State Type ────────────────────────────────────────────────────────────────

export type PolicyExtractionState = {
  /** "upload" = direct file upload; "email" = PDF fetched from IMAP */
  sourceKind: "upload" | "email";
  /** Convex storage ID of the PDF (set after load_pdf phase) */
  fileId?: string;
  /** Original file name hint */
  fileName?: string;
  orgId: string;
  userId: string;
  /** Populated for email-sourced policies */
  emailId?: string;
  connectionId?: string;
  /** The policyFiles row for this extraction job */
  policyFileId?: string;
  /** cl-sdk internal checkpoint for mid-extract resume */
  clSdkCheckpoint?: PipelineCheckpoint<ExtractionState>;
  /** Extracted chunks stored for embed phase */
  extractedDocumentJson?: string;
  /** Extracted chunks stored for embed phase */
  chunkIds?: string[];
};

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

      if (state.sourceKind === "upload") {
        if (!state.fileId) {
          return { kind: "error", error: "load_pdf: missing fileId for upload source" };
        }
        await pCtx.log("Loading PDF from storage…");
        const url = await convexCtx.storage.getUrl(state.fileId as any);
        if (!url) return { kind: "error", error: "File not found in storage" };
        await pCtx.log("PDF ready for extraction");
        return { kind: "next", nextPhase: "extract", state };
      }

      // email source: download from IMAP and store
      if (!state.emailId || !state.connectionId) {
        return { kind: "error", error: "load_pdf: missing emailId or connectionId for email source" };
      }

      await pCtx.log("Connecting to email server…");
      const thisEmail = await convexCtx.runQuery(
        (internal as any).emails.getInternal,
        { id: state.emailId },
      ) as { uid?: number } | null;
      if (!thisEmail) return { kind: "error", error: "Email not found" };

      const connection = await convexCtx.runQuery(
        (internal as any).connections.getInternal,
        { id: state.connectionId },
      ) as {
        imapHost?: string;
        imapPort?: number;
        password?: string;
        email: string;
      } | null;
      if (!connection) return { kind: "error", error: "Connection not found" };
      if (!connection.imapHost || !connection.imapPort || !connection.password) {
        return { kind: "error", error: "IMAP connection missing host, port, or password" };
      }

      const client = new ImapFlow({
        host: connection.imapHost,
        port: connection.imapPort,
        secure: true,
        auth: { user: connection.email, pass: connection.password },
        logger: false,
      });

      let pdfBuffer: Buffer;
      try {
        await client.connect();
        await pCtx.log("Downloading PDF attachment…");
        const lock = await client.getMailboxLock("INBOX");
        try {
          const { content } = await client.download(
            String(thisEmail.uid ?? 0),
            "2",
            { uid: true },
          );
          const chunks: Buffer[] = [];
          for await (const chunk of content) {
            chunks.push(Buffer.from(chunk));
          }
          pdfBuffer = Buffer.concat(chunks);
        } finally {
          lock.release();
        }
        await client.logout();
      } catch (err) {
        try { await client.logout(); } catch { /* ignore */ }
        return { kind: "error", error: `IMAP download failed: ${err instanceof Error ? err.message : String(err)}` };
      }

      const sizeKB = Math.round(pdfBuffer.length / 1024);
      await pCtx.log(`PDF downloaded (${sizeKB} KB). Storing…`);
      const blob = new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" });
      const fileId = String(await convexCtx.storage.store(blob));

      // Update the policy row with fileId so retry can find the stored PDF
      await convexCtx.runMutation(
        (internal as any).policies.updateExtractionInternal,
        { id: pCtx.jobId, fields: { fileId } },
      );

      await pCtx.log(`PDF stored (${sizeKB} KB)`);
      return { kind: "next", nextPhase: "extract", state: { ...state, fileId } };
    },
  };

  // ── Phase 2: extract ──────────────────────────────────────────────────────────
  // Wraps cl-sdk buildExtractor. cl-sdk's internal checkpoint is the ONLY state
  // this phase carries on cl-pipelines' checkpoint.
  const extractPhase: Phase<PolicyExtractionState> = {
    name: "extract",
    run: async (pCtx): Promise<PhaseResult<PolicyExtractionState>> => {
      const { state } = pCtx.checkpoint;

      if (!state.fileId) {
        return { kind: "error", error: "extract: missing fileId — load_pdf phase must run first" };
      }

      await pCtx.log("Starting policy extraction…");

      const url = await convexCtx.storage.getUrl(state.fileId as any);
      if (!url) return { kind: "error", error: "File not found in storage" };

      const policyId = pCtx.jobId;
      const clSdkCheckpoint = state.clSdkCheckpoint;

      if (clSdkCheckpoint) {
        await pCtx.log(`Resuming extraction from cl-sdk phase "${clSdkCheckpoint.phase}"…`);
      }

      const extractor = buildExtractor({
        log: async (msg) => { await pCtx.log(msg); },
        onProgress: async (msg) => { await pCtx.log(msg); },
        onCheckpointSave: async (cp) => {
          // Route cl-sdk's checkpoint through cl-pipelines' saveState
          await pCtx.saveState({ ...state, clSdkCheckpoint: cp });
        },
      });

      const extractOptions = clSdkCheckpoint ? { resumeFrom: clSdkCheckpoint } : undefined;

      const result = await extractor.extract(
        new URL(url),
        policyId,
        extractOptions,
      );

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
      const fields = insuranceDocToPolicy(result.document);
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
            extractionStatus: "complete",
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
        const embed = makeEmbedText();
        let embedded = 0;
        for (const chunk of chunks) {
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
    const mutations = makeMutations();
    const storage = createConvexStorageAdapter<PolicyExtractionState>({
      ctx: ctx as any,
      mutations,
    });
    const scheduler = createConvexSchedulerAdapter({
      ctx: ctx as any,
      advanceAction: internal.actions.policyExtraction.advance,
    });
    const phases = makePhases(ctx);
    await advancePhase({ jobId, phases, storage, scheduler });
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

// ─── Entry point: start from email ────────────────────────────────────────────

export const startPolicyExtractionFromEmail = internalAction({
  args: {
    policyId: v.id("policies"),
    emailId: v.id("emails"),
    connectionId: v.id("emailConnections"),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    policyFileId: v.optional(v.id("policyFiles")),
  },
  handler: async (ctx, { policyId, emailId, connectionId, orgId, userId, policyFileId }) => {
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
        sourceKind: "email",
        emailId: String(emailId),
        connectionId: String(connectionId),
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
      emailId?: string;
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
        sourceKind: existingState?.sourceKind ?? (policy.fileId ? "upload" : "email"),
        fileId: existingState?.fileId ?? (policy.fileId ? String(policy.fileId) : undefined),
        orgId: existingState?.orgId ?? String(policy.orgId ?? ""),
        userId: existingState?.userId ?? String(policy.userId ?? ""),
        emailId: existingState?.emailId ?? (policy.emailId ? String(policy.emailId) : undefined),
      },
    });
  },
});
