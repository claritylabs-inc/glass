"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { makeEmbedText } from "../lib/sdkCallbacks";
import { getModel } from "../lib/models";
import { generateText } from "ai";
import { Id } from "../_generated/dataModel";

/**
 * Extract business intelligence from a non-PDF document upload (md, mdx, csv, docx, etc.).
 * Reads the file as text, runs it through the intelligence extraction agents,
 * and stores results in orgIntelligence.
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

    // Run parallel extraction agents (same as email intelligence pipeline)
    try {
      const [businessResult, riskResult] = await Promise.all([
        generateText({
          model: getModel("email_extraction"),
          maxOutputTokens: 4096,
          system: `You are extracting business intelligence from a document. Extract structured facts about the company, its operations, finances, and relationships. Only extract facts that are clearly stated or strongly implied. Respond with ONLY valid JSON, no markdown.

Format: { "entries": [{ "content": "...", "category": "company_info" | "operations" | "financial" | "relationship" }] }

If no relevant business facts found, return { "entries": [] }.`,
          prompt: `Document: ${fileName}\n\n${truncated}`,
        }),
        generateText({
          model: getModel("email_extraction"),
          maxOutputTokens: 4096,
          system: `You are extracting risk signals and insurance intelligence from a document. Extract information about coverage discussions, claims, incidents, compliance, risk exposures, and business changes. Only extract facts that are clearly stated or strongly implied. Respond with ONLY valid JSON, no markdown.

Format: { "entries": [{ "content": "...", "category": "coverage" | "risk" | "observation" }] }

If no relevant risk/insurance signals found, return { "entries": [] }.`,
          prompt: `Document: ${fileName}\n\n${truncated}`,
        }),
      ]);

      function parseEntries(raw: string): Array<{ content: string; category: string }> {
        try {
          const cleaned = raw.replace(/```json\n?|```\n?/g, "").trim();
          const parsed = JSON.parse(cleaned);
          return Array.isArray(parsed?.entries) ? parsed.entries : [];
        } catch { return []; }
      }

      const allEntries = [...parseEntries(businessResult.text), ...parseEntries(riskResult.text)];

      if (allEntries.length === 0) {
        return { success: true, entries: 0 };
      }

      // Embed and store
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
            confidence: "inferred" as const,
            source: "manual" as const,
            sourceRef: args.fileId as string,
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
