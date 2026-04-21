"use node";

import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { getModel } from "../lib/models";
import { makeEmbedText } from "../lib/sdkCallbacks";
import { logAiError } from "../lib/aiUtils";
import { generateText } from "ai";
import { Id } from "../_generated/dataModel";

/**
 * Dream consolidation — fan-out architecture.
 *
 * 1. dreamForOrg: creates log entry, groups entries by category, schedules
 *    one dreamCategory action per category (each gets its own timeout)
 * 2. dreamCategory: processes one category (with sub-batching for large ones),
 *    updates the shared log entry, then decrements the pending counter.
 *    When counter hits 0, schedules dreamFinalize.
 * 3. dreamFinalize: runs the summary/gaps pass, marks the log as complete.
 */

// ── Max entries per LLM call within a category ──
const CHUNK_SIZE = 30;

const CATEGORY_PROMPT = `You are an insurance intelligence analyst reviewing entries in ONE category.

Your goal: produce a CLEAN, HIGH-SIGNAL set of ATOMIC facts optimized for vector search retrieval.

OPERATIONS (in priority order):

1. DELETE entries that are:
   - Duplicates or near-duplicates (keep the more specific/recent one)
   - Low-value noise: receipts, individual transactions, routine vendor mentions, spam
   - Generic industry commentary not specific to THIS organization
   - Descriptions of the software/platform itself (e.g. "Prism is an AI-native system...")
   - Outdated facts superseded by newer entries with as-of dates
   - Insurance coverage details (limits, deductibles, policy terms, coverage lines) — these belong in policy extraction, not org intelligence. DELETE them.

2. SPLIT over-consolidated entries into atomic facts. Each consolidated entry should contain ONE fact that answers ONE question. Examples:
   BAD (too broad): "FY2025 Financials: Revenue $15.2M, Gross Profit $9.5M, Net Income $2.7M, Total Assets $18.4M..."
   GOOD (atomic): Create separate entries for each:
     - "FY2025 annual revenue: $15.2M (as of December 31, 2025)"
     - "FY2025 gross profit: $9.5M (as of December 31, 2025)"
     - "FY2025 net income: $2.7M (as of December 31, 2025)"
     - "Total assets: $18.4M (as of December 31, 2025)"

   BAD (too broad): "Company holds a CGL policy with Carrier X, coverage includes Bodily Injury $5M, Products $5M, Medical $25K..."
   GOOD (atomic): Create separate entries for each:
     - "CGL policy with Carrier X, active through 2027-08-04"
     - "General liability per-occurrence limit: $5,000,000 (Carrier X CGL)"
     - "Products/completed operations aggregate: $5,000,000 (Carrier X CGL)"
     - "Medical payments limit: $25,000 per person (Carrier X CGL)"

3. When entries conflict: prefer the one with a more recent as-of date, or most recently updated if neither has dates.

WHY ATOMIC: Each entry gets its own embedding vector. A query like "what's our revenue?" should match a focused revenue entry with high cosine similarity, not a mega-entry where revenue is diluted among 15 other metrics.

4. RECATEGORIZE entries that are in the wrong category. Pay close attention to INTERNAL vs EXTERNAL:

   INTERNAL categories (facts about THIS organization itself):
   - company_info: the org's own entity details, legal name, addresses, structure, founding date
   - products_services: this org's own products and services — product specs, features, pricing, service standards, SLAs, delivery methods
   - operations: this org's own internal processes, equipment, fleet, facilities
   - employees: this org's own headcount, roles, departments, HR details
   - financial: this org's own revenue, payroll, assets, budgets, expenses
   - risk: claims, incidents, hazards, compliance issues affecting this org

   EXTERNAL relationship categories (facts about OTHER companies/people):
   - clients: companies or people who BUY FROM this org
   - insurance: brokers, carriers, underwriters who INSURE this org (relationship only — NOT coverage details like limits, deductibles, or policy terms which belong in policy extraction)
   - investors: investors, shareholders, funds who INVEST IN this org
   - vendors: companies who SELL TO or PROVIDE SERVICES to this org
   - partners: joint ventures, affiliates, or uncertain external relationships

   - observation: general business changes, plans, or anything that doesn't fit above

   COMMON MISTAKES to fix via recategorize:
   - "Acme Corp is a client" filed under company_info → should be clients
   - "Uses AWS for hosting" filed under company_info → should be vendors
   - "Broker is Smith Insurance" filed under relationship → should be insurance
   - "CEO is John Smith" filed under relationship → should be employees
   - "Annual revenue $5M" filed under operations → should be financial

IMPORTANT:
- deleteIds: exact bracket IDs from the entries (the string inside [...])
- recategorize: array of { "id": "bracket-id", "category": "correct_category" } for mis-categorized entries
- Each consolidated entry must be a SINGLE fact (one metric, one coverage line, one relationship)
- Always include temporal context (time period, as-of date) in each entry
- 15-80 words per entry is ideal. Over 100 words means it should be split further.
- NEVER truncate content mid-sentence. Every consolidated entry must be a complete, self-contained statement.`;

