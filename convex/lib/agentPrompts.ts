"use node";

/**
 * Agent prompts and context building — cl-sdk
 *
 * SDK exports (unchanged): buildAgentSystemPrompt, buildConversationMemoryGuidance
 * Local implementations: buildDocumentContext (vector search), buildConversationMemoryContext (vector search)
 *
 * The old SDK's buildDocumentContext/buildConversationMemoryContext are removed.
 * We replace them with vector-search-backed retrieval from Convex.
 */

// SDK exports (still work)
export { buildAgentSystemPrompt, buildConversationMemoryGuidance } from "@claritylabs/cl-sdk";
export type { PolicyDocument, QuoteDocument, AgentContext, Platform, CommunicationIntent } from "@claritylabs/cl-sdk";

// Local mapping
export { policyToInsuranceDoc } from "./documentMapping";

import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { makeEmbedText } from "./sdkCallbacks";

/**
 * Build document context using vector search over pre-embedded chunks.
 * Falls back to a simple index of all policies when no chunks exist.
 *
 * Must be called from an action context (vectorSearch is action-only).
 */
export async function buildDocumentContext(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  policies: Doc<"policies">[],
  quotes: Doc<"policies">[],
  queryText: string,
): Promise<{ context: string; relevantPolicyIds: Id<"policies">[]; relevantQuoteIds: Id<"policies">[] }> {
  if (policies.length === 0 && quotes.length === 0) {
    return {
      context: "NO POLICIES OR QUOTES FOUND. The user has not imported any insurance documents yet.",
      relevantPolicyIds: [],
      relevantQuoteIds: [],
    };
  }

  // Check if we have embedded chunks for this org
  const hasChunks = await ctx.runQuery(internal.documentChunks.hasChunksForOrg, { orgId });

  if (hasChunks) {
    return buildVectorContext(ctx, orgId, policies, quotes, queryText);
  }

  // Fallback: build simple index (same as old SDK behavior)
  return buildFallbackContext(policies, quotes, queryText);
}

/**
 * Build org memory context — recent facts/preferences/observations captured
 * via chat tool calls, agent email conversations, and website pulls.
 */
export async function buildIntelligenceContext(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  _queryText: string,
  _excludePolicyIds?: string[],
): Promise<string> {
  try {
    const memories = await ctx.runQuery(internal.orgMemory.listByOrg, {
      orgId,
      limit: 30,
    });
    if (!memories || memories.length === 0) return "";

    const grouped: Record<string, string[]> = {};
    for (const m of memories) {
      const bucket = m.type ?? "observation";
      if (!grouped[bucket]) grouped[bucket] = [];
      const tag = m.source ? ` [${m.source}]` : "";
      grouped[bucket].push(`- ${m.content}${tag}`);
    }

    const labels: Record<string, string> = {
      fact: "Facts",
      preference: "Preferences",
      risk_note: "Risk Notes",
      observation: "Observations",
    };

    const sections: string[] = [];
    for (const [bucket, items] of Object.entries(grouped)) {
      sections.push(`${labels[bucket] ?? bucket}:\n${items.join("\n")}`);
    }
    return `\n\nORG MEMORY:\n${sections.join("\n\n")}`;
  } catch {
    return "";
  }
}

/**
 * Vector-search-based document context.
 * Embeds the query, searches documentChunks, and formats results.
 */
