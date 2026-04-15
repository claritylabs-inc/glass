"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { makeEmbedText } from "../lib/sdkCallbacks";
import { getModel } from "../lib/models";
import { generateText } from "ai";
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
  documentDate?: string;   // ISO date the document was created / effective
  asOfDate?: string;        // ISO date the data is "as of"
  sourceLabel?: string;     // short human-readable label, e.g. "2024 P&L"
}

/* ------------------------------------------------------------------ */
/*  Helpers (module-scope)                                             */
/* ------------------------------------------------------------------ */

function parseEntries(raw: string): Array<{ content: string; category: string }> {
  try {
    const cleaned = raw.replace(/```json\n?|```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch { return []; }
}

/* ------------------------------------------------------------------ */
/*  Step 1 — Classify document type + extract temporal metadata        */
/* ------------------------------------------------------------------ */

async function classifyDocument(
  fileName: string,
  textPreview: string,
): Promise<ClassificationResult> {
  const { text } = await generateText({
    model: getModel("summary"),
    maxOutputTokens: 512,
    system: `You classify insurance / business documents. Given a file name and a short preview, return a JSON object:
{
  "documentType": "financial_statement" | "loss_run" | "payroll_schedule" | "fleet_list" | "certificate" | "general",
  "documentDate": "<ISO date or null>",
  "asOfDate": "<ISO date or null>",
  "sourceLabel": "<short human label, e.g. '2024 P&L' or 'Q3 Loss Run'>"
}
Respond with ONLY valid JSON, no markdown.`,
    prompt: `File: ${fileName}\n\n${textPreview.slice(0, 4000)}`,
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
/*  Step 2a — Structured KV extraction for financial documents         */
/* ------------------------------------------------------------------ */

async function extractFinancialKVs(
  fileName: string,
  truncated: string,
  classification: ClassificationResult,
): Promise<Array<{ content: string; category: string }>> {
  const temporalHint = [
    classification.asOfDate && `as-of date: ${classification.asOfDate}`,
    classification.documentDate && `document date: ${classification.documentDate}`,
  ].filter(Boolean).join(", ");

  const { text } = await generateText({
    model: getModel("email_extraction"),
    maxOutputTokens: 4096,
    system: `You are extracting structured financial data from a ${classification.documentType.replace(/_/g, " ")}. ${temporalHint ? `Temporal context: ${temporalHint}.` : ""}

For each financial metric, produce a fact that includes:
- The metric name and value
- The time period or as-of date it applies to
- Units / currency where applicable

Return ONLY valid JSON:
{ "entries": [{ "content": "...", "category": "financial" }] }

If no financial data found, return { "entries": [] }.`,
    prompt: `Document: ${fileName}\n\n${truncated}`,
  });

  return parseEntries(text);
}

/* ------------------------------------------------------------------ */
/*  Main action                                                        */
/* ------------------------------------------------------------------ */

/**
 * Extract business intelligence from a non-PDF document upload (md, mdx, csv, docx, etc.).
 * Three-step pipeline:
 *   1. Classify document type and extract temporal metadata
 *   2. For financial docs → structured KV extraction with time periods
 *   3. For other docs → two-agent extraction with temporal awareness
 */
export const extractFromDocument = action({
  args: {
    fileId: v.id("_storage"),
    fileName: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<{ error: string } | { success: true; entries: number }> => {
    const viewer = await ctx.runQuery(api.users.viewer) as any;
    if (!viewer) return { error: "Not authenticated" };

    const orgData = await ctx.runQuery(api.orgs.viewerOrg) as any;
    if (!orgData) return { error: "No organization" };

    const orgId = orgData.membership.orgId as Id<"organizations">;

    const blob = await ctx.storage.get(args.fileId);
    if (!blob) return { error: "File not found" };

    // Read file as text
    let text: string;
    try {
      text = await blob.text();
    } catch {
      return { error: "Could not read file as text" };
    }

    if (!text.trim()) return { error: "File is empty" };

    // Truncate to ~16K chars for context window
    const truncated = text.length > 16000 ? text.slice(0, 16000) + "\n... [truncated]" : text;
    const fileName = args.fileName ?? "uploaded document";

    try {
      /* ── Step 1: Classify ────────────────────────────────────── */
      const classification = await classifyDocument(fileName, truncated);

      const temporalHint = [
        classification.asOfDate && `as-of date: ${classification.asOfDate}`,
        classification.documentDate && `document date: ${classification.documentDate}`,
      ].filter(Boolean).join(", ");
      const temporalInstruction = temporalHint
        ? `\nTemporal context for this document: ${temporalHint}. Always include dates, time periods, and as-of dates in extracted facts.`
        : "\nAlways include dates, time periods, and as-of dates in extracted facts when available.";

      /* ── Step 2: Extract ─────────────────────────────────────── */
      let allEntries: Array<{ content: string; category: string }>;

      if (["financial_statement", "loss_run", "payroll_schedule"].includes(classification.documentType)) {
        // Financial docs: structured KV extraction + supplemental business context
        const [financialEntries, businessResult] = await Promise.all([
          extractFinancialKVs(fileName, truncated, classification),
          generateText({
            model: getModel("email_extraction"),
            maxOutputTokens: 4096,
            system: `You are extracting non-financial business intelligence from a document (company info, operations, relationships, ownership, addresses, etc.). Skip financial metrics — those are extracted separately. Only extract facts that are clearly stated or strongly implied.${temporalInstruction}

Format: { "entries": [{ "content": "...", "category": "company_info" | "products_services" | "operations" | "employees" | "clients" | "insurance" | "investors" | "vendors" | "partners" }] }
Respond with ONLY valid JSON, no markdown.
If no relevant facts found, return { "entries": [] }.`,
            prompt: `Document: ${fileName}\n\n${truncated}`,
          }),
        ]);

        allEntries = [...financialEntries, ...parseEntries(businessResult.text)];
      } else {
        // Non-financial docs: two-agent extraction with temporal awareness
        const [businessResult, riskResult] = await Promise.all([
          generateText({
            model: getModel("email_extraction"),
            maxOutputTokens: 4096,
            system: `You are extracting business intelligence from a document. Extract structured facts about the company, its operations, finances, and relationships. Only extract facts that are clearly stated or strongly implied.${temporalInstruction}

Format: { "entries": [{ "content": "...", "category": "company_info" | "products_services" | "operations" | "employees" | "financial" | "clients" | "insurance" | "investors" | "vendors" | "partners" }] }
Respond with ONLY valid JSON, no markdown.
If no relevant business facts found, return { "entries": [] }.`,
            prompt: `Document: ${fileName}\n\n${truncated}`,
          }),
          generateText({
            model: getModel("email_extraction"),
            maxOutputTokens: 4096,
            system: `You are extracting risk signals and insurance intelligence from a document. Extract information about coverage discussions, claims, incidents, compliance, risk exposures, and business changes. Only extract facts that are clearly stated or strongly implied.${temporalInstruction}

Format: { "entries": [{ "content": "...", "category": "coverage" | "risk" | "observation" }] }
Respond with ONLY valid JSON, no markdown.
If no relevant risk/insurance signals found, return { "entries": [] }.`,
            prompt: `Document: ${fileName}\n\n${truncated}`,
          }),
        ]);

        allEntries = [...parseEntries(businessResult.text), ...parseEntries(riskResult.text)];
      }

      if (allEntries.length === 0) {
        return { success: true, entries: 0 };
      }

      /* ── Step 3: Embed & store ───────────────────────────────── */
      const embedText = makeEmbedText();
      let inserted = 0;

      for (const entry of allEntries) {
        if (!entry.content?.trim()) continue;
        try {
          const embedding = await embedText(entry.content);

          // Dedup check
          const similar = await ctx.vectorSearch("orgIntelligence", "by_embedding", {
            vector: embedding,
            limit: 3,
            filter: (q: any) => q.eq("orgId", orgId),
          });
          if (similar.some((s: any) => s._score > 0.95)) continue;

          await ctx.runMutation(internal.intelligence.insert, {
            orgId,
            content: entry.content,
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

      return { success: true, entries: inserted };
    } catch (err: any) {
      return { error: `Extraction failed: ${err.message || "Unknown error"}` };
    }
  },
});
