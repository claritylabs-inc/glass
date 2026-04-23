# Application Extraction v2 — Design

Status: draft
Owner: @terry

## Problem

The current pipeline (extract → prune → rewrite → repeat-infer → taxonomy → assign → order) is a fixed linear sequence that treats each question as an independent row. It loses:

- **Visual/relational structure** — sibling fragments on the same PDF row (street/city/state/zip), checkbox clusters sharing a stem, Y/N stems with follow-up fields.
- **Semantic intent** — two prompts that mean the same thing survive as separate questions.
- **Form-type priors** — every ACORD 125 extraction re-derives the same structure from scratch, burning tokens and drifting across runs.

Symptoms seen in production:
- Duplicate "Enter each location" fields in a repeating collection.
- Street/city/state/zip emitted as four separate text inputs instead of one address field.
- Checkbox rows ("Corporation / LLC / Partnership / Trust / …") emitted as many booleans instead of one select.
- Y/N stems with detail rows ("Is applicant a subsidiary? Y/N → Parent name / % owned") emitted as flat unconditional fields.
- Grouping ordered purely by semantic difficulty, ignoring visual hierarchy.

## Goal

Extract an ACORD application into a digital form that a small-business owner can fill out, preserving:

1. **Relational structure** — repeating collections, conditional branches.
2. **Typed fields** — address, select, yes_no, date, currency, etc.
3. **Visual grouping** — questions that live together on the paper form stay together.
4. **Semantic clarity** — plain-English prompts, deduplicated intent.

## Architecture

### Two-level agent graph

**Orchestrator** (long-lived per application):
- Holds shared state: PDF geometry + candidate intent graph + evidence log.
- Picks specialists based on detected patterns and form-type prior.
- Adjudicates conflicting specialist proposals.
- Invokes the critic after each major pass; can requeue work.

**Specialists** (stateless, return structured proposals):
- `address-merger` — collapses street/city/state/zip/country clusters into one `address` field.
- `checkbox-cluster-select` — turns boolean groups with shared stem into one `select` / `multi_select`.
- `yesno-conditional` — detects Y/N stems with adjacent detail fields and builds `{parent: yes_no, children: [...], when: {yes}}` trees.
- `repeating-detector` — existing repeat-infer pass as a specialist.
- `attestation-pruner` — drops signatures, broker-only fields, certifications.
- `typed-field-recognizer` — date, email, phone, website, currency, percent, NAICS/SIC/FEIN.
- `prompt-rewriter` — plain-English rewrite; runs last so it sees final field types.

**Critic** (sampling):
- Runs after specialists on a random slice (N=20) + all fields in contested groups.
- Asks: "Does this question make sense standalone?", "Are these two fields the same intent?", "Is this conditional reachable?", "Would a business owner understand this?".
- Emits `requeue` actions pointing at specific question IDs with a reason; orchestrator reruns the relevant specialist with the extra context.

### Shared state

```ts
type ExtractionState = {
  applicationId: Id<"applications">;
  formTypeHint?: { lineOfBusiness: string; carrier?: string };
  template?: { templateId: Id<"applicationTemplates">; matchScore: number };
  pdf: {
    pages: Array<{ width: number; height: number }>;
    fields: Array<{
      id: string;
      page: number;
      bbox: [number, number, number, number];
      rawLabel: string;
      fieldType: "text" | "checkbox" | "radio" | "signature";
      value?: string;
    }>;
    // Visual adjacency graph — which fields share a row, a stem, a parent box.
    adjacency: Array<{ a: string; b: string; kind: "same_row" | "same_column" | "same_stem" }>;
  };
  intentGraph: {
    nodes: Array<{
      questionId: string;
      prompt: string;
      answerType: string;
      bboxGroupId?: string;
      evidenceFieldIds: string[]; // PDF fields that contributed
    }>;
    edges: Array<
      | { kind: "conditional"; from: string; to: string; when: { yes: true } | { value: string } }
      | { kind: "repeating"; collectionKey: string; members: string[] }
      | { kind: "merged_from"; into: string; from: string[] }
    >;
  };
  decisions: Array<{
    phase: string;
    specialist: string;
    timestamp: number;
    summary: string; // for the critic + debug UI
  }>;
};
```

The intent graph, not a flat question list, is the source of truth. Specialists mutate it via structured proposals; the orchestrator applies them.

### Phases

1. **Ingest** — parse PDF, run OCR on flat PDFs, build adjacency graph from field bboxes. Output: `pdf` state.
2. **Template match** — score against saved templates (see below). If a template matches ≥ threshold, seed `intentGraph` from it and switch specialists into **differential mode** (only propose changes vs. the template).
3. **Dispatch loop** (orchestrator):
   - Detect candidate patterns (address cluster, checkbox stem, Y/N+detail, repeating, attestation).
   - For each pattern, dispatch the relevant specialist with just the local slice of state.
   - Collect proposals; apply non-conflicting ones; adjudicate conflicts.
4. **Critic pass** — sample + contested fields. Requeue issues. Budget: max 2 requeue rounds to bound cost.
5. **Group/order** — existing taxonomy + assign, but input is the finalized intent graph, not raw fields. Ordering uses both semantic difficulty AND bbox row/page to keep visually adjacent blocks together.
6. **Freeze** — write `applicationQuestions` + `applicationGroups`. Record template usage for the learning loop.

## Templates

### Data model