async function buildVectorContext(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  policies: Doc<"policies">[],
  quotes: Doc<"policies">[],
  queryText: string,
): Promise<{ context: string; relevantPolicyIds: Id<"policies">[]; relevantQuoteIds: Id<"policies">[] }> {
  const embed = makeEmbedText(ctx, orgId);
  const queryEmbedding = await embed(queryText);

  const results = await ctx.vectorSearch("documentChunks", "by_embedding", {
    vector: queryEmbedding,
    limit: 15,
    filter: (q) => q.eq("orgId", orgId),
  });

  // Hydrate chunks
  const chunkDocs = [];
  for (const result of results) {
    const doc = await ctx.runQuery(internal.documentChunks.get, { id: result._id });
    if (doc) chunkDocs.push({ ...doc, _score: result._score });
  }

  // Group by policy
  const allDocs = [...policies, ...quotes];
  const policyMap = new Map(allDocs.map((p) => [p._id, p]));
  const relevantPolicyIdSet = new Set<Id<"policies">>();
  const relevantQuoteIdSet = new Set<Id<"policies">>();

  const parts: string[] = [];

  // Build index of all policies/quotes
  if (policies.length > 0) {
    const indexLines = policies.map((p, i) => {
      const types = p.policyTypes?.join(", ") ?? "unknown";
      const carrier = p.mga || p.carrier || p.security;
      const covSummary = (p.coverages ?? []).slice(0, 8).map((c: any) => {
        const parts = [c.name];
        if (c.limit) parts.push(c.limit);
        return parts.join(": ");
      }).join("; ");
      const covLine = covSummary ? ` | Coverages: ${covSummary}` : "";
      return `[${i + 1}] ${carrier} | #${p.policyNumber} | Types: ${types} | ${p.effectiveDate} to ${p.expirationDate ?? "continuous"} | Insured: ${p.insuredName}${covLine}`;
    });
    parts.push(`POLICY INDEX (${policies.length} bound policies):\n${indexLines.join("\n")}`);
  }
  if (quotes.length > 0) {
    const indexLines = quotes.map((q, i) => {
      const carrier = q.mga || q.carrier || q.security;
      return `[Q${i + 1}] ${carrier} | #${q.quoteNumber ?? q.policyNumber} | Insured: ${q.insuredName} | Premium: ${q.premium ?? "N/A"}`;
    });
    parts.push(`QUOTE INDEX (${quotes.length} quotes):\n${indexLines.join("\n")}`);
  }

  // Add retrieved chunks grouped by policy
  const chunksByPolicy = new Map<string, typeof chunkDocs>();
  for (const chunk of chunkDocs) {
    const key = chunk.policyId as string;
    if (!chunksByPolicy.has(key)) chunksByPolicy.set(key, []);
    chunksByPolicy.get(key)!.push(chunk);
  }

  const expandedSections: string[] = [];
  for (const [policyId, policyChunks] of chunksByPolicy) {
    const policy = policyMap.get(policyId as Id<"policies">);
    if (!policy) continue;

    const isQuote = policy.documentType === "quote";
    if (isQuote) {
      relevantQuoteIdSet.add(policyId as Id<"policies">);
    } else {
      relevantPolicyIdSet.add(policyId as Id<"policies">);
    }

    const carrier = policy.mga || policy.carrier || policy.security;
    const docLabel = isQuote ? "QUOTE" : "POLICY";
    const number = isQuote ? (policy.quoteNumber ?? policy.policyNumber) : policy.policyNumber;

    let section = `\n--- ${docLabel}: ${carrier} #${number} (ID:${policyId}) ---`;
    if (policy.summary) section += `\nSummary: ${policy.summary}`;

    for (const chunk of policyChunks) {
      const truncated = chunk.text.length > 2000
        ? chunk.text.slice(0, 2000) + "\n... [truncated]"
        : chunk.text;
      section += `\n\n[${chunk.chunkType}]:\n${truncated}`;
    }

    expandedSections.push(section);
  }

  if (expandedSections.length > 0) {
    parts.push(`RELEVANT DOCUMENT DATA (via semantic search):\n${expandedSections.join("\n")}`);
  }

  return {
    context: parts.join("\n\n"),
    relevantPolicyIds: [...relevantPolicyIdSet],
    relevantQuoteIds: [...relevantQuoteIdSet],
  };
}

/**
 * Fallback context for orgs without embedded chunks.
 * Simple keyword scoring — same approach as old SDK.
 */
