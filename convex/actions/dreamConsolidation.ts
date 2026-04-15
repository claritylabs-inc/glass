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

const CATEGORY_PROMPT = `You are an insurance intelligence analyst reviewing entries in ONE category.

1. DELETE duplicates, near-duplicates, and the older/less specific version of conflicting entries
2. DELETE low-value noise — individual transaction details, receipt line items, routine vendor interactions, spam-sourced entries, and anything that isn't meaningful business intelligence on its own
3. When entries conflict (e.g., different employee counts or revenue figures): prefer the one with a more recent as-of date, or the most recently updated if neither has dates
4. CONSOLIDATE related facts into single, richer entries (e.g., merge 5 separate vendor mentions into one "Key vendors" entry)

Be aggressive about pruning. Individual data points like "Payment of $247.50 to Office Depot" or "Receipt from UPS Store" should be deleted unless they reveal something meaningful about the business.

IMPORTANT:
- deleteIds must contain the exact bracket IDs from the entries (the string inside [...])
- When consolidating financial data, always include the time period (e.g. 'as of FY2025')`;

export const dreamForOrg = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args): Promise<void> => {
    const startTime = Date.now();
    const logLines: string[] = [];

    // Create the log entry immediately so it shows up in the UI
    const entries = await ctx.runQuery(internal.intelligence.listActiveByOrg, {
      orgId: args.orgId,
    });

    if (entries.length < 3) return;

    logLines.push(`Starting dream consolidation: ${entries.length} entries`);
    const logId = await ctx.runMutation(internal.dreamLogs.insert, {
      orgId: args.orgId,
      status: "running",
      entriesReviewed: entries.length,
      entriesDeleted: 0,
      entriesConsolidated: 0,
      gapsIdentified: 0,
      log: logLines,
      durationMs: 0,
    });

    // Helper to append a log line and flush to DB
    async function appendLog(line: string) {
      logLines.push(line);
      await ctx.runMutation(internal.dreamLogs.update, {
        id: logId,
        log: logLines,
        durationMs: Date.now() - startTime,
      });
    }

    try {
      const entryIdSet = new Set(entries.map((e: any) => e._id));
      const embedText = makeEmbedText();

      // Group by category
      const grouped: Record<string, any[]> = {};
      for (const entry of entries) {
        const cat = entry.category;
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(entry);
      }

      const categories = Object.keys(grouped);
      await appendLog(`Found ${categories.length} categories: ${categories.join(", ")}`);

      let totalDeleted = 0;
      let totalConsolidated = 0;
      let totalGaps = 0;

      // ── Pass 1: Process each category independently ──
      for (const category of categories) {
        const catEntries = grouped[category];
        if (catEntries.length < 2) {
          await appendLog(`${category}: ${catEntries.length} entry, skipping`);
          continue;
        }

        await appendLog(`Processing ${category}: ${catEntries.length} entries...`);

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

        const result = await generateText({
          model: getModel("analysis"),
          system: `You are an insurance intelligence analyst. Respond with ONLY valid JSON, no markdown.
Format: { "deleteIds": ["id1"], "consolidated": [{ "content": "...", "category": "${category}" }] }`,
          prompt: `${CATEGORY_PROMPT}\n\nCategory: ${category}\nEntries:\n${lines.join("\n")}`,
        });

        const parsed = parseDreamResult(result.text);
        if (!parsed) {
          await appendLog(`${category}: failed to parse LLM output, skipping`);
          continue;
        }

        const deleteIds = (parsed.deleteIds ?? []).filter((id) => entryIdSet.has(id as any));
        if (deleteIds.length > 0) {
          await ctx.runMutation(internal.intelligence.bulkDelete, { ids: deleteIds as any });
          for (const id of deleteIds) entryIdSet.delete(id as any);
          totalDeleted += deleteIds.length;
        }

        const newConsolidated = parsed.consolidated ?? [];
        for (const c of newConsolidated) {
          if (!c.content?.trim()) continue;
          const embedding = await embedText(c.content);
          await ctx.runMutation(internal.intelligence.insert, {
            orgId: args.orgId,
            content: c.content,
            category: (c.category || category) as any,
            confidence: "inferred",
            source: "dream",
            embedding,
          });
          totalConsolidated++;
        }

        await appendLog(`${category}: ${deleteIds.length} deleted, ${newConsolidated.length} consolidated`);

        // Update running totals on the log entry
        await ctx.runMutation(internal.dreamLogs.update, {
          id: logId,
          entriesDeleted: totalDeleted,
          entriesConsolidated: totalConsolidated,
        });
      }

      // ── Pass 2: Summary + gaps ──
      await appendLog("Generating summary and identifying gaps...");

      const remaining = await ctx.runQuery(internal.intelligence.listActiveByOrg, {
        orgId: args.orgId,
      });

      const summaryLines = remaining.slice(0, 100).map((e: any) =>
        `[${e.category}] ${e.content.slice(0, 120)}`,
      );

      const summaryResult = await generateText({
        model: getModel("analysis"),
        system: `You are an insurance intelligence analyst. Respond with ONLY valid JSON, no markdown.
Format: { "gaps": ["question1", "question2"], "summary": "2-3 sentence summary of this organization's intelligence profile" }`,
        prompt: `Review these ${remaining.length} intelligence entries and identify:
1. Important GAPS — what should we know about this organization but don't?
2. A 2-3 sentence SUMMARY of the organization's overall intelligence profile.

Entries (truncated for review):\n${summaryLines.join("\n")}`,
      });

      const summaryParsed = parseDreamResult(summaryResult.text);
      let summary = "";

      if (summaryParsed) {
        for (const gap of summaryParsed.gaps ?? []) {
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
          totalGaps++;
        }
        summary = summaryParsed.summary ?? "";
        if (summary) {
          await appendLog(`Summary: ${summary}`);
        }
        if (totalGaps > 0) {
          await appendLog(`Identified ${totalGaps} knowledge gaps`);
        }
      }

      if (summary) {
        await ctx.runMutation(internal.orgs.updateDreamResults, {
          orgId: args.orgId,
          intelligenceSummary: summary,
          lastDreamAt: Date.now(),
        });
      }

      await appendLog(`Complete: ${totalDeleted} deleted, ${totalConsolidated} consolidated, ${totalGaps} gaps (${Math.round((Date.now() - startTime) / 1000)}s)`);

      await ctx.runMutation(internal.dreamLogs.update, {
        id: logId,
        status: "success",
        entriesDeleted: totalDeleted,
        entriesConsolidated: totalConsolidated,
        gapsIdentified: totalGaps,
        summary: summary || undefined,
        durationMs: Date.now() - startTime,
      });
    } catch (err) {
      logAiError("dreamConsolidation", err, { orgId: args.orgId });
      const errMsg = err instanceof Error ? err.message : String(err);
      logLines.push(`Error: ${errMsg}`);
      try {
        await ctx.runMutation(internal.dreamLogs.update, {
          id: logId,
          status: "error",
          error: errMsg,
          log: logLines,
          durationMs: Date.now() - startTime,
        });
      } catch {
        // If even logging fails, just let it go
      }
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
