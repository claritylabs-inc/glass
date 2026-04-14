"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getModel } from "../lib/models";
import { makeEmbedText } from "../lib/sdkCallbacks";
import { logAiError } from "../lib/aiUtils";
import { generateText, Output } from "ai";
import { z } from "zod";

const CATEGORY_VALUES = [
  "company_info",
  "operations",
  "financial",
  "coverage",
  "risk",
  "relationship",
  "observation",
] as const;

type Category = (typeof CATEGORY_VALUES)[number];

const dreamResultSchema = z.object({
  staleIds: z.array(z.string()).describe("IDs of entries to mark as stale"),
  consolidated: z.array(
    z.object({
      content: z.string(),
      category: z.enum(CATEGORY_VALUES),
    }),
  ).describe("New or updated consolidated entries"),
  gaps: z.array(z.string()).describe("Questions we should know answers to"),
  summary: z.string().describe("2-3 sentence holistic org intelligence summary"),
});

/**
 * Weekly "dream" consolidation — reviews all extracted intelligence for an org,
 * resolves conflicts, merges duplicates, identifies gaps, and generates a summary.
 */

export const runDreamForAllOrgs = internalAction({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.runQuery(internal.orgs.listAllInternal, {});

    for (const org of orgs) {
      // Check if the org has any intelligence entries worth consolidating
      const entries = await ctx.runQuery(internal.intelligence.listActiveByOrg, {
        orgId: org._id,
      });
      if (entries.length >= 3) {
        await ctx.scheduler.runAfter(0, internal.actions.dreamConsolidation.dreamForOrg, {
          orgId: org._id,
        });
      }
    }
  },
});

export const dreamForOrg = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    try {
      const entries = await ctx.runQuery(internal.intelligence.listActiveByOrg, {
        orgId: args.orgId,
      });

      if (entries.length < 3) return;

      // Group entries by category
      const grouped: Record<string, typeof entries> = {};
      for (const entry of entries) {
        const cat = entry.category;
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(entry);
      }

      // Format entries for the prompt
      const formattedSections: string[] = [];
      for (const [category, catEntries] of Object.entries(grouped)) {
        const lines = catEntries.map(
          (e: any) =>
            `  - [${e._id}] (confidence: ${e.confidence}, source: ${e.source}, updated: ${new Date(e.updatedAt).toISOString().slice(0, 10)}) ${e.content}`,
        );
        formattedSections.push(`### ${category}\n${lines.join("\n")}`);
      }

      const prompt = `You are an insurance intelligence analyst performing a weekly review of extracted business context for a company.

Review the following intelligence entries grouped by category. For each category:
1. Identify duplicate or near-duplicate entries and mark the older/less specific ones as stale
2. When entries conflict (e.g., different employee counts), keep the most recent or most specific
3. Create consolidated entries that merge related facts
4. Identify important gaps — things we should know but don't

IMPORTANT:
- staleIds must contain the exact bracket IDs from the entries below (e.g. the string inside [...])
- Only create consolidated entries when merging or improving upon existing entries
- Gaps should be specific, actionable questions

CURRENT INTELLIGENCE:
${formattedSections.join("\n\n")}`;

      const result = await generateText({
        model: getModel("analysis"),
        maxOutputTokens: 4096,
        output: Output.object({ schema: dreamResultSchema }),
        messages: [{ role: "user", content: prompt }],
      });

      const dreamResult = result.output;
      if (!dreamResult) {
        console.warn(`Dream consolidation produced no output for org ${args.orgId}`);
        return;
      }

      // Validate staleIds — only keep IDs that match actual entry IDs
      const entryIdSet = new Set(entries.map((e: any) => e._id));
      const validStaleIds = dreamResult.staleIds.filter((id) =>
        entryIdSet.has(id as any),
      );

      // Mark stale entries
      if (validStaleIds.length > 0) {
        await ctx.runMutation(internal.intelligence.markStale, {
          ids: validStaleIds as any,
        });
      }

      // Insert consolidated entries with embeddings
      const embedText = makeEmbedText();

      for (const consolidated of dreamResult.consolidated) {
        const embedding = await embedText(consolidated.content);
        await ctx.runMutation(internal.intelligence.insert, {
          orgId: args.orgId,
          content: consolidated.content,
          category: consolidated.category,
          confidence: "inferred",
          source: "dream",
          embedding,
        });
      }

      // Insert gaps as observations
      for (const gap of dreamResult.gaps) {
        const gapContent = `GAP: ${gap}`;
        const embedding = await embedText(gapContent);
        await ctx.runMutation(internal.intelligence.insert, {
          orgId: args.orgId,
          content: gapContent,
          category: "observation",
          confidence: "inferred",
          source: "dream",
          embedding,
        });
      }

      // Update org with intelligence summary and dream timestamp
      await ctx.runMutation(internal.orgs.updateDreamResults, {
        orgId: args.orgId,
        intelligenceSummary: dreamResult.summary,
        lastDreamAt: Date.now(),
      });

      console.log(
        `Dream consolidation complete for org ${args.orgId}: ` +
          `${validStaleIds.length} stale, ${dreamResult.consolidated.length} consolidated, ${dreamResult.gaps.length} gaps`,
      );
    } catch (err) {
      logAiError("dreamConsolidation", err, { orgId: args.orgId });
    }
  },
});
