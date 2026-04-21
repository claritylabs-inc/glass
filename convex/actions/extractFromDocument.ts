"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { makeEmbedText } from "../lib/sdkCallbacks";
import { getModel, generateTextWithFallback } from "../lib/models";
import { generateText } from "ai";
import { parseOffice } from "officeparser";
import { Id } from "../_generated/dataModel";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  File type detection                                                */
/* ------------------------------------------------------------------ */

const OFFICE_EXTS = [".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp"];
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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function parseEntries(raw: string): Array<{ content: string; category: string }> {
  try {
    const cleaned = raw.replace(/```json\n?|```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Step 1 — Classification                                            */
/* ------------------------------------------------------------------ */

async function classifyDocument(
  fileName: string,
  input: ModelInput,
): Promise<ClassificationResult> {
  const systemPrompt = `You classify insurance / business documents. Given a file and optional preview, return JSON:
{
  "documentType": "financial_statement" | "loss_run" | "payroll_schedule" | "fleet_list" | "certificate" | "general",
  "documentDate": "<ISO date or null>",
  "asOfDate": "<ISO date or null>",
  "sourceLabel": "<short human label, e.g. '2024 P&L' or 'Q3 Loss Run'>"
}
Respond with ONLY valid JSON, no markdown.`;

  const header =
    input.kind === "text"
      ? `File: ${fileName}\n\n${input.text.slice(0, 4000)}`
      : `File: ${fileName}`;

  const userContent =
    input.kind === "pdf"
      ? [
          { type: "text" as const, text: header },
          {
            type: "file" as const,
            data: input.bytes,
            mediaType: "application/pdf",
            filename: fileName,
          },
        ]
      : [{ type: "text" as const, text: header }];

  const { text } = await generateText({
    model: getModel("document_extraction"),
    maxOutputTokens: 512,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  try {
    const cleaned = text.replace(/```json\n?|```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const validTypes: DocumentType[] = [
      "financial_statement", "loss_run", "payroll_schedule",
      "fleet_list", "certificate", "general",
    ];
    return {
      documentType: validTypes.includes(parsed.documentType) ? parsed.documentType : "general",
      documentDate: parsed.documentDate ?? undefined,
      asOfDate: parsed.asOfDate ?? undefined,
      sourceLabel: parsed.sourceLabel ?? undefined,
    };
  } catch {
    return { documentType: "general" };
  }
}

/* ------------------------------------------------------------------ */
/*  Step 2 — Extraction prompts                                        */
/* ------------------------------------------------------------------ */

async function runExtractionPrompt(params: {
  system: string;
  fileName: string;
  input: ModelInput;
}): Promise<Array<{ content: string; category: string }>> {
  const { system, fileName, input } = params;
  const header = `Document: ${fileName}`;

  const userContent =
    input.kind === "pdf"
      ? [
          { type: "text" as const, text: header },
          {
            type: "file" as const,
            data: input.bytes,
            mediaType: "application/pdf",
            filename: fileName,
          },
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

/* ------------------------------------------------------------------ */
/*  Main action                                                        */
/* ------------------------------------------------------------------ */

export const extractFromDocument = action({
  args: {
    fileId: v.id("_storage"),
    fileName: v.optional(v.string()),
    documentId: v.optional(v.id("orgDocuments")),
  },
  returns: v.any(),
  handler: async (
    ctx,
    args,
  ): Promise<{ error: string } | { success: true; entries: number }> => {
    const viewer = (await ctx.runQuery(api.users.viewer)) as { _id: string } | null;
    if (!viewer) return { error: "Not authenticated" };

    const orgData = (await ctx.runQuery(api.orgs.viewerOrg)) as
      | { membership: { orgId: string } }
      | null;
    if (!orgData) return { error: "No organization" };
    const orgId = orgData.membership.orgId as Id<"organizations">;

    const docId = args.documentId ?? null;

    // Client-provided ids are untrusted; enforce org ownership before status updates.
    if (docId) {
      const belongsToOrg = await ctx.runQuery(internal.orgDocuments.belongsToOrg, {
        id: docId,
        orgId,
      });
      if (!belongsToOrg) return { error: "Invalid document reference" };
    }

    const fail = async (message: string) => {
      if (docId) {
        await ctx.runMutation(internal.orgDocuments.updateStatus, {
          id: docId,
          orgId,
          extractionStatus: "error",
          extractionError: message,
        });
      }
      return { error: message };
    };

    if (docId) {
      await ctx.runMutation(internal.orgDocuments.updateStatus, {
        id: docId,
        orgId,
        extractionStatus: "extracting",
      });
    }

    const blob = await ctx.storage.get(args.fileId);
    if (!blob) return fail("File not found");

    const fileName = args.fileName ?? "uploaded document";

    // ── Decode input based on file type ──
    let input: ModelInput;
    try {
      if (isPdf(fileName, blob.type)) {
        const buf = new Uint8Array(await blob.arrayBuffer());
        input = { kind: "pdf", bytes: buf, fileName };
      } else if (isOffice(fileName)) {
        const buf = Buffer.from(await blob.arrayBuffer());
        const ast = await parseOffice(buf);
        const text = ast.toText();
        if (!text.trim()) return fail("Office document appears empty");
        const truncated = text.length > 24000 ? text.slice(0, 24000) + "\n... [truncated]" : text;
        input = { kind: "text", text: truncated };
      } else if (isText(fileName)) {
        const text = await blob.text();
        if (!text.trim()) return fail("File is empty");
        const truncated = text.length > 24000 ? text.slice(0, 24000) + "\n... [truncated]" : text;
        input = { kind: "text", text: truncated };
      } else {
        return fail(`Unsupported file type: ${extOf(fileName) || "unknown"}`);
      }
    } catch (err) {
      return fail(
        `Failed to decode file: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }

    try {
      /* ── Step 1: Classify ───────────────────────── */
      const classification = await classifyDocument(fileName, input);

      const temporalHint = [
        classification.asOfDate && `as-of date: ${classification.asOfDate}`,
        classification.documentDate && `document date: ${classification.documentDate}`,
      ]
        .filter(Boolean)
        .join(", ");
      const temporalInstruction = temporalHint
        ? `\nTemporal context for this document: ${temporalHint}. Always include dates, time periods, and as-of dates in extracted facts.`
        : "\nAlways include dates, time periods, and as-of dates in extracted facts when available.";

      /* ── Step 2: Extract ────────────────────────── */
      let allEntries: Array<{ content: string; category: string }>;

      const isFinancial = ["financial_statement", "loss_run", "payroll_schedule"].includes(
        classification.documentType,
      );

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
          runExtractionPrompt({ system: financialSystem, fileName, input }),
          runExtractionPrompt({ system: businessSystem, fileName, input }),
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
          runExtractionPrompt({ system: businessSystem, fileName, input }),
          runExtractionPrompt({ system: riskSystem, fileName, input }),
        ]);
        allEntries = [...businessEntries, ...riskEntries];
      }

      /* ── Step 3: Embed & store ──────────────────── */
      const embedText = makeEmbedText();
      let inserted = 0;

      for (const entry of allEntries) {
        if (!entry.content?.trim()) continue;
        try {
          const embedding = await embedText(entry.content);

          const similar = await ctx.vectorSearch("orgIntelligence", "by_embedding", {
            vector: embedding,
            limit: 3,
            filter: (q) => q.eq("orgId", orgId),
          });
          if (similar.some((s: { _score?: number }) => (s._score ?? 0) > 0.95)) continue;

          await ctx.runMutation(internal.intelligence.insert, {
            orgId,
            content: entry.content,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            category: entry.category as any,
            confidence: "confirmed" as const,
            source: "manual" as const,
            sourceRef: args.fileId as string,
            sourceLabel: classification.sourceLabel,
            asOfDate: classification.asOfDate,
            documentDate: classification.documentDate,
            embedding,
          });
          inserted++;
        } catch {
          // Skip individual entry failures
        }
      }

      if (docId) {
        await ctx.runMutation(internal.orgDocuments.updateStatus, {
          id: docId,
          orgId,
          extractionStatus: "complete",
          entryCount: inserted,
          sourceLabel: classification.sourceLabel,
          documentType: classification.documentType,
          asOfDate: classification.asOfDate,
          documentDate: classification.documentDate,
        });
      }

      return { success: true, entries: inserted };
    } catch (err: unknown) {
      return fail(
        `Extraction failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  },
});
