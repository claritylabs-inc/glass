"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { makeEmbedText } from "../lib/sdkCallbacks";

// ── Category mappings ──

const BUSINESS_CONTEXT_CATEGORY_MAP: Record<string, string> = {
  company_info: "company_info",
  operations: "operations",
  financial: "financial",
  coverage: "coverage",
  loss_history: "coverage",
};

const BUSINESS_CONTEXT_SOURCE_MAP: Record<string, string> = {
  onboarding: "manual",
  application: "application",
  user_email: "email",
  manual: "manual",
};

const BUSINESS_CONTEXT_CONFIDENCE_MAP: Record<string, string> = {
  confirmed: "confirmed",
  inferred: "inferred",
};

const MEMORY_CATEGORY_MAP: Record<string, string> = {
  fact: "company_info",
  preference: "observation",
  risk_note: "risk",
  observation: "observation",
};

const MEMORY_SOURCE_MAP: Record<string, string> = {
  extraction: "extraction",
  analysis: "extraction",
  chat: "chat",
  email: "email",
};

// ── Helpers ──

async function embedBatch(
  embedText: (text: string) => Promise<number[]>,
  texts: string[],
  batchSize = 10,
): Promise<(number[] | undefined)[]> {
  const results: (number[] | undefined)[] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await Promise.all(
      batch.map(async (text) => {
        try {
          return await embedText(text);
        } catch (err) {
          console.error(`Failed to embed text: ${text.slice(0, 80)}...`, err);
          return undefined;
        }
      }),
    );
    results.push(...embeddings);
    // Small delay between batches to avoid rate limits
    if (i + batchSize < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  return results;
}

// ── Migration action ──

export const migrateAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const embedText = makeEmbedText();

    // 1. Check which orgs already have intelligence entries (idempotency)
    // We'll track per-org to skip orgs that already have data

    // 2. Fetch all source data
    const [businessContextEntries, memoryEntries] = await Promise.all([
      ctx.runQuery(internal.businessContext.listAllInternal, {}),
      ctx.runQuery(internal.orgMemory.listAllInternal, {}),
    ]);

    console.log(
      `Migration: found ${businessContextEntries.length} business context entries, ${memoryEntries.length} memory entries`,
    );

    // Collect unique org IDs and check which already have intelligence entries
    const orgIds = new Set<string>();
    for (const e of businessContextEntries) orgIds.add(e.orgId);
    for (const e of memoryEntries) orgIds.add(e.orgId);

    const alreadyMigratedOrgs = new Set<string>();
    for (const orgId of orgIds) {
      const existing = await ctx.runQuery(internal.intelligence.listByOrg, {
        orgId: orgId as string,
      });
      if (existing.length > 0) {
        alreadyMigratedOrgs.add(orgId);
      }
    }

    if (alreadyMigratedOrgs.size > 0) {
      console.log(
        `Migration: skipping ${alreadyMigratedOrgs.size} orgs that already have intelligence entries`,
      );
    }

    // 3. Build intelligence entries from business context
    const pendingEntries: Array<{
      orgId: string;
      content: string;
      category: string;
      confidence: string;
      source: string;
      sourceRef?: string;
      createdAt: number;
      updatedAt: number;
    }> = [];

    for (const entry of businessContextEntries) {
      if (alreadyMigratedOrgs.has(entry.orgId)) continue;

      const content = `${entry.key}: ${entry.value}`;
      pendingEntries.push({
        orgId: entry.orgId,
        content,
        category:
          BUSINESS_CONTEXT_CATEGORY_MAP[entry.category] ?? "company_info",
        confidence:
          BUSINESS_CONTEXT_CONFIDENCE_MAP[entry.confidence] ?? "inferred",
        source: BUSINESS_CONTEXT_SOURCE_MAP[entry.source] ?? "manual",
        createdAt: entry.updatedAt, // orgBusinessContext has no createdAt
        updatedAt: entry.updatedAt,
      });
    }

    // 4. Build intelligence entries from orgMemory
    for (const entry of memoryEntries) {
      if (alreadyMigratedOrgs.has(entry.orgId)) continue;

      pendingEntries.push({
        orgId: entry.orgId,
        content: entry.content,
        category: MEMORY_CATEGORY_MAP[entry.type] ?? "observation",
        confidence: "inferred",
        source: MEMORY_SOURCE_MAP[entry.source] ?? "extraction",
        sourceRef: entry.policyId ? String(entry.policyId) : undefined,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      });
    }

    console.log(
      `Migration: ${pendingEntries.length} entries to migrate after filtering`,
    );

    if (pendingEntries.length === 0) {
      console.log("Migration: nothing to migrate");
      return { migrated: 0 };
    }

    // 5. Generate embeddings in batches of 10
    const texts = pendingEntries.map((e) => e.content);
    console.log(`Migration: generating embeddings for ${texts.length} entries`);
    const embeddings = await embedBatch(embedText, texts, 10);

    // 6. Insert into orgIntelligence in batches of 50
    let totalInserted = 0;
    const INSERT_BATCH_SIZE = 50;

    for (let i = 0; i < pendingEntries.length; i += INSERT_BATCH_SIZE) {
      const batch = pendingEntries.slice(i, i + INSERT_BATCH_SIZE);
      const batchEmbeddings = embeddings.slice(i, i + INSERT_BATCH_SIZE);

      const entries = batch.map((entry, idx) => ({
        orgId: entry.orgId as string,
        content: entry.content,
        category: entry.category,
        confidence: entry.confidence,
        source: entry.source,
        sourceRef: entry.sourceRef,
        embedding: batchEmbeddings[idx],
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }));

      await ctx.runMutation(internal.intelligence.bulkInsertWithTimestamps, {
        entries,
      });

      totalInserted += batch.length;
      console.log(
        `Migration: inserted ${totalInserted}/${pendingEntries.length}`,
      );
    }

    console.log(`Migration: complete — migrated ${totalInserted} entries`);
    return { migrated: totalInserted };
  },
});
