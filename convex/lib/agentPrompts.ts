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
export {
  buildAgentSystemPrompt,
  buildConversationMemoryGuidance,
} from "@claritylabs/cl-sdk";
export type {
  PolicyDocument,
  QuoteDocument,
  AgentContext,
  Platform,
  CommunicationIntent,
} from "@claritylabs/cl-sdk";

// Local mapping
export { policyToInsuranceDoc } from "./documentMapping";

import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { makeEmbedText } from "./sdkCallbacks";
import { formatComplianceRequirementsContext } from "./complianceAgent";
import { formatDocumentStructureForPrompt } from "./policyDocumentStructure";

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
): Promise<{
  context: string;
  relevantPolicyIds: Id<"policies">[];
  relevantQuoteIds: Id<"policies">[];
}> {
  if (policies.length === 0 && quotes.length === 0) {
    return {
      context:
        "NO POLICIES OR QUOTES FOUND. The user has not imported any insurance documents yet.",
      relevantPolicyIds: [],
      relevantQuoteIds: [],
    };
  }

  // Prefer source-tree retrieval whenever the org has source nodes.
  const [hasDocumentChunks, hasSourceChunks, hasSourceNodes] = await Promise.all([
    ctx.runQuery(
      internal.documentChunks.hasChunksForOrg,
      { orgId },
    ),
    ctx.runQuery(
      (internal as any).sourceSpans.hasChunksForOrg,
      { orgId },
    ) as Promise<boolean>,
    ctx.runQuery(
      (internal as any).sourceNodes.hasNodesForOrg,
      { orgId },
    ) as Promise<boolean>,
  ]);

  if (!hasSourceNodes && (hasSourceChunks || hasDocumentChunks)) {
    for (const policy of [...policies, ...quotes].slice(0, 6)) {
      if (!policy.fileId || policy.sourceTreeStatus === "queued" || policy.sourceTreeStatus === "running") continue;
      await ctx.scheduler.runAfter(0, (internal as any).actions.policyExtraction.ensurePolicyV3SourceTree, {
        policyId: policy._id,
        reason: "agent_document_context",
      }).catch(() => undefined);
    }
    const fallback = buildFallbackContext(policies, quotes, queryText);
    return {
      ...fallback,
      context: `${fallback.context}\n\nSOURCE TREE REBUILD REQUIRED: This workspace has legacy policy evidence but no v3 source-node index yet. Glass has queued source-tree rebuilds for policies with stored PDFs. For exact policy-wording answers, wait for sourceTreeStatus=ready and use source nodes/spans.`,
    };
  }

  if (hasSourceNodes) {
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

export async function buildComplianceRequirementsContext(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
): Promise<string> {
  try {
    const requirements = await ctx.runQuery(
      internal.compliance.listRequirementsInternal,
      { orgId },
    );
    return formatComplianceRequirementsContext(requirements);
  } catch {
    return "";
  }
}

function sourceQueryTerms(query: string): string[] {
  return Array.from(new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9$.,%-]+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 2),
  ));
}

function scoreSourceNode(query: string, terms: string[], node: Record<string, any>): number {
  const text = [
    node.title,
    node.kind,
    node.path,
    node.description,
    node.textExcerpt,
  ].filter(Boolean).join(" ").toLowerCase();
  let score = query && text.includes(query.toLowerCase()) ? 8 : 0;
  for (const term of terms) {
    if (text.includes(term)) score += 1;
  }
  if (node.kind === "table_row" || node.kind === "schedule") score += 1.5;
  return score;
}

/**
 * Vector-search-based document context.
 * Embeds the query for structured document chunks, then ranks source-tree
 * nodes lexically for exact policy wording and provenance.
 */