function buildFallbackContext(
  policies: Doc<"policies">[],
  quotes: Doc<"policies">[],
  queryText: string,
): { context: string; relevantPolicyIds: Id<"policies">[]; relevantQuoteIds: Id<"policies">[] } {
  const queryLower = queryText.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);

  // Score policies by keyword match
  const scoredPolicies = policies.map((p) => {
    let score = 0;
    const searchText = [
      p.carrier, p.security, p.policyNumber, p.insuredName,
      ...(p.policyTypes ?? []),
      ...(p.coverages?.map((c: { name?: string }) => c.name) ?? []),
      p.summary,
    ].filter(Boolean).join(" ").toLowerCase();
    for (const word of queryWords) {
      if (searchText.includes(word)) score++;
    }
    return { policy: p, score };
  });

  const scoredQuotes = quotes.map((q) => {
    let score = 0;
    const searchText = [
      q.carrier, q.security, q.quoteNumber, q.insuredName,
      ...(q.policyTypes ?? []),
      ...(q.coverages?.map((c: { name?: string }) => c.name) ?? []),
    ].filter(Boolean).join(" ").toLowerCase();
    for (const word of queryWords) {
      if (searchText.includes(word)) score++;
    }
    if (queryLower.includes("quote") || queryLower.includes("proposal")) score += 3;
    return { quote: q, score };
  });

  const topPolicies = scoredPolicies.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
  const policiesToExpand = topPolicies.length > 0 ? topPolicies.map((r) => r.policy) : policies.slice(0, 5);
  const relevantPolicyIds = policiesToExpand.map((p) => p._id);

  const topQuotes = scoredQuotes.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
  const quotesToExpand = topQuotes.length > 0 ? topQuotes.map((r) => r.quote) : quotes.slice(0, 3);
  const relevantQuoteIds = quotesToExpand.map((q) => q._id);

  const parts: string[] = [];

  if (policies.length > 0) {
    const indexLines = policies.map((p, i) => {
      const types = p.policyTypes?.join(", ") ?? "unknown";
      const carrier = p.mga || p.carrier || p.security;
      const coverages = p.coverages?.slice(0, 5).map((c: { name?: string; limit?: string }) => `${c.name}: ${c.limit}`).join("; ") ?? "";
      return `[${i + 1}] ${carrier} | #${p.policyNumber} | Types: ${types} | ${p.effectiveDate} to ${p.expirationDate ?? "continuous"} | Insured: ${p.insuredName} | Coverages: ${coverages}`;
    });
    parts.push(`POLICY INDEX (${policies.length} bound policies):\n${indexLines.join("\n")}`);
  }

  // Expand relevant policies
  const expanded = policiesToExpand.map((p) => {
    const carrier = p.security || p.carrier;
    let section = `\n--- POLICY: ${carrier} #${p.policyNumber} ---`;
    if (p.summary) section += `\nSummary: ${p.summary}`;
    if (p.coverages?.length) {
      section += "\nCoverages:";
      for (const c of p.coverages as Array<{ name?: string; limit?: string; deductible?: string }>) {
        section += `\n  - ${c.name}: Limit ${c.limit}${c.deductible ? `, Deductible ${c.deductible}` : ""}`;
      }
    }
    return section;
  });
  if (expanded.length > 0) {
    parts.push(`DETAILED POLICY DATA:\n${expanded.join("\n")}`);
  }

  return { context: parts.join("\n\n"), relevantPolicyIds, relevantQuoteIds };
}

/**
 * Build conversation memory context using vector search.
 * Falls back to formatting provided conversations if no turns are embedded.
 *
 * For action context with vector search:
 */
export async function buildConversationMemoryContext(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  queryText: string,
): Promise<string> {
  try {
    const embed = makeEmbedText(ctx, orgId);
    const queryEmbedding = await embed(queryText);

    const results = await ctx.vectorSearch("conversationTurns", "by_embedding", {
      vector: queryEmbedding,
      limit: 10,
      filter: (q) => q.eq("orgId", orgId),
    });

    if (results.length === 0) return "";

    const turns = [];
    for (const result of results) {
      const doc = await ctx.runQuery(internal.conversationTurns.get, { id: result._id });
      if (doc) turns.push(doc);
    }

    if (turns.length === 0) return "";

    const MAX_CHARS = 3000;
    let total = 0;
    const entries: string[] = [];

    for (const turn of turns) {
      const date = new Date(turn.createdAt).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
      });
      const snippet = turn.content.slice(0, 200).replace(/\n+/g, " ");
      const entry = `[${turn.role}] (${date}): ${snippet}`;
      if (total + entry.length > MAX_CHARS) break;
      entries.push(entry);
      total += entry.length;
    }

    if (entries.length === 0) return "";
    return `\n\nCONVERSATION MEMORY (relevant past interactions):\n${entries.join("\n")}`;
  } catch {
    // Vector search may fail if no turns exist yet — gracefully degrade
    return "";
  }
}

/**
 * Legacy-compatible conversation memory builder.
 * Takes pre-loaded conversations (for use when vector search isn't available).
 */
export function buildConversationMemoryFromList(
  conversations: Array<{
    _creationTime: number;
    fromName?: string;
    fromEmail: string;
    subject: string;
    body: string;
    responseBody?: string;
  }>,
): string {
  if (conversations.length === 0) return "";

  const MAX_CHARS = 3000;
  let total = 0;
  const entries: string[] = [];

  for (let i = 0; i < conversations.length; i++) {
    const c = conversations[i];
    const date = new Date(c._creationTime).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
    const who = c.fromName ? `${c.fromName} (${c.fromEmail})` : c.fromEmail;
    const q = c.body.slice(0, 200).replace(/\n+/g, " ");
    const a = (c.responseBody ?? "").slice(0, 300).replace(/\n+/g, " ");
    const entry = `[${i + 1}] "${c.subject}" -- Asked by ${who} on ${date}\nQ: ${q}\nA: ${a}`;
    if (total + entry.length > MAX_CHARS) break;
    entries.push(entry);
    total += entry.length;
  }

  if (entries.length === 0) return "";
  return `\n\nCONVERSATION MEMORY (past conversations from this organization):\n${entries.join("\n\n")}`;
}