function parseDreamResult(text: string): Record<string, unknown> | null {
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

function formatEntryLines(entries: Record<string, unknown>[]): string[] {
  return entries.map((e) => {
    const updatedAt =
      typeof e.updatedAt === "number" || typeof e.updatedAt === "string"
        ? new Date(e.updatedAt)
        : new Date(0);
    const tags: string[] = [
      `confidence: ${e.confidence}`,
      `source: ${e.source}`,
      `updated: ${updatedAt.toISOString().slice(0, 10)}`,
    ];
    if (e.asOfDate) tags.push(`as-of: ${e.asOfDate}`);
    if (e.sourceLabel) tags.push(`from: ${e.sourceLabel}`);
    return `  - [${e._id}] (${tags.join(", ")}) ${e.content}`;
  });
}

// ── Cron entry point ──

export const runDreamForAllOrgs = internalAction({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.runQuery(internal.orgs.listAllInternal, {});
    for (const org of orgs) {
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

// ── Step 1: Coordinator — creates log, fans out per-category actions ──

export const dreamForOrg = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args): Promise<void> => {
    const [entries, org] = await Promise.all([
      ctx.runQuery(internal.intelligence.listActiveByOrg, { orgId: args.orgId }),
      ctx.runQuery(internal.orgs.getInternal, { id: args.orgId }),
    ]);

    if (entries.length < 3) return;

    // Build org context string for category workers
    const orgParts: string[] = [];
    if (org?.name) orgParts.push(`Company: ${org.name}`);
    if (org?.context) orgParts.push(`Description: ${org.context}`);
    if (org?.industry) orgParts.push(`Industry: ${org.industry}`);
    if (org?.website) orgParts.push(`Website: ${org.website}`);
    // Relationship context — critical for correct categorization
    if (org?.clientsContext) orgParts.push(`Clients/Customers: ${org.clientsContext}`);
    if (org?.vendorsContext) orgParts.push(`Vendors/Suppliers: ${org.vendorsContext}`);
    if (org?.insuranceContext) orgParts.push(`Insurance relationships: ${org.insuranceContext}`);
    if (org?.investorsContext) orgParts.push(`Investors: ${org.investorsContext}`);
    if (org?.partnersContext) orgParts.push(`Partners: ${org.partnersContext}`);
    const orgContext = orgParts.length > 0 ? orgParts.join(". ") : "";

    // Group by category
    const grouped: Record<string, number> = {};
    for (const entry of entries) {
      grouped[entry.category] = (grouped[entry.category] || 0) + 1;
    }

    const categories = Object.keys(grouped);
    const catSummary = categories.map((c) => `${c}(${grouped[c]})`).join(", ");

    // Create log entry immediately
    const logId = await ctx.runMutation(internal.dreamLogs.insert, {
      orgId: args.orgId,
      status: "running",
      entriesReviewed: entries.length,
      entriesDeleted: 0,
      entriesConsolidated: 0,
      gapsIdentified: 0,
      log: [
        `Starting dream consolidation: ${entries.length} entries`,
        `Categories: ${catSummary}`,
        `Scheduling ${categories.length} category workers...`,
      ],
      durationMs: 0,
    });

    // Delete all coverage entries upfront — coverage belongs in policy extraction, not org intelligence
    const coverageEntries = entries.filter((e: { category: string }) => e.category === "coverage");
    if (coverageEntries.length > 0) {
      await ctx.runMutation(internal.intelligence.bulkDelete, {
        ids: coverageEntries.map((e: { _id: string }) => e._id as Id<"orgIntelligence">),
      });
      await appendLogLine(ctx, logId, `Purged ${coverageEntries.length} coverage entries (handled by policy extraction)`);
      await ctx.runMutation(internal.dreamLogs.update, {
        id: logId,
        entriesDeleted: coverageEntries.length,
      });
    }

    // Also purge legacy "relationship" entries — should be recategorized into specific types
    // (the category workers will handle recategorization for entries that are actually in other categories)

    // Schedule one action per category (each gets its own Convex action timeout)
    // Skip "coverage" (just purged) and categories with < 2 entries
    let scheduled = 0;
    for (const category of categories) {
      if (category === "coverage") continue;
      if (grouped[category] < 2) continue;
      await ctx.scheduler.runAfter(0, internal.actions.dreamConsolidation.dreamCategory, {
        orgId: args.orgId,
        category,
        logId,
        startTime: Date.now(),
        orgContext,
      });
      scheduled++;
    }

    // Schedule a lightweight completion marker after workers are expected to finish
    const delayMs = Math.max(30000, scheduled * 20000);
    await ctx.scheduler.runAfter(delayMs, internal.actions.dreamConsolidation.dreamMarkComplete, {
      logId,
      startTime: Date.now(),
    });
  },
});

// ── Step 2: Per-category worker — processes one category with sub-batching ──

export const dreamCategory = internalAction({
  args: {
    orgId: v.id("organizations"),
    category: v.string(),
    logId: v.id("dreamLogs"),
    startTime: v.number(),
    orgContext: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    try {
      // Fetch current entries for this category
      const allEntries = await ctx.runQuery(internal.intelligence.listActiveByOrg, {
        orgId: args.orgId,
      });
      const catEntries = allEntries.filter((e: { category: string }) => e.category === args.category);

      if (catEntries.length < 2) {
        await appendLogLine(ctx, args.logId, `${args.category}: ${catEntries.length} entry, skipping`);
        return;
      }

      const entryIdSet = new Set(catEntries.map((e: { _id: string }) => e._id as Id<"orgIntelligence">));
      const embedText = makeEmbedText();
      let totalDeleted = 0;
      let totalConsolidated = 0;
      let totalRecategorized = 0;

      // Sub-batch if category is large
      const chunks: Record<string, unknown>[][] = [];
      for (let i = 0; i < catEntries.length; i += CHUNK_SIZE) {
        chunks.push(catEntries.slice(i, i + CHUNK_SIZE));
      }

      const chunkLabel = chunks.length > 1 ? ` (${chunks.length} batches)` : "";
      await appendLogLine(ctx, args.logId, `Processing ${args.category}: ${catEntries.length} entries${chunkLabel}...`);

      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        const lines = formatEntryLines(chunk);
        const batchNote = chunks.length > 1 ? ` [batch ${ci + 1}/${chunks.length}]` : "";

        const result = await generateText({
          model: getModel("chat") as Parameters<typeof generateText>[0]["model"],
          system: `You are an insurance intelligence analyst. Respond with ONLY valid JSON, no markdown.
Format: { "reasoning": "brief explanation", "deleteIds": ["id1"], "recategorize": [{ "id": "id2", "category": "correct_category" }], "consolidated": [{ "content": "...", "category": "best_category" }] }`,
          prompt: `${args.orgContext ? `ORGANIZATION: ${args.orgContext}\n\n` : ""}${CATEGORY_PROMPT}\n\nCategory: ${args.category}${batchNote}\nEntries:\n${lines.join("\n")}`,
        });

        const parsed = parseDreamResult(result.text);
        if (!parsed) {
          await appendLogLine(ctx, args.logId, `${args.category}${batchNote}: failed to parse, skipping`);
          continue;
        }

        if (parsed.reasoning) {
          await appendLogLine(ctx, args.logId, `${args.category} reasoning: ${parsed.reasoning}`);
        }

        const deleteIds = ((parsed.deleteIds ?? []) as string[])
          .map((id) => id as Id<"orgIntelligence">)
          .filter((id) => entryIdSet.has(id));
        if (deleteIds.length > 0) {
          await ctx.runMutation(internal.intelligence.bulkDelete, { ids: deleteIds });
          for (const id of deleteIds) entryIdSet.delete(id);
          totalDeleted += deleteIds.length;
        }

        // Recategorize mis-filed entries
        const recats = ((parsed.recategorize ?? []) as Array<{ id: string; category: string }>).filter(
          (r) => r.id && r.category && entryIdSet.has(r.id as Id<"orgIntelligence">),
        );
        if (recats.length > 0) {
          await ctx.runMutation(internal.intelligence.bulkRecategorize, {
            updates: recats.map((r) => ({ id: r.id as Id<"orgIntelligence">, category: r.category as string })),
          });
          totalRecategorized += recats.length;
        }

        for (const c of (parsed.consolidated ?? []) as Array<{ content?: string; category?: string }>) {
          if (!c.content?.trim()) continue;
          const embedding = await embedText(c.content);
          await ctx.runMutation(internal.intelligence.insert, {
            orgId: args.orgId,
            content: c.content,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            category: (c.category || args.category) as any,
            confidence: "inferred",
            source: "dream",
            embedding,
          });
          totalConsolidated++;
        }
      }

      const parts = [`${totalDeleted} deleted`, `${totalConsolidated} consolidated`];
      if (totalRecategorized > 0) parts.push(`${totalRecategorized} recategorized`);
      await appendLogLine(ctx, args.logId, `${args.category}: ${parts.join(", ")}`);

      // Increment totals on the shared log
      const currentLog = await ctx.runQuery(internal.dreamLogs.get, { id: args.logId });
      if (currentLog) {
        await ctx.runMutation(internal.dreamLogs.update, {
          id: args.logId,
          entriesDeleted: (currentLog.entriesDeleted ?? 0) + totalDeleted,
          entriesConsolidated: (currentLog.entriesConsolidated ?? 0) + totalConsolidated,
        });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await appendLogLine(ctx, args.logId, `${args.category} error: ${errMsg}`);
      logAiError("dreamCategory", err, { orgId: args.orgId, category: args.category });
    }
  },
});

// ── Step 3: Mark complete (lightweight — no LLM call) ──

export const dreamMarkComplete = internalAction({
  args: {
    logId: v.id("dreamLogs"),
    startTime: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const currentLog = await ctx.runQuery(internal.dreamLogs.get, { id: args.logId });
    if (!currentLog || currentLog.status !== "running") return;

    const duration = Date.now() - args.startTime;
    const deleted = currentLog.entriesDeleted ?? 0;
    const consolidated = currentLog.entriesConsolidated ?? 0;

    await appendLogLine(ctx, args.logId,
      `Complete: ${deleted} deleted, ${consolidated} consolidated (${Math.round(duration / 1000)}s)`,
    );

    await ctx.runMutation(internal.dreamLogs.update, {
      id: args.logId,
      status: "success",
      durationMs: duration,
    });
  },
});

// ── Helper: append a line to the shared dream log ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function appendLogLine(ctx: any, logId: Id<"dreamLogs">, line: string) {
  const current = await ctx.runQuery(internal.dreamLogs.get, { id: logId });
  const lines = current?.log ?? [];
  lines.push(line);
  await ctx.runMutation(internal.dreamLogs.update, {
    id: logId,
    log: lines,
    durationMs: Date.now() - (current?.createdAt ?? Date.now()),
  });
}

// ── Public trigger ──

export const consolidate = action({
  args: {},
  handler: async (ctx) => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) throw new Error("Not authenticated");
    const orgData = await ctx.runQuery(api.orgs.viewerOrg, {});
    if (!orgData?.org) throw new Error("No organization");
    await ctx.scheduler.runAfter(0, internal.actions.dreamConsolidation.dreamForOrg, {
      orgId: orgData.org._id,
    });
    return { scheduled: true };
  },
});