async function buildVectorContext(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  policies: Doc<"policies">[],
  quotes: Doc<"policies">[],
  queryText: string,
): Promise<{
  context: string;
  relevantPolicyIds: Id<"policies">[];
  relevantQuoteIds: Id<"policies">[];
}> {
  const embed = makeEmbedText(ctx, orgId);
  const queryEmbedding = await embed(queryText);
  const allDocs = [...policies, ...quotes];
  const policyMap = new Map(allDocs.map((p) => [p._id, p]));
  const terms = sourceQueryTerms(queryText);

  const results = await ctx.vectorSearch("documentChunks", "by_embedding", {
    vector: queryEmbedding,
    limit: 30,
    filter: (q) => q.eq("orgId", orgId),
  });

  // Hydrate chunks
  const sourceNodeDocs: Array<Record<string, any>> = [];
  const allSourceNodesByPolicy = new Map<string, Array<Record<string, any>>>();
  for (const policy of allDocs.slice(0, 60)) {
    const nodes = await ctx.runQuery((internal as any).sourceNodes.listByPolicyInternal, {
      policyId: policy._id,
    }) as Array<Record<string, any>>;
    allSourceNodesByPolicy.set(String(policy._id), nodes);
    for (const node of nodes) {
      const score = scoreSourceNode(queryText, terms, node);
      if (score > 0) sourceNodeDocs.push({ ...node, _score: score });
    }
  }
  sourceNodeDocs.sort((left, right) => Number(right._score ?? 0) - Number(left._score ?? 0));
  sourceNodeDocs.splice(18);

  const chunkDocs = [];
  for (const result of results) {
    const doc = await ctx.runQuery(internal.documentChunks.get, {
      id: result._id,
    });
    if (doc && isStructuredFactChunk(doc)) chunkDocs.push({ ...doc, _score: result._score });
  }
  const sourceChunkDocs: Array<Record<string, any>> = [];

  // Group by policy
  const relevantPolicyIdSet = new Set<Id<"policies">>();
  const relevantQuoteIdSet = new Set<Id<"policies">>();

  const parts: string[] = [];

  // Build index of all policies/quotes
  if (policies.length > 0) {
    const indexLines = policies.map((p, i) => {
      const types = p.policyTypes?.join(", ") ?? "unknown";
      const carrier = p.mga || p.carrier || p.security;
      const covSummary = (p.coverages ?? [])
        .slice(0, 8)
        .map((c: any) => {
          const parts = [c.name];
          if (c.limit) parts.push(c.limit);
          return parts.join(": ");
        })
        .join("; ");
      const covLine = covSummary ? ` | Coverages: ${covSummary}` : "";
      return `[${i + 1}] ${carrier} | #${p.policyNumber} | Types: ${types} | ${p.effectiveDate} to ${p.expirationDate ?? "continuous"} | Insured: ${p.insuredName}${covLine}`;
    });
    parts.push(
      `POLICY INDEX (${policies.length} bound policies):\n${indexLines.join("\n")}`,
    );
  }
  if (quotes.length > 0) {
    const indexLines = quotes.map((q, i) => {
      const carrier = q.mga || q.carrier || q.security;
      return `[Q${i + 1}] ${carrier} | #${q.quoteNumber ?? q.policyNumber} | Insured: ${q.insuredName} | Premium: ${q.premium ?? "N/A"}`;
    });
    parts.push(
      `QUOTE INDEX (${quotes.length} quotes):\n${indexLines.join("\n")}`,
    );
  }

  const sourceNodesByPolicy = new Map<string, typeof sourceNodeDocs>();
  for (const node of sourceNodeDocs) {
    if (!node.policyId) continue;
    const key = node.policyId as string;
    if (!sourceNodesByPolicy.has(key)) sourceNodesByPolicy.set(key, []);
    sourceNodesByPolicy.get(key)!.push(node);
  }

  const sourceTreeSections: string[] = [];
  for (const [policyId, matchedNodes] of sourceNodesByPolicy) {
    const policy = policyMap.get(policyId as Id<"policies">);
    if (!policy) continue;

    const isQuote = policy.documentType === "quote";
    if (isQuote) {
      relevantQuoteIdSet.add(policyId as Id<"policies">);
    } else {
      relevantPolicyIdSet.add(policyId as Id<"policies">);
    }

    const allNodes = allSourceNodesByPolicy.get(policyId) ?? [];
    const carrier = policy.mga || policy.carrier || policy.security;
    const docLabel = isQuote ? "QUOTE" : "POLICY";
    const number = isQuote
      ? (policy.quoteNumber ?? policy.policyNumber)
      : policy.policyNumber;
    let section = `\n--- ${docLabel} SOURCE TREE: ${carrier} #${number} (ID:${policyId}) ---`;
    const profile = policy.operationalProfile
      ? JSON.stringify(policy.operationalProfile, null, 2).slice(0, 5000)
      : "";
    if (profile) section += `\nOperational profile:\n${profile}`;
    for (const node of matchedNodes.slice(0, 8)) {
      const hierarchy = expandSourceNodeContext(allNodes, node as Record<string, any>);
      section += `\n\n[sourceNode:${node.nodeId} kind:${node.kind} path:${node.path} sourceSpanIds:${(node.sourceSpanIds ?? []).join(",")} score:${Number(node._score ?? 0).toFixed(3)}]`;
      section += `\n${hierarchy.map(formatSourceNodePromptLine).join("\n")}`;
    }
    sourceTreeSections.push(section);
  }

  if (sourceTreeSections.length > 0) {
    parts.push(
      `SOURCE-TREE EVIDENCE (canonical for exact policy wording and provenance):\n${sourceTreeSections.join("\n")}`,
    );
  }

  // Add retrieved raw source chunks only as compatibility evidence for policies
  // not yet rebuilt into source nodes.
  const sourceChunksByPolicy = new Map<string, typeof sourceChunkDocs>();
  for (const chunk of sourceChunkDocs) {
    if (!chunk.policyId) continue;
    const key = chunk.policyId as string;
    if (!sourceChunksByPolicy.has(key)) sourceChunksByPolicy.set(key, []);
    sourceChunksByPolicy.get(key)!.push(chunk);
  }

  const sourceSections: string[] = [];
  for (const [policyId, policyChunks] of sourceChunksByPolicy) {
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
    const number = isQuote
      ? (policy.quoteNumber ?? policy.policyNumber)
      : policy.policyNumber;

    let section = `\n--- ${docLabel} SOURCE EVIDENCE: ${carrier} #${number} (ID:${policyId}) ---`;
    const structure = formatDocumentStructureForPrompt(policy as Record<string, unknown>, {
      maxNodes: 10,
      maxChars: 3500,
      includeSourceSpanIds: true,
    });
    if (structure) section += `\n\n${structure}`;
    for (const chunk of policyChunks) {
      const truncated =
        chunk.text.length > 2500
          ? chunk.text.slice(0, 2500) + "\n... [truncated]"
          : chunk.text;
      section += `\n\n[sourceChunk:${chunk.chunkId} sourceSpanIds:${chunk.sourceSpanIds.join(",")} score:${chunk._score.toFixed(3)}]\n${truncated}`;
    }
    sourceSections.push(section);
  }

  if (sourceSections.length > 0) {
    parts.push(
      `SOURCE-SPAN COMPATIBILITY EVIDENCE (use when source-tree evidence is absent):\n${sourceSections.join("\n")}`,
    );
  }

  // Add retrieved structured fact chunks grouped by policy. Generated section
  // prose and long policy wording are intentionally excluded; sourceChunks
  // above are the canonical evidence for exact contractual text.
  const chunksByPolicy = new Map<string, typeof chunkDocs>();
  for (const chunk of chunkDocs.slice(0, 15)) {
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
    const number = isQuote
      ? (policy.quoteNumber ?? policy.policyNumber)
      : policy.policyNumber;

    let section = `\n--- ${docLabel}: ${carrier} #${number} (ID:${policyId}) ---`;
    if (policy.summary) section += `\nSummary: ${policy.summary}`;
    const structure = formatDocumentStructureForPrompt(policy as Record<string, unknown>, {
      maxNodes: 10,
      maxChars: 3500,
      includeSourceSpanIds: true,
    });
    if (structure) section += `\n${structure}`;

    for (const chunk of policyChunks) {
      const truncated =
        chunk.text.length > 2000
          ? chunk.text.slice(0, 2000) + "\n... [truncated]"
          : chunk.text;
      section += `\n\n[${chunk.chunkType}]:\n${truncated}`;
    }

    expandedSections.push(section);
  }

  if (expandedSections.length > 0) {
    parts.push(
      `STRUCTURED DOCUMENT FACTS (secondary context, not source wording):\n${expandedSections.join("\n")}`,
    );
  }

  return {
    context: parts.join("\n\n"),
    relevantPolicyIds: [...relevantPolicyIdSet],
    relevantQuoteIds: [...relevantQuoteIdSet],
  };
}

