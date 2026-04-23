/**
 * Scoring functions for the application extraction eval harness.
 *
 * Given a golden IntentGraph (hand-reviewed) and a candidate IntentGraph
 * (produced by the pipeline), emit recall / precision / type-accuracy /
 * structure-F1 metrics.
 *
 * Node matching is fuzzy: we consider two nodes a match if their normalized
 * prompts have high Jaccard over word tokens. This tolerates prompt-rewriter
 * drift while still catching real recall misses.
 */

import {
  type IntentGraph,
  type IntentNode,
  normalizePrompt,
} from "../../convex/lib/applicationIntentGraph";

const PROMPT_MATCH_THRESHOLD = 0.55;

function tokens(prompt: string): Set<string> {
  return new Set(normalizePrompt(prompt).split(" ").filter(Boolean));
}

function promptSim(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export type NodeMatch = {
  goldenId: string;
  candidateId: string;
  similarity: number;
  typeMatches: boolean;
};

export function matchNodes(
  golden: IntentNode[],
  candidate: IntentNode[],
): { matches: NodeMatch[]; unmatchedGolden: string[]; unmatchedCandidate: string[] } {
  // Greedy best-match: for each golden, take the highest-similarity candidate
  // above the threshold that isn't already claimed.
  const claimed = new Set<string>();
  const matches: NodeMatch[] = [];

  for (const g of golden) {
    let best: { c: IntentNode; sim: number } | null = null;
    for (const c of candidate) {
      if (claimed.has(c.id)) continue;
      const sim = promptSim(g.prompt, c.prompt);
      if (sim < PROMPT_MATCH_THRESHOLD) continue;
      if (!best || sim > best.sim) best = { c, sim };
    }
    if (best) {
      claimed.add(best.c.id);
      matches.push({
        goldenId: g.id,
        candidateId: best.c.id,
        similarity: best.sim,
        typeMatches: g.answerType === best.c.answerType,
      });
    }
  }

  const matchedGolden = new Set(matches.map((m) => m.goldenId));
  const matchedCandidate = new Set(matches.map((m) => m.candidateId));
  return {
    matches,
    unmatchedGolden: golden.map((g) => g.id).filter((id) => !matchedGolden.has(id)),
    unmatchedCandidate: candidate
      .map((c) => c.id)
      .filter((id) => !matchedCandidate.has(id)),
  };
}

export type StructureScore = {
  edgesGolden: number;
  edgesCandidate: number;
  edgesMatched: number;
  precision: number;
  recall: number;
  f1: number;
};

/**
 * Score edges using the node-match mapping to translate golden ids into
 * candidate ids. Two edges match if they have the same kind, direction, and
 * both endpoints line up via the node-match mapping.
 */
export function scoreStructure(
  golden: IntentGraph,
  candidate: IntentGraph,
  matches: NodeMatch[],
): StructureScore {
  const goldenToCandidate = new Map(matches.map((m) => [m.goldenId, m.candidateId]));

  type Key = string;
  const keyCandidate = new Set<Key>();
  for (const e of candidate.edges) {
    if (e.kind === "conditional") {
      keyCandidate.add(`cond:${e.from}->${e.to}`);
    } else if (e.kind === "repeating") {
      keyCandidate.add(
        `rep:${e.collectionKey}:${[...e.members].sort().join(",")}`,
      );
    }
  }

  let edgesGolden = 0;
  let edgesMatched = 0;
  for (const e of golden.edges) {
    if (e.kind === "conditional") {
      edgesGolden += 1;
      const from = goldenToCandidate.get(e.from);
      const to = goldenToCandidate.get(e.to);
      if (from && to && keyCandidate.has(`cond:${from}->${to}`)) edgesMatched += 1;
    } else if (e.kind === "repeating") {
      edgesGolden += 1;
      const mapped = e.members
        .map((m) => goldenToCandidate.get(m))
        .filter(Boolean) as string[];
      if (mapped.length !== e.members.length) continue;
      if (keyCandidate.has(`rep:${e.collectionKey}:${mapped.sort().join(",")}`)) {
        edgesMatched += 1;
      }
    }
  }

  const edgesCandidate = candidate.edges.filter(
    (e) => e.kind === "conditional" || e.kind === "repeating",
  ).length;
  const precision = edgesCandidate ? edgesMatched / edgesCandidate : edgesMatched === 0 ? 1 : 0;
  const recall = edgesGolden ? edgesMatched / edgesGolden : edgesMatched === 0 ? 1 : 0;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { edgesGolden, edgesCandidate, edgesMatched, precision, recall, f1 };
}

export type GraphScore = {
  recall: number;
  precision: number;
  typeAccuracy: number;
  structure: StructureScore;
  /** True if all four headline metrics meet the threshold. */
  passes: boolean;
  thresholds: typeof THRESHOLDS;
};

export const THRESHOLDS = {
  recall: 0.8,
  precision: 0.8,
  typeAccuracy: 0.75,
  structureF1: 0.6,
};

export function scoreGraph(golden: IntentGraph, candidate: IntentGraph): GraphScore {
  const { matches } = matchNodes(golden.nodes, candidate.nodes);
  const recall = golden.nodes.length ? matches.length / golden.nodes.length : 1;
  const precision = candidate.nodes.length
    ? matches.length / candidate.nodes.length
    : matches.length === 0
      ? 1
      : 0;
  const typeMatches = matches.filter((m) => m.typeMatches).length;
  const typeAccuracy = matches.length ? typeMatches / matches.length : 1;
  const structure = scoreStructure(golden, candidate, matches);
  return {
    recall,
    precision,
    typeAccuracy,
    structure,
    thresholds: THRESHOLDS,
    passes:
      recall >= THRESHOLDS.recall &&
      precision >= THRESHOLDS.precision &&
      typeAccuracy >= THRESHOLDS.typeAccuracy &&
      structure.f1 >= THRESHOLDS.structureF1,
  };
}
