"use node";

import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { getModel } from "../lib/models";
import { makeEmbedText } from "../lib/sdkCallbacks";
import { logAiError } from "../lib/aiUtils";
import { generateText } from "ai";

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
          (e: any) => {
            const tags: string[] = [
              `confidence: ${e.confidence}`,
              `source: ${e.source}`,
              `updated: ${new Date(e.updatedAt).toISOString().slice(0, 10)}`,
            ];
            if (e.asOfDate) tags.push(`as-of: ${e.asOfDate}`);
            if (e.sourceLabel) tags.push(`from: ${e.sourceLabel}`);
            return `  - [${e._id}] (${tags.join(", ")}) ${e.content}`;
          },
        );
        formattedSections.push(`### ${category}\n${lines.join("\n")}`);
      }

      const prompt = `You are an insurance intelligence analyst performing a weekly review of extracted business context for a company.

Review the following intelligence entries grouped by category. For each category:
1. Identify duplicate or near-duplicate entries and mark the older/less specific ones as stale
2. When entries conflict (e.g., different employee counts or revenue figures): If both have as-of dates, keep the MORE RECENT as-of date. If only one has an as-of date, prefer it. If neither has dates, keep the most recently updated entry.
3. Create consolidated entries that merge related facts
4. Identify important gaps — things we should know but don't

IMPORTANT:
- staleIds must contain the exact bracket IDs from the entries below (e.g. the string inside [...])
- Only create consolidated entries when merging or improving upon existing entries
- Gaps should be specific, actionable questions
- When consolidating financial data, always include the time period (e.g. 'as of FY2025')
- Flag entries that are likely outdated (e.g. revenue from 2+ years ago without a newer figure)

CURRENT INTELLIGENCE:
${formattedSections.join("\n\n")}`;

      const result = await generateText({
        model: getModel("analysis"),
        maxOutputTokens: 4096,
        system: `You are an insurance intelligence analyst. Respond with ONLY valid JSON, no markdown or explanation.

Format:
{
  "staleIds": ["id1", "id2"],
  "consolidated": [{ "content": "...", "category": "company_info" | "operations" | "financial" | "coverage" | "risk" | "relationship" | "observation" }],
  "gaps": ["question1", "question2"],
  "summary": "2-3 sentence summary"
}`,
        prompt,
      });

      let dreamResult: {
        staleIds: string[];
        consolidated: Array<{ content: string; category: string }>;
        gaps: string[];
        summary: string;
      };
      try {
        const cleaned = result.text.replace(/```json\n?|```\n?/g, "").trim();
        // Try direct parse first, then extract JSON object if extra text surrounds it
        try {
          dreamResult = JSON.parse(cleaned);
        } catch {
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error("No JSON found");
          dreamResult = JSON.parse(jsonMatch[0]);
        }
      } catch {
        console.warn(`Dream consolidation produced unparseable output for org ${args.orgId}`);
        return;
      }

      if (!dreamResult.staleIds) dreamResult.staleIds = [];
      if (!dreamResult.consolidated) dreamResult.consolidated = [];
      if (!dreamResult.gaps) dreamResult.gaps = [];
      if (!dreamResult.summary) dreamResult.summary = "";

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
          category: consolidated.category as any,
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

// Public action for manual consolidation trigger
export const consolidate = action({
  args: {},
  handler: async (ctx) => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) throw new Error("Not authenticated");
    const orgData = await ctx.runQuery(api.orgs.viewerOrg);
    if (!orgData?.org) throw new Error("No organization");
    await ctx.scheduler.runAfter(0, internal.actions.dreamConsolidation.dreamForOrg, {
      orgId: orgData.org._id,
    });
    return { scheduled: true };
  },
});