function expandSourceNodeContext(
  allNodes: Array<Record<string, any>>,
  target: Record<string, any>,
): Array<Record<string, any>> {
  const byNodeId = new Map(allNodes.map((node) => [String(node.nodeId), node]));
  const ancestors: Array<Record<string, any>> = [];
  let parent = target.parentNodeId ? byNodeId.get(String(target.parentNodeId)) : undefined;
  while (parent) {
    ancestors.unshift(parent);
    parent = parent.parentNodeId ? byNodeId.get(String(parent.parentNodeId)) : undefined;
  }
  const children = allNodes
    .filter((node) => node.parentNodeId === target.nodeId)
    .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0))
    .slice(0, 8);
  const siblings = target.parentNodeId
    ? allNodes
        .filter((node) => node.parentNodeId === target.parentNodeId && node.nodeId !== target.nodeId)
        .sort((left, right) =>
          Math.abs(Number(left.order ?? 0) - Number(target.order ?? 0))
          - Math.abs(Number(right.order ?? 0) - Number(target.order ?? 0)))
        .slice(0, 4)
    : [];
  const seen = new Set<string>();
  return [...ancestors, target, ...children, ...siblings].filter((node) => {
    const id = String(node.nodeId);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function formatSourceNodePromptLine(node: Record<string, any>): string {
  const excerpt = String(node.textExcerpt ?? node.description ?? "").slice(0, 1600);
  const page = node.pageStart ? ` p.${node.pageStart}${node.pageEnd && node.pageEnd !== node.pageStart ? `-${node.pageEnd}` : ""}` : "";
  const spans = Array.isArray(node.sourceSpanIds) && node.sourceSpanIds.length
    ? ` spans:${node.sourceSpanIds.slice(0, 8).join(",")}`
    : "";
  return `${node.path ?? ""} ${node.kind ?? "node"} "${node.title ?? "Untitled"}"${page}${spans}: ${excerpt}`;
}

const STRUCTURED_FACT_CHUNK_TYPES = new Set([
  "carrier_info",
  "named_insured",
  "coverage",
  "declaration",
  "loss_history",
  "premium",
  "financial",
  "supplementary",
  "location",
  "vehicle",
  "classification",
  "party",
  "subjectivity",
  "underwriting_condition",
]);

function isStructuredFactChunk(chunk: Doc<"documentChunks">): boolean {
  const evidenceKind = (chunk.metadata as { evidenceKind?: string } | undefined)?.evidenceKind;
  return (
    STRUCTURED_FACT_CHUNK_TYPES.has(chunk.chunkType)
    && evidenceKind !== "navigation"
    && evidenceKind !== "generated_long_text"
  );
}

/**
 * Fallback context for orgs without embedded chunks.
 * Simple keyword scoring — same approach as old SDK.
 */
function buildFallbackContext(
  policies: Doc<"policies">[],
  quotes: Doc<"policies">[],
  queryText: string,
): {
  context: string;
  relevantPolicyIds: Id<"policies">[];
  relevantQuoteIds: Id<"policies">[];
} {
  const queryLower = queryText.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);

  // Score policies by keyword match
  const scoredPolicies = policies.map((p) => {
    let score = 0;
    const searchText = [
      p.carrier,
      p.security,
      p.policyNumber,
      p.insuredName,
      ...(p.policyTypes ?? []),
      ...(p.coverages?.map((c: { name?: string }) => c.name) ?? []),
      p.summary,
      formatDocumentStructureForPrompt(p as Record<string, unknown>, {
        maxNodes: 16,
        maxChars: 4000,
        includeSourceSpanIds: false,
      }),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    for (const word of queryWords) {
      if (searchText.includes(word)) score++;
    }
    return { policy: p, score };
  });

  const scoredQuotes = quotes.map((q) => {
    let score = 0;
    const searchText = [
      q.carrier,
      q.security,
      q.quoteNumber,
      q.insuredName,
      ...(q.policyTypes ?? []),
      ...(q.coverages?.map((c: { name?: string }) => c.name) ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    for (const word of queryWords) {
      if (searchText.includes(word)) score++;
    }
    if (queryLower.includes("quote") || queryLower.includes("proposal"))
      score += 3;
    return { quote: q, score };
  });

  const topPolicies = scoredPolicies
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const policiesToExpand =
    topPolicies.length > 0
      ? topPolicies.map((r) => r.policy)
      : policies.slice(0, 5);
  const relevantPolicyIds = policiesToExpand.map((p) => p._id);

  const topQuotes = scoredQuotes
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const quotesToExpand =
    topQuotes.length > 0 ? topQuotes.map((r) => r.quote) : quotes.slice(0, 3);
  const relevantQuoteIds = quotesToExpand.map((q) => q._id);

  const parts: string[] = [];

  if (policies.length > 0) {
    const indexLines = policies.map((p, i) => {
      const types = p.policyTypes?.join(", ") ?? "unknown";
      const carrier = p.mga || p.carrier || p.security;
      const coverages =
        p.coverages
          ?.slice(0, 5)
          .map(
            (c: { name?: string; limit?: string }) => `${c.name}: ${c.limit}`,
          )
          .join("; ") ?? "";
      return `[${i + 1}] ${carrier} | #${p.policyNumber} | Types: ${types} | ${p.effectiveDate} to ${p.expirationDate ?? "continuous"} | Insured: ${p.insuredName} | Coverages: ${coverages}`;
    });
    parts.push(
      `POLICY INDEX (${policies.length} bound policies):\n${indexLines.join("\n")}`,
    );
  }

  // Expand relevant policies
  const expanded = policiesToExpand.map((p) => {
    const carrier = p.security || p.carrier;
    let section = `\n--- POLICY: ${carrier} #${p.policyNumber} ---`;
    if (p.summary) section += `\nSummary: ${p.summary}`;
    if (p.coverages?.length) {
      section += "\nCoverages:";
      for (const c of p.coverages as Array<{
        name?: string;
        limit?: string;
        deductible?: string;
      }>) {
        section += `\n  - ${c.name}: Limit ${c.limit}${c.deductible ? `, Deductible ${c.deductible}` : ""}`;
      }
    }
    const structure = formatDocumentStructureForPrompt(p as Record<string, unknown>, {
      maxNodes: 14,
      maxChars: 4500,
      includeSourceSpanIds: true,
    });
    if (structure) section += `\n${structure}`;
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

    const results = await ctx.vectorSearch(
      "conversationTurns",
      "by_embedding",
      {
        vector: queryEmbedding,
        limit: 10,
        filter: (q) => q.eq("orgId", orgId),
      },
    );

    if (results.length === 0) return "";

    const turns = [];
    for (const result of results) {
      const doc = await ctx.runQuery(internal.conversationTurns.get, {
        id: result._id,
      });
      if (doc) turns.push(doc);
    }

    if (turns.length === 0) return "";

    const MAX_CHARS = 3000;
    let total = 0;
    const entries: string[] = [];

    for (const turn of turns) {
      const date = new Date(turn.createdAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
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
      month: "short",
      day: "numeric",
      year: "numeric",
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

import type { AgentScope } from "./agentScope";
import { formatAgentScopePortfolioIndex, orgLabelForScope } from "./agentScope";

export async function buildScopedDocumentContext(
  ctx: ActionCtx,
  scope: AgentScope,
  policiesByOrg: Map<string, { policies: Doc<"policies">[]; quotes: Doc<"policies">[] }>,
  queryText: string,
): Promise<{
  context: string;
  relevantPolicyIds: Id<"policies">[];
  relevantQuoteIds: Id<"policies">[];
}> {
  if (scope.mode !== "broker_portfolio") {
    const docs = policiesByOrg.get(String(scope.primaryOrgId)) ?? { policies: [], quotes: [] };
    return buildDocumentContext(ctx, scope.primaryOrgId, docs.policies, docs.quotes, queryText);
  }

  const relevantPolicyIds: Id<"policies">[] = [];
  const relevantQuoteIds: Id<"policies">[] = [];
  const parts = [formatAgentScopePortfolioIndex(scope)];
  const orderedOrgIds = [
    ...(scope.focusedOrgId ? [scope.focusedOrgId] : []),
    ...scope.readOrgIds.filter((orgId) => String(orgId) !== String(scope.focusedOrgId)),
  ];

  for (const orgId of orderedOrgIds) {
    const docs = policiesByOrg.get(String(orgId)) ?? { policies: [], quotes: [] };
    const result = await buildDocumentContext(ctx, orgId, docs.policies, docs.quotes, queryText);
    relevantPolicyIds.push(...result.relevantPolicyIds);
    relevantQuoteIds.push(...result.relevantQuoteIds);
    parts.push(`\n\nCLIENT/ORG: ${orgLabelForScope(scope, orgId)} (orgId: ${orgId})\n${result.context}`);
  }

  return {
    context: parts.join(""),
    relevantPolicyIds,
    relevantQuoteIds,
  };
}

export async function buildScopedOrgMemoryContext(
  ctx: ActionCtx,
  scope: AgentScope,
  queryText: string,
  excludePolicyIds?: string[],
): Promise<string> {
  if (scope.mode !== "broker_portfolio") {
    return buildIntelligenceContext(ctx, scope.primaryOrgId, queryText, excludePolicyIds);
  }
  const parts: string[] = [];
  for (const orgId of scope.readOrgIds) {
    const block = await buildIntelligenceContext(ctx, orgId, queryText, excludePolicyIds);
    if (block.trim()) {
      parts.push(`\n\nORG MEMORY — ${orgLabelForScope(scope, orgId)} (orgId: ${orgId})${block}`);
    }
  }
  return parts.join("");
}

export async function buildScopedRequirementsContext(
  ctx: ActionCtx,
  scope: AgentScope,
): Promise<string> {
  if (scope.mode !== "broker_portfolio") {
    return buildComplianceRequirementsContext(ctx, scope.primaryOrgId);
  }
  const parts: string[] = [];
  for (const orgId of scope.readOrgIds) {
    const block = await buildComplianceRequirementsContext(ctx, orgId);
    if (block.trim()) {
      parts.push(`\n\nCOMPLIANCE REQUIREMENTS — ${orgLabelForScope(scope, orgId)} (orgId: ${orgId})${block}`);
    }
  }
  return parts.join("");
}

export async function buildScopedVendorComplianceContext(
  ctx: ActionCtx,
  scope: AgentScope,
): Promise<string> {
  const ids = scope.mode === "broker_portfolio" ? scope.readOrgIds : [scope.primaryOrgId];
  const parts: string[] = [];
  for (const orgId of ids) {
    const complianceRows = await ctx
      .runQuery((internal as any).compliance.listVendorComplianceInternal, {
        clientOrgId: orgId,
      })
      .catch(() => []);
    if (!Array.isArray(complianceRows) || complianceRows.length === 0) continue;
    parts.push(
      `\n\nVENDOR COMPLIANCE SNAPSHOT — ${orgLabelForScope(scope, orgId)} (orgId: ${orgId}):\n${complianceRows
        .map((row: any) => {
          const failed = (row.checks ?? []).filter((check: any) => check.status !== "met");
          return `- ${row.vendorOrg?.name ?? row.vendorOrgId}: ${failed.length === 0 ? "compliant" : `${failed.length} open issue(s)`}`;
        })
        .join("\n")}`,
    );
  }
  return parts.join("");
}