```ts
applicationTemplates: defineTable({
  name: v.string(),              // "ACORD 125 GL"
  lineOfBusiness: v.string(),    // "general_liability"
  carrier: v.optional(v.string()),
  ownerOrgId: v.id("organizations"), // broker-owned
  shareScope: v.union(v.literal("private"), v.literal("org"), v.literal("public")),
  // Canonical intent graph — same shape as ExtractionState.intentGraph
  intentGraph: v.any(),
  // Fingerprint for fast matching: normalized prompt bag + field-type histogram
  fingerprint: v.object({
    normalizedPrompts: v.array(v.string()),
    fieldTypeHistogram: v.record(v.string(), v.number()),
    pageCount: v.number(),
  }),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_ownerOrgId_line", ["ownerOrgId", "lineOfBusiness"])
  .index("by_line_carrier", ["lineOfBusiness", "carrier"]);
```

### Template-first extraction

1. After ingest, compute fingerprint of the incoming PDF.
2. Query candidate templates: owner-scoped + public, filtered by `lineOfBusiness` (and `carrier` if provided).
3. Score candidates: Jaccard over `normalizedPrompts` + cosine over `fieldTypeHistogram`. Threshold ≥ 0.75 → match.
4. On match, seed `intentGraph` from the template. Specialists run in **differential mode**: only emit proposals for deltas (new fields, moved fields, removed fields). Typical match should cut LLM token spend by 70–90%.
5. On no match, run full extraction and optionally offer the broker a "save as template" action at the end.

### Broker-created templates

UI: on the broker org settings page, add an "Application templates" section with:
- Form: `name`, `lineOfBusiness` (select), `carrier` (optional text).
- Source: upload a PDF (runs full extraction once, saves the result as a template) OR promote an existing completed application.
- Share scope: private / org / public (public requires Clarity review).

### Learning loop

- Every successful extraction records which template it matched, the delta applied, and whether the broker accepted the result. Deltas feed a weekly job that surfaces "template drift" suggestions to template owners.
- ACORD templates (125, 126, 130, 140) ship preloaded as `public` templates owned by a Clarity system org.

## Eval harness

- Snapshot corpus: 20 real ACORDs across lines (GL, Property, Auto, WC, Professional).
- Golden output: human-reviewed intent graph per PDF, stored in the repo.
- Scoring:
  - **Field recall** — % of golden fields present.
  - **Field precision** — % of emitted fields that match a golden field.
  - **Type accuracy** — % of fields with correct `answerType`.
  - **Structure F1** — conditional edges + repeating memberships recovered.
  - **Token cost** — LLM spend per run, template-hit vs. cold.
- Runs on CI nightly + on every prompt change. Must maintain ≥ 0.85 on all four metrics to merge.

## Budgets & termination

Cost is governed by a **total token budget** per extraction, not a dollar estimate. Dollar estimates drift with model pricing and rely on the agent self-reporting; token counts come directly from the SDK's usage response and are authoritative.

- **Per-extraction token cap**: hard ceiling of **1,500,000 total tokens** (input + output, summed across every LLM call in the run). Rationale: at current Sonnet pricing this lands around the $1–1.50 range we want, and the cap moves with us if pricing changes.
- **Accounting**: orchestrator maintains `tokensUsed` in shared state, incremented after every `generateText` / `generateObject` call from the `usage` field. Specialists receive `tokensRemaining` in their call context and must return early if they can't complete within it.
- **Critic termination**: run requeue loops until either (a) the critic's rubric score on its sampled slice clears the quality threshold (default 0.9) **or** (b) `tokensRemaining < 100,000` (reserve for the final freeze/order phase). No fixed round limit.
- **Warm path target**: < 300,000 tokens per extraction when a template matches ≥ 0.75.
- **Telemetry**: every extraction writes `{ templateMatched, tokensUsed, criticRounds, qualityScore }` so we can tune the cap with real data.

## Tradeoffs / open questions

- **Cost**: agentic pipelines are 3–10× the token spend of the linear pipeline. Templates bring this back to parity or better on warm paths. Cold paths bounded by the $1.50 ceiling above.
- **Latency**: critic + requeue adds round-trips. Acceptable for upload-time, painful for live re-extract. Solution: emit a usable-but-rough form fast, run critic/requeue in the background, surface "refining…" status in the UI.
- **Template privacy**: broker-owned templates may embed competitive intelligence. **Default scope: `org`**. `private` and `public` are opt-in (public requires Clarity review).
- **Carrier matching**: carrier is **always optional** on templates — even when an uploaded PDF has a carrier watermark we don't force a carrier-scoped lookup; line-of-business is the required signal. Carrier just boosts the match score when both sides agree.
- **Drift detection**: templates drift as carriers revise forms. Quarterly review job flags templates whose recent matches show ≥ 20% delta and notifies the template owner.
- **Specialist contention**: two specialists may want the same fields (e.g., `address-merger` vs. `repeating-detector` fighting over a location block). Orchestrator applies a fixed priority — `repeating-detector` runs first, then `address-merger` operates inside each repeating row.

## Rollout plan

1. Land eval harness on current pipeline → baseline numbers.
2. Introduce `intentGraph` as an internal representation; reshape existing phases to produce/consume it. No behavior change.
3. Ship `applicationTemplates` table + broker UI + manual ACORD 125 seed template.
4. Replace fixed phase sequence with orchestrator + dispatch loop. First pass: keep current phases as specialists, add critic.
5. Add specialists one at a time behind flags: `address-merger` → `yesno-conditional` → `checkbox-cluster-select` → `typed-field-recognizer`.
6. Add template-differential mode; measure cost delta on ACORD 125 corpus.

Each step is independently shippable and reverts cleanly via flag.
