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

const DREAM_SYSTEM = `You are an insurance intelligence analyst. Respond with ONLY valid JSON, no markdown or explanation.

Format:
{
  "deleteIds": ["id1", "id2"],
  "consolidated": [{ "content": "...", "category": "company_info" | "operations" | "financial" | "coverage" | "risk" | "relationship" | "observation" }],
  "gaps": ["question1", "question2"],
  "summary": "2-3 sentence summary of this organization's intelligence profile"
}`;

function formatEntries(entries: any[]): string {
  const grouped: Record<string, any[]> = {};
  for (const entry of entries) {
    const cat = entry.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(entry);
  }
  const sections: string[] = [];
  for (const [category, catEntries] of Object.entries(grouped)) {
    const lines = catEntries.map((e: any) => {
      const tags: string[] = [
        `confidence: ${e.confidence}`,
        `source: ${e.source}`,
        `updated: ${new Date(e.updatedAt).toISOString().slice(0, 10)}`,
      ];
      if (e.asOfDate) tags.push(`as-of: ${e.asOfDate}`);
      if (e.sourceLabel) tags.push(`from: ${e.sourceLabel}`);
      return `  - [${e._id}] (${tags.join(", ")}) ${e.content}`;
    });
    sections.push(`### ${category}\n${lines.join("\n")}`);
  }
  return sections.join("\n\n");
}

function parseDreamResult(text: string): {
  deleteIds: string[];
  consolidated: Array<{ content: string; category: string }>;
  gaps: string[];
  summary: string;
} | null {
  try {
    const cleaned = text.replace(/```json\n?|```\n?/g, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    return null;
  }
}

export const dreamForOrg = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args): Promise<void> => {
    const startTime = Date.now();
    try {
      const entries = await ctx.runQuery(internal.intelligence.listActiveByOrg, {
        orgId: args.orgId,
      });

      if (entries.length < 3) return;

      const entryIdSet = new Set(entries.map((e: any) => e._id));
      const embedText = makeEmbedText();
      const formattedSections = formatEntries(entries);

      console.log(
        `Dream consolidation for org ${args.orgId}: ${entries.length} entries`,
      );

      const prompt = `You are an insurance intelligence analyst performing a weekly review of extracted business context for a company.

Review the following intelligence entries grouped by category. For each category:
1. DELETE duplicates, near-duplicates, and the older/less specific version of conflicting entries
2. DELETE low-value noise — individual transaction details, receipt line items, routine vendor interactions, spam-sourced entries, and anything that isn't meaningful business intelligence on its own
3. When entries conflict (e.g., different employee counts or revenue figures): If both have as-of dates, keep the MORE RECENT as-of date. If only one has an as-of date, prefer it. If neither has dates, keep the most recently updated entry.
4. CONSOLIDATE related facts into single, richer entries (e.g., merge 5 separate vendor mentions into one "Key vendors" entry)
5. Identify important gaps — things we should know but don't

Be aggressive about pruning. The goal is a clean, high-signal intelligence store. Individual data points like "Payment of $247.50 to Office Depot" or "Receipt from UPS Store" should be deleted unless they reveal something meaningful about the business (e.g., a pattern of large equipment purchases).

IMPORTANT:
- deleteIds must contain the exact bracket IDs from the entries below (e.g. the string inside [...])
- Only create consolidated entries when merging or improving upon existing entries
- Gaps should be specific, actionable questions
- When consolidating financial data, always include the time period (e.g. 'as of FY2025')
- Flag entries that are likely outdated (e.g. revenue from 2+ years ago without a newer figure)

CURRENT INTELLIGENCE:
${formattedSections}`;

      const result = await generateText({
        model: getModel("analysis"),
        system: DREAM_SYSTEM,
        prompt,
      });

      const dreamResult = parseDreamResult(result.text);
      if (!dreamResult) {
        const errMsg = `Unparseable output. Raw (first 500 chars): ${result.text.slice(0, 500)}`;
        console.warn(`Dream consolidation for org ${args.orgId}: ${errMsg}`);
        await ctx.runMutation(internal.dreamLogs.insert, {
          orgId: args.orgId,
          status: "error",
          entriesReviewed: entries.length,
          entriesDeleted: 0,
          entriesConsolidated: 0,
          gapsIdentified: 0,
          error: errMsg,
          durationMs: Date.now() - startTime,
        });
        return;
      }

      if (!dreamResult.deleteIds) dreamResult.deleteIds = [];
      if (!dreamResult.consolidated) dreamResult.consolidated = [];
      if (!dreamResult.gaps) dreamResult.gaps = [];

      // Validate deleteIds — only keep IDs that match actual entry IDs
      const validDeleteIds = dreamResult.deleteIds.filter((id) =>
        entryIdSet.has(id as any),
      );

      if (validDeleteIds.length > 0) {
        await ctx.runMutation(internal.intelligence.bulkDelete, {
          ids: validDeleteIds as any,
        });
      }

      for (const consolidated of dreamResult.consolidated) {
        if (!consolidated.content?.trim()) continue;
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

      for (const gap of dreamResult.gaps ?? []) {
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
      if (dreamResult.summary) {
        await ctx.runMutation(internal.orgs.updateDreamResults, {
          orgId: args.orgId,
          intelligenceSummary: dreamResult.summary,
          lastDreamAt: Date.now(),
        });
      }

      await ctx.runMutation(internal.dreamLogs.insert, {
        orgId: args.orgId,
        status: "success",
        entriesReviewed: entries.length,
        entriesDeleted: validDeleteIds.length,
        entriesConsolidated: dreamResult.consolidated.length,
        gapsIdentified: (dreamResult.gaps ?? []).length,
        summary: dreamResult.summary || undefined,
        durationMs: Date.now() - startTime,
      });

      console.log(
        `Dream consolidation complete for org ${args.orgId}: ` +
          `${validDeleteIds.length} deleted, ${dreamResult.consolidated.length} consolidated, ${(dreamResult.gaps ?? []).length} gaps`,
      );
    } catch (err) {
      logAiError("dreamConsolidation", err, { orgId: args.orgId });
      await ctx.runMutation(internal.dreamLogs.insert, {
        orgId: args.orgId,
        status: "error",
        entriesReviewed: 0,
        entriesDeleted: 0,
        entriesConsolidated: 0,
        gapsIdentified: 0,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
      });
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
