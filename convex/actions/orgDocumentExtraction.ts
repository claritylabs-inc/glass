"use node";

import { v } from "convex/values";
import { internalAction, action } from "../_generated/server";
import { internal, api } from "../_generated/api";
import { advancePhase, runPipeline } from "@claritylabs/cl-pipelines";
import {
  createConvexStorageAdapter,
  createConvexSchedulerAdapter,
} from "@claritylabs/cl-pipelines/convex";
import type { Phase, PhaseResult } from "@claritylabs/cl-pipelines";
import { makeEmbedText, makeGenerateObject } from "../lib/sdkCallbacks";
import { getModel, generateTextWithFallback } from "../lib/models";
import { generateText } from "ai";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

// ─── Types ─────────────────────────────────────────────────────────────────────

type DocumentType =
  | "financial_statement"
  | "loss_run"
  | "payroll_schedule"
  | "fleet_list"
  | "certificate"
  | "general";

interface ClassificationResult {
  documentType: DocumentType;
  documentDate?: string;
  asOfDate?: string;
  sourceLabel?: string;
}

type ModelInput =
  | { kind: "text"; text: string }
  | { kind: "pdf"; bytes: Uint8Array; fileName: string };

export type OrgDocumentExtractionState = {
  orgId: string;
  userId: string;
  storageId: string;
  fileName: string;
  /** Set after decode phase */
  inputJson?: string; // JSON-serialized ModelInput (text only — pdf bytes are re-fetched)
  inputKind?: "text" | "pdf";
  inputText?: string; // only for text kind
  /** Set after classify phase */
  classification?: ClassificationResult;
  /** Set after extract_parallel phase */
  entriesJson?: string; // JSON array of extracted entries
};

// ─── File type helpers ─────────────────────────────────────────────────────────

const DOCX_EXTS = [".docx"];
const XLSX_EXTS = [".xlsx", ".xls", ".ods", ".csv"];
const OFFICE_EXTS = [...DOCX_EXTS, ...XLSX_EXTS];
const TEXT_EXTS = [".md", ".mdx", ".csv", ".txt", ".tsv", ".json"];

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

function isPdf(fileName: string, mimeType?: string): boolean {
  return mimeType === "application/pdf" || extOf(fileName) === ".pdf";
}

function isOffice(fileName: string): boolean {
  return OFFICE_EXTS.includes(extOf(fileName));
}

function isText(fileName: string): boolean {
  return TEXT_EXTS.includes(extOf(fileName));
}

