/**
 * Intent graph — canonical internal representation for the v2 extraction
 * pipeline. Specialists read/write this graph; the orchestrator adjudicates
 * conflicting proposals and the freeze phase writes it into the
 * `applicationQuestions` + `applicationGroups` tables.
 *
 * See docs/superpowers/specs/application-extraction-v2.md.
 *
 * The graph is plain data (JSON-serializable) so it can round-trip through
 * Convex storage and templates.
 */

// ─── Node / edge types ─────────────────────────────────────────────────────────

export type AnswerType =
  | "text"
  | "long_text"
  | "number"
  | "currency"
  | "percent"
  | "date"
  | "yes_no"
  | "select"
  | "multi_select"
  | "address"
  | "email"
  | "phone"
  | "website"
  | "file_upload";

export type IntentNode = {
  /** Stable local id — not a Convex _id. Assigned by the orchestrator. */
  id: string;
  prompt: string;
  answerType: AnswerType;
  required: boolean;
  selectOptions?: { value: string; label: string }[];
  helpText?: string;
  /** PDF field ids that contributed to this node. Used by specialists and
   *  critic to trace back to source evidence. */
  evidenceFieldIds: string[];
  /** Optional visual anchor — the bbox group this node belongs to on the PDF. */
  bboxGroupId?: string;
  /** Optional categorical tag — mirrors applicationQuestions.category. */
  category?:
    | "applicant_info"
    | "operations"
    | "financial"
    | "risk"
    | "history"
    | "coverage_preferences"
    | "supporting_docs"
    | "other";
};

export type IntentEdge =
  | {
      kind: "conditional";
      /** Parent node that gates visibility of the child. */
      from: string;
      to: string;
      when: { yes: true } | { value: string } | { values: string[] };
    }
  | {
      kind: "repeating";
      collectionKey: string;
      itemLabel: string;
      members: string[]; // node ids
      dependsOnNodeId?: string;
      minItems: number;
      maxItems: number;
    }
  | {
      /** Bookkeeping edge — node `into` was produced by merging the `from`
       *  nodes. Kept so the critic can verify merges didn't lose information. */
      kind: "merged_from";
      into: string;
      from: string[];
    };

export type IntentGroup = {
  id: string;
  title: string;
  description?: string;
  order: number;
  /** Node ids assigned to this group, in display order. */
  nodeIds: string[];
};

export type IntentGraph = {
  /** Schema version — bump when the shape changes so templates can be migrated. */
  version: 1;
  nodes: IntentNode[];
  edges: IntentEdge[];
  groups: IntentGroup[];
};

// ─── PDF geometry (adjacency graph, not stored on the graph itself) ────────────

export type PdfField = {
  id: string;
  page: number;
  bbox: [number, number, number, number]; // x0, y0, x1, y1
  rawLabel: string;
  fieldType: "text" | "checkbox" | "radio" | "signature";
  value?: string;
};

export type PdfAdjacencyEdge =
  | { a: string; b: string; kind: "same_row" }
  | { a: string; b: string; kind: "same_column" }
  | { a: string; b: string; kind: "same_stem" };

export type PdfGeometry = {
  pages: Array<{ width: number; height: number }>;
  fields: PdfField[];
  adjacency: PdfAdjacencyEdge[];
};

// ─── Orchestrator shared state ────────────────────────────────────────────────

export type ExtractionDecision = {
  phase: string;
  specialist: string;
  timestamp: number;
  summary: string;
  /** Node ids affected, for the critic and the debug UI. */
  affected: string[];
};

export type ExtractionSharedState = {
  applicationId: string;
  formTypeHint?: { lineOfBusiness: string; carrier?: string };
  template?: { templateId: string; matchScore: number };
  pdf?: PdfGeometry;
  intentGraph: IntentGraph;
  decisions: ExtractionDecision[];
  /** Total tokens consumed across every LLM call in this run. */
  tokensUsed: number;
  /** Hard ceiling; specialists must return early if they can't complete. */
  tokensCap: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function emptyIntentGraph(): IntentGraph {
  return { version: 1, nodes: [], edges: [], groups: [] };
}

export function tokensRemaining(state: ExtractionSharedState): number {
  return Math.max(0, state.tokensCap - state.tokensUsed);
}

/**
 * Normalize a prompt for fingerprinting / dedup. Lowercases, strips
 * punctuation, collapses whitespace.
 */
export function normalizePrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Jaccard similarity over normalized prompt sets. Used as the primary signal
 * for template matching.
 */
export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export type TemplateFingerprint = {
  normalizedPrompts: string[];
  fieldTypeHistogram: { fieldType: string; count: number }[];
  pageCount?: number;
};

export function buildFingerprint(graph: IntentGraph, pageCount?: number): TemplateFingerprint {
  const typeCounts = new Map<string, number>();
  const prompts: string[] = [];
  for (const node of graph.nodes) {
    prompts.push(normalizePrompt(node.prompt));
    typeCounts.set(node.answerType, (typeCounts.get(node.answerType) ?? 0) + 1);
  }
  return {
    normalizedPrompts: prompts,
    fieldTypeHistogram: Array.from(typeCounts.entries()).map(
      ([fieldType, count]) => ({ fieldType, count }),
    ),
    pageCount,
  };
}

/**
 * Score a candidate template against an incoming fingerprint. Returns a
 * value in [0, 1]. Primary signal is Jaccard over prompts; carrier agreement
 * nudges the score but is never required.
 */
export function scoreTemplateMatch(
  candidate: TemplateFingerprint,
  incoming: TemplateFingerprint,
  opts: { carrierAgreement?: boolean } = {},
): number {
  const promptScore = jaccard(
    candidate.normalizedPrompts,
    incoming.normalizedPrompts,
  );
  // Cosine-ish similarity on the field-type histogram.
  const histA = new Map(candidate.fieldTypeHistogram.map((h) => [h.fieldType, h.count]));
  const histB = new Map(incoming.fieldTypeHistogram.map((h) => [h.fieldType, h.count]));
  const keys = new Set([...histA.keys(), ...histB.keys()]);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const k of keys) {
    const a = histA.get(k) ?? 0;
    const b = histB.get(k) ?? 0;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }
  const typeScore = magA && magB ? dot / Math.sqrt(magA * magB) : 0;

  // Primary weight on prompts; secondary on type distribution.
  let score = 0.75 * promptScore + 0.25 * typeScore;
  if (opts.carrierAgreement) score = Math.min(1, score + 0.05);
  return score;
}