function parseEntries(raw: string): Array<{ content: string; category: string }> {
  try {
    const cleaned = raw.replace(/```json\n?|```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

// ─── Mutations ref builder ─────────────────────────────────────────────────────

function makeMutations() {
  return {
    getJob: internal.orgDocuments.pipelineGetJob,
    setStatus: internal.orgDocuments.pipelineSetStatus,
    setCheckpoint: internal.orgDocuments.pipelineSetCheckpoint,
    appendLog: internal.orgDocuments.pipelineAppendLog,
    clearLog: internal.orgDocuments.pipelineClearLog,
  };
}

// ─── Phase factory ─────────────────────────────────────────────────────────────

export function makePhases(convexCtx: ActionCtx): Phase<OrgDocumentExtractionState>[] {
  // ── Phase 1: decode ───────────────────────────────────────────────────────────
  const decodePhase: Phase<OrgDocumentExtractionState> = {
    name: "decode",
    run: async (pCtx): Promise<PhaseResult<OrgDocumentExtractionState>> => {
      const { state } = pCtx.checkpoint;
      await pCtx.log("Decoding file…");

      const blob = await convexCtx.storage.get(state.storageId as any);
      if (!blob) return { kind: "error", error: "File not found in storage" };

      const fileName = state.fileName;

      let inputKind: "text" | "pdf";
      let inputText: string | undefined;

      try {
        if (isPdf(fileName, blob.type)) {
          // For PDF, we don't store the bytes in state (too large).
          // The extract_parallel phase re-fetches from storage.
          inputKind = "pdf";
          await pCtx.log("PDF detected — will extract with AI model");
        } else if (isOffice(fileName)) {
          const ext = extOf(fileName);
          const buf = Buffer.from(await blob.arrayBuffer());
          let text: string;
          if (DOCX_EXTS.includes(ext)) {
            const { value } = await mammoth.extractRawText({ buffer: buf });
            text = value;
          } else {
            const wb = XLSX.read(buf, { type: "buffer" });
            text = wb.SheetNames.map((name) => {
              const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
              return `# ${name}\n${csv}`;
            }).join("\n\n");
          }
          if (!text.trim()) return { kind: "error", error: "Office document appears empty" };
          inputKind = "text";
          inputText = text.length > 24000 ? text.slice(0, 24000) + "\n... [truncated]" : text;
          await pCtx.log(`Office document decoded (${inputText.length} chars)`);
        } else if (isText(fileName)) {
          const text = await blob.text();
          if (!text.trim()) return { kind: "error", error: "File is empty" };
          inputKind = "text";
          inputText = text.length > 24000 ? text.slice(0, 24000) + "\n... [truncated]" : text;
          await pCtx.log(`Text file decoded (${inputText.length} chars)`);
        } else {
          return { kind: "error", error: `Unsupported file type: ${extOf(fileName) || "unknown"}` };
        }
      } catch (err) {
        return {
          kind: "error",
          error: `Failed to decode file: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }

      return {
        kind: "next",
        nextPhase: "classify",
        state: { ...state, inputKind, inputText },
      };
    },
  };

  // ── Phase 2: classify ─────────────────────────────────────────────────────────
  const classifyPhase: Phase<OrgDocumentExtractionState> = {
    name: "classify",
    run: async (pCtx): Promise<PhaseResult<OrgDocumentExtractionState>> => {
      const { state } = pCtx.checkpoint;
      await pCtx.log("Classifying document…");

      const fileName = state.fileName;
      const systemPrompt = `You classify insurance / business documents. Given a file and optional preview, return JSON:
{
  "documentType": "financial_statement" | "loss_run" | "payroll_schedule" | "fleet_list" | "certificate" | "general",
  "documentDate": "<ISO date or null>",
  "asOfDate": "<ISO date or null>",
  "sourceLabel": "<short human label, e.g. '2024 P&L' or 'Q3 Loss Run'>"
}
Respond with ONLY valid JSON, no markdown.`;

      let userContent: any[];

      if (state.inputKind === "pdf") {
        const blob = await convexCtx.storage.get(state.storageId as any);
        if (!blob) return { kind: "error", error: "File not found in storage during classify" };
        const pdfBytes = new Uint8Array(await blob.arrayBuffer());
        userContent = [
          { type: "text" as const, text: `File: ${fileName}` },
          { type: "file" as const, data: pdfBytes, mediaType: "application/pdf", filename: fileName },
        ];
      } else {
        const header = `File: ${fileName}\n\n${(state.inputText ?? "").slice(0, 4000)}`;
        userContent = [{ type: "text" as const, text: header }];
      }

      const { text } = await generateText({
        model: getModel("document_extraction"),
        maxOutputTokens: 512,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      });

      let classification: ClassificationResult;
      try {
        const cleaned = text.replace(/```json\n?|```\n?/g, "").trim();
        const parsed = JSON.parse(cleaned);
        const validTypes: DocumentType[] = [
          "financial_statement", "loss_run", "payroll_schedule",
          "fleet_list", "certificate", "general",
        ];
        classification = {
          documentType: validTypes.includes(parsed.documentType) ? parsed.documentType : "general",
          documentDate: parsed.documentDate ?? undefined,
          asOfDate: parsed.asOfDate ?? undefined,
          sourceLabel: parsed.sourceLabel ?? undefined,
        };
      } catch {
        classification = { documentType: "general" };
      }

      await pCtx.log(`Classified as: ${classification.documentType}${classification.sourceLabel ? ` (${classification.sourceLabel})` : ""}`);

      return {
        kind: "next",
        nextPhase: "extract_parallel",
        state: { ...state, classification },
      };
    },
  };

  // ── Phase 3: extract_parallel ─────────────────────────────────────────────────
  const extractParallelPhase: Phase<OrgDocumentExtractionState> = {
    name: "extract_parallel",
    run: async (pCtx): Promise<PhaseResult<OrgDocumentExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const classification = state.classification!;
      const fileName = state.fileName;

      await pCtx.log("Extracting intelligence…");

      // Build model input
      let input: ModelInput;
      if (state.inputKind === "pdf") {
        const blob = await convexCtx.storage.get(state.storageId as any);
        if (!blob) return { kind: "error", error: "File not found in storage during extract" };
        const pdfBytes = new Uint8Array(await blob.arrayBuffer());
        input = { kind: "pdf", bytes: pdfBytes, fileName };
      } else {
        input = { kind: "text", text: state.inputText ?? "" };
      }

      const temporalHint = [
        classification.asOfDate && `as-of date: ${classification.asOfDate}`,
        classification.documentDate && `document date: ${classification.documentDate}`,
      ].filter(Boolean).join(", ");
      const temporalInstruction = temporalHint
        ? `\nTemporal context for this document: ${temporalHint}. Always include dates, time periods, and as-of dates in extracted facts.`
        : "\nAlways include dates, time periods, and as-of dates in extracted facts when available.";

      async function runExtractionPrompt(system: string): Promise<Array<{ content: string; category: string }>> {
        const header = `Document: ${fileName}`;
        const userContent: any[] =
          input.kind === "pdf"
            ? [
                { type: "text" as const, text: header },
                { type: "file" as const, data: input.bytes, mediaType: "application/pdf", filename: fileName },
              ]
            : [{ type: "text" as const, text: `${header}\n\n${input.text}` }];

        const { text } = await generateTextWithFallback({
          model: getModel("document_extraction"),
          maxOutputTokens: 16384,
          system,
          messages: [{ role: "user", content: userContent }],
        });
        return parseEntries(text);
      }

      let allEntries: Array<{ content: string; category: string }>;
      const isFinancial = ["financial_statement", "loss_run", "payroll_schedule"].includes(classification.documentType);

      if (isFinancial) {
        const financialSystem = `You are extracting structured financial data from a ${classification.documentType.replace(/_/g, " ")}. ${temporalHint ? `Temporal context: ${temporalHint}.` : ""}

For each financial metric, produce a fact that includes:
- The metric name and value
- The time period or as-of date it applies to
- Units / currency where applicable

Return ONLY valid JSON:
{ "entries": [{ "content": "...", "category": "financial" }] }

If no financial data found, return { "entries": [] }.`;

        const businessSystem = `You are extracting non-financial business intelligence from a document (company info, operations, relationships, ownership, addresses, etc.). Skip financial metrics — those are extracted separately. Only extract facts that are clearly stated or strongly implied.${temporalInstruction}

Format: { "entries": [{ "content": "...", "category": "company_info" | "products_services" | "operations" | "employees" | "clients" | "insurance" | "investors" | "vendors" | "partners" }] }
Respond with ONLY valid JSON, no markdown.
If no relevant facts found, return { "entries": [] }.`;

        const [financialEntries, businessEntries] = await Promise.all([
          runExtractionPrompt(financialSystem),
          runExtractionPrompt(businessSystem),
        ]);
        allEntries = [...financialEntries, ...businessEntries];
      } else {
        const businessSystem = `You are extracting business intelligence from a document. Extract structured facts about the company, its operations, finances, and relationships. Only extract facts that are clearly stated or strongly implied.${temporalInstruction}

Format: { "entries": [{ "content": "...", "category": "company_info" | "products_services" | "operations" | "employees" | "financial" | "clients" | "insurance" | "investors" | "vendors" | "partners" }] }
Respond with ONLY valid JSON, no markdown.
If no relevant business facts found, return { "entries": [] }.`;

        const riskSystem = `You are extracting risk signals from a document. Extract information about claims, incidents, compliance issues, risk exposures, and business changes. Only extract facts that are clearly stated or strongly implied.

Do NOT extract insurance coverage details (limits, deductibles, policy terms) — those are handled separately by policy extraction.${temporalInstruction}

Format: { "entries": [{ "content": "...", "category": "risk" | "observation" }] }
Respond with ONLY valid JSON, no markdown.
If no relevant risk signals found, return { "entries": [] }.`;

        const [businessEntries, riskEntries] = await Promise.all([
          runExtractionPrompt(businessSystem),
          runExtractionPrompt(riskSystem),
        ]);
        allEntries = [...businessEntries, ...riskEntries];
      }

      await pCtx.log(`Extracted ${allEntries.length} entries`);

      return {
        kind: "next",
        nextPhase: "embed_and_dedup",
        state: { ...state, entriesJson: JSON.stringify(allEntries) },
      };
    },
  };

  // ── Phase 4: embed_and_dedup ──────────────────────────────────────────────────
  const embedAndDedupPhase: Phase<OrgDocumentExtractionState> = {
    name: "embed_and_dedup",
    run: async (pCtx): Promise<PhaseResult<OrgDocumentExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const orgDocumentId = pCtx.jobId;
      const orgId = state.orgId as Id<"organizations">;
      const classification = state.classification!;

      const allEntries: Array<{ content: string; category: string }> = JSON.parse(state.entriesJson ?? "[]");

      await pCtx.log(`Embedding ${allEntries.length} entries and deduplicating…`);

      const embedText = makeEmbedText();
      let inserted = 0;

      for (const entry of allEntries) {
        if (!entry.content?.trim()) continue;
        let embedding: number[] | undefined;
        try {
          embedding = await embedText(entry.content);
          const similar = await convexCtx.vectorSearch("orgIntelligence", "by_embedding", {
            vector: embedding,
            limit: 3,
            filter: (q: any) => q.eq("orgId", orgId),
          });
          if (similar.some((s: { _score?: number }) => (s._score ?? 0) > 0.95)) continue;
        } catch (err) {
          console.error("embed_and_dedup: embed failed, inserting without embedding", err);
        }
        try {
          await convexCtx.runMutation(
            (internal as any).intelligence.insert,
            {
              orgId,
              content: entry.content,
              category: entry.category as any,
              confidence: "confirmed" as const,
              source: "manual" as const,
              sourceRef: state.storageId,
              sourceLabel: classification.sourceLabel,
              asOfDate: classification.asOfDate,
              documentDate: classification.documentDate,
              embedding,
            },
          );
          inserted++;
        } catch (err) {
          console.error("embed_and_dedup: intelligence insert failed", err);
        }
      }

      await pCtx.log(`Stored ${inserted} intelligence entries`);

      return {
        kind: "next",
        nextPhase: "update_document",
        state: { ...state, entriesJson: JSON.stringify([]) }, // free memory
      };
    },
  };

  // ── Phase 5: update_document (terminal) ───────────────────────────────────────
  const updateDocumentPhase: Phase<OrgDocumentExtractionState> = {
    name: "update_document",
    run: async (pCtx): Promise<PhaseResult<OrgDocumentExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const orgDocumentId = pCtx.jobId;
      const orgId = state.orgId as Id<"organizations">;
      const classification = state.classification!;

      // Count inserted entries — we stored them in the previous phase so don't have exact count.
      // Update the document row with classification metadata and mark legacy status "complete".
      await convexCtx.runMutation(
        (internal as any).orgDocuments.updateStatus,
        {
          id: orgDocumentId,
          orgId,
          extractionStatus: "complete",
          sourceLabel: classification.sourceLabel,
          documentType: classification.documentType,
          asOfDate: classification.asOfDate,
          documentDate: classification.documentDate,
        },
      );

      await pCtx.log("Document extraction complete");
      return { kind: "done" };
    },
  };

  return [decodePhase, classifyPhase, extractParallelPhase, embedAndDedupPhase, updateDocumentPhase];
}

// ─── advance internal action ───────────────────────────────────────────────────

export const advance = internalAction({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const mutations = makeMutations();
    const storage = createConvexStorageAdapter<OrgDocumentExtractionState>({
      ctx: ctx as any,
      mutations,
    });
    const scheduler = createConvexSchedulerAdapter({
      ctx: ctx as any,
      advanceAction: internal.actions.orgDocumentExtraction.advance,
    });
    const phases = makePhases(ctx);
    await advancePhase({ jobId, phases, storage, scheduler });
  },
});

// ─── Entry point: start ────────────────────────────────────────────────────────

export const startOrgDocumentExtraction = internalAction({
  args: {
    orgDocumentId: v.id("orgDocuments"),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  handler: async (ctx, { orgDocumentId, orgId, userId, storageId, fileName }) => {
    const mutations = makeMutations();
    const storage = createConvexStorageAdapter<OrgDocumentExtractionState>({
      ctx: ctx as any,
      mutations,
    });
    const scheduler = createConvexSchedulerAdapter({
      ctx: ctx as any,
      advanceAction: internal.actions.orgDocumentExtraction.advance,
    });
    await ctx.runMutation(internal.orgDocuments.pipelineClearLog, {
      jobId: String(orgDocumentId),
    });
    const phases = makePhases(ctx);
    await runPipeline<OrgDocumentExtractionState>({
      jobId: String(orgDocumentId),
      phases,
      storage,
      scheduler,
      initialState: {
        orgId: String(orgId),
        userId: String(userId),
        storageId: String(storageId),
        fileName,
      },
    });
  },
});

// ─── Entry point: retry ────────────────────────────────────────────────────────

export const retryOrgDocumentExtraction = action({
  args: {
    orgDocumentId: v.id("orgDocuments"),
    mode: v.union(v.literal("resume"), v.literal("full")),
  },
  returns: v.any(),
  handler: async (ctx, { orgDocumentId, mode }) => {
    const viewer = await ctx.runQuery(api.users.viewer) as { _id: string } | null;
    if (!viewer) return { error: "Not authenticated" };

    const orgData = await ctx.runQuery(api.orgs.viewerOrg, {}) as { membership: { orgId: string } } | null;
    if (!orgData) return { error: "No organization" };

    const mutations = makeMutations();
    const storage = createConvexStorageAdapter<OrgDocumentExtractionState>({
      ctx: ctx as any,
      mutations,
    });
    const scheduler = createConvexSchedulerAdapter({
      ctx: ctx as any,
      advanceAction: internal.actions.orgDocumentExtraction.advance,
    });

    if (mode === "full") {
      await ctx.runMutation(internal.orgDocuments.pipelineClearLog, {
        jobId: String(orgDocumentId),
      });
    }

    // Recover state from existing checkpoint
    const doc = await ctx.runQuery(
      (internal as any).orgDocuments.belongsToOrg,
      { id: orgDocumentId, orgId: orgData.membership.orgId },
    ) as boolean;
    if (!doc) return { error: "Document not found or access denied" };

    const phases = makePhases(ctx);
    await runPipeline<OrgDocumentExtractionState>({
      jobId: String(orgDocumentId),
      phases,
      storage,
      scheduler,
      retryMode: mode,
      // initialState only used if retryMode="full" and no checkpoint
      initialState: {
        orgId: orgData.membership.orgId,
        userId: viewer._id,
        storageId: "", // will be recovered from checkpoint
        fileName: "",
      },
    });

    return { success: true };
  },
});
