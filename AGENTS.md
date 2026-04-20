# AGENTS.md

Guidance for any coding agent working in this repository: Codex, Claude Code, Cursor, or similar tools.

## Workflow

- After major architecture or data-flow changes, update `AGENTS.md`.
- Prefer documenting current behavior over planned behavior.
- Treat the Convex worktree as potentially dirty. Do not revert unrelated user changes.

## Commands

- `npm install` — install dependencies
- `npm run dev` — start the Next.js app
- `npx convex dev` — start the Convex backend (also pushes schema + functions to dev)
- `npx convex deploy --yes` — push Convex functions to production
- `npm run build` — production build
- `npm run lint` — repo-wide ESLint
- `npx tsc --noEmit` — TypeScript validation (Next.js)
- `npx convex typecheck` — TypeScript validation (Convex functions)
- `npx convex run seed:seed` — seed demo data
- `npx convex run actions/backfillChunks:backfill --args '{"orgId":"..."}'` — embed existing documents for vector search

## High-Level Architecture

Prism is an insurance intelligence platform built on Next.js + Convex. It ingests insurance documents from email and uploads, extracts structured policy or quote data with `@claritylabs/cl-sdk`, stores retrieval-friendly chunks for vector search, and exposes that data to agent workflows for Q&A, application assistance, COI generation, and MCP access.

Core layers:

- Frontend: Next.js 16 App Router, React 19, Tailwind 4
- Backend: Convex queries, mutations, actions, scheduler, file storage, vector search
- AI runtime: Vercel AI SDK (`ai`)
- Extraction, query agent, and prompts: `@claritylabs/cl-sdk@0.12.x`
- Providers: OpenAI, MoonshotAI, Anthropic, DeepSeek
- Email: IMAP scanning via `imapflow`, outbound/inbound flows via Resend

## Current Model Routing

Model routing lives in [convex/lib/models.ts](convex/lib/models.ts).

- `chat`, `chat_with_tools`, `extraction` → `gpt-5.4-mini`
- `email_draft`, `email_reply`, `analysis` → `kimi-k2.5` (256K context)
- `classification`, `summary` → `claude-haiku-4-5-20251001`
- `triage`, `email_extraction` → `deepseek-chat`

Fallback behavior:

- `getModel()` falls back to Claude Haiku if a provider is unavailable.
- `generateTextWithFallback()` and `generateStructuredWithFallback()` retry failed calls on Claude Haiku unless the original model already was Haiku.

## Org Intelligence Pipeline

The org intelligence system is a unified, continuously-growing knowledge base about each organization. All intelligence flows into the `orgIntelligence` table.

### Schema: `orgIntelligence`

Each entry has:
- `content` — free-text fact string
- `category` — `company_info`, `operations`, `financial`, `coverage`, `risk`, `relationship`, `observation`
- `confidence` — `confirmed`, `inferred`, `stale`
- `source` — `email`, `application`, `chat`, `extraction`, `dream`, `manual`
- `sourceRef` — ID of the originating record (email, thread, policy, etc.)
- `sourceLabel` — human-readable source name ("2025 P&L Statement", "GL Policy #ABC")
- `asOfDate` — when the fact was true (ISO date string, e.g. "2025-12-31")
- `documentDate` — when the source document was created/effective
- `embedding` — 1536-dim vector (text-embedding-3-small)
- `supersededBy` — links to a newer entry when replaced

### Intelligence Sources (all write to `orgIntelligence`)

| Source | File | Trigger | Details |
|--------|------|---------|---------|
| Email scanning | `convex/actions/extractEmailIntelligence.ts` | Daily cron | Two-agent parallel extraction (business + risk). Temporal awareness in prompts. |
| Document upload | `convex/actions/extractFromDocument.ts` | User upload | 3-step pipeline: classify document type → structured KV extraction (financial) or 2-agent (general) → store with temporal metadata. `confidence: "confirmed"`. |
| Chat threads | `convex/actions/extractChatIntelligence.ts` | After each agent response | Lightweight post-chat extraction of facts the USER revealed. Scheduled non-blocking. |
| Chat `save_note` tool | `convex/actions/processThreadChat.ts` (buildTools) | Agent tool call | Writes to orgIntelligence with embeddings (not the old orgMemory table). |
| Policy extraction | `convex/actions/extractPolicy.ts` | After PDF extraction | Synthesizes coverage, premium, carrier, insured info into intelligence entries. |
| Proactive analysis | `convex/actions/proactiveAnalysis.ts` | After policy extraction | Coverage gaps, recommendations, strengths → orgIntelligence (redirected from old orgMemory). |
| Application filling | `convex/actions/processApplication.ts` | During app processing | Auto-filled and user-answered fields saved with `sourceLabel`. |
| Dream consolidation | `convex/actions/dreamConsolidation.ts` | Weekly cron + manual trigger | Dedup, prune noise, consolidate, identify gaps (see below). |

### Dream Consolidation (Fan-Out Architecture)

Weekly automated intelligence cleanup. Runs as a 3-step fan-out:

1. **`dreamForOrg`** (coordinator): Creates a streaming log entry (`status: "running"`), groups entries by category, schedules one `dreamCategory` action per category, then schedules `dreamFinalize` after a delay.

2. **`dreamCategory`** (per-category worker): Each runs as its own Convex action with independent timeout. Sub-batches at 80 entries per LLM call for large categories. Operations:
   - Delete duplicates, near-duplicates, outdated entries
   - Delete low-value noise (receipts, individual transactions, routine vendor mentions)
   - Consolidate related facts into richer entries
   - Stream progress + LLM reasoning into the shared `dreamLogs` entry in real time

3. **`dreamFinalize`**: Runs after category workers complete. Does cross-category gap analysis and generates an org intelligence summary.

Key files:
- `convex/actions/dreamConsolidation.ts` — all three steps
- `convex/dreamLogs.ts` — streaming log CRUD (insert, update, get, list)
- `components/dream-log.tsx` — real-time log display in Activity tab

Logs are displayed in the Activity tab at `/connections` with real-time streaming via Convex reactivity. Each log shows: status (running/success/error), stats (reviewed/deleted/consolidated/gaps), progress lines, LLM reasoning (indigo-styled), and duration.

Manual trigger: `api.actions.dreamConsolidation.consolidate` (public action).

### Unified Retrieval

`buildIntelligenceContext()` in `convex/lib/agentPrompts.ts` does vector search over `orgIntelligence` and:
- Accepts optional `excludePolicyIds` to deduplicate against policy document chunks already in context
- Includes temporal metadata tags `[source | as of YYYY-MM-DD | sourceLabel]` in the prompt output
- Searches 15 entries (up from 10)

Both `processThreadChat.ts` and `mcpChat.ts` pass `relevantPolicyIds` to avoid duplicating policy-derived intelligence.

## cl-sdk Integration

The Prism-specific `cl-sdk` wiring lives under `convex/lib/`.

- [sdkCallbacks.ts](convex/lib/sdkCallbacks.ts): adapts Prism model routing to `cl-sdk` callbacks
- [extraction.ts](convex/lib/extraction.ts): builds a preconfigured extractor
- [documentMapping.ts](convex/lib/documentMapping.ts): maps SDK documents to Convex policy records
- [convexDocumentStore.ts](convex/lib/convexDocumentStore.ts): `DocumentStore` adapter
- [convexMemoryStore.ts](convex/lib/convexMemoryStore.ts): `MemoryStore` adapter
- [queryAgent.ts](convex/lib/queryAgent.ts): `createQueryAgent()` wrapper
- [agentPrompts.ts](convex/lib/agentPrompts.ts): SDK prompt exports plus Prism retrieval-backed context builders

### Callback Contract

`cl-sdk v0.10` passes document content through callback `providerOptions`.

- `providerOptions.pdfBase64` carries the PDF for classification, planning, review, and page-scoped extraction calls.
- `providerOptions.images` carries page images when PDF-to-image conversion is used.

Prism translates those into AI SDK multipart message content in `sdkCallbacks.ts`:

- PDFs become `{ type: "file", data, mediaType: "application/pdf" }`
- images become `{ type: "image", image, mediaType }`

Important details:

- The `providerOptions.images` items from `cl-sdk` do not carry a `type` field.
- The AI SDK message parts created from them must carry `type: "image"`.
- The application pipeline (`createApplicationPipeline`) embeds raw base64 PDF content directly in the prompt text instead of using `providerOptions.pdfBase64`. `sdkCallbacks.ts` detects this (via the `%PDF` magic bytes in base64: `JVBER`) and converts it to a proper file content part so the model can read the PDF.

### Token Limits

Prism preserves a higher extraction token allowance for exclusion-heavy documents in `sdkCallbacks.ts`.

- Default token limits come from `cl-sdk`.
- If the prompt matches the exclusions extractor, Prism raises the effective max token count to `8192`.

## Extraction Flow

Primary extraction entrypoints:

- [convex/actions/extractPolicy.ts](convex/actions/extractPolicy.ts) — email-attached PDFs
- [convex/actions/extractFromUpload.ts](convex/actions/extractFromUpload.ts) — user-uploaded PDFs
- [convex/actions/extractFromDocument.ts](convex/actions/extractFromDocument.ts) — non-PDF documents (CSV, DOCX, etc.) with classification pipeline
- [convex/actions/reExtractFromFile.ts](convex/actions/reExtractFromFile.ts) — re-extraction
- [convex/actions/retryExtraction.ts](convex/actions/retryExtraction.ts) — retry failed extractions

### PDF Extraction Flow

1. Fetch or receive a PDF.
2. Store the raw PDF in Convex file storage.
3. Run `buildExtractor().extract(pdfBase64, documentId)`.
4. Map `InsuranceDocument` into Prism policy fields.
5. Persist the extracted document and metadata.
6. Chunk the document and embed each chunk with `text-embedding-3-small`.
7. Store chunks in `documentChunks` for semantic retrieval.
8. Synthesize key policy facts into `orgIntelligence` (coverage, premium, carrier, insured).
9. Schedule proactive analysis and renewal comparison jobs.

### Document (Non-PDF) Extraction Flow

1. Read file as text (truncated to 16K chars).
2. **Classify** document type using `getModel("summary")`: `financial_statement`, `loss_run`, `payroll_schedule`, `fleet_list`, `certificate`, `general`. Also extracts `documentDate` and `asOfDate`.
3. **Extract** based on type:
   - Financial/payroll/loss run → structured KV extraction with temporal context
   - All others → standard two-agent extraction (business + risk)
4. **Store** with `confidence: "confirmed"`, temporal metadata, and dedup via vector similarity.

## Retrieval And Agent Context

Prism uses three vector-backed stores:

- `documentChunks` — extracted policy/quote content chunks
- `conversationTurns` — cross-thread conversation memory
- `orgIntelligence` — business intelligence facts with temporal metadata

[agentPrompts.ts](convex/lib/agentPrompts.ts) builds agent context like this:

- `buildDocumentContext()` — if chunks exist, embed query and search `documentChunks`; otherwise fall back to keyword-scored document summary
- `buildIntelligenceContext()` — vector search over `orgIntelligence`, deduplicated against policy IDs already in document context, with temporal metadata tags
- `buildConversationMemoryContext()` — vector search over `conversationTurns` for cross-thread memory

## Convex Patterns

Auth pattern:

- Public Convex functions have user auth context.
- Internal functions do not.
- Never call a public function that depends on `requireAuth()` from an internal action.

Storage and retrieval pattern:

- `policies.document` stores the structured extracted document
- `documentChunks` stores semantic chunks plus embeddings
- `orgIntelligence` stores all business intelligence (replaces old `orgMemory` and `orgBusinessContext`)
- `dreamLogs` stores dream consolidation run history with streaming progress

Important: `git push` only deploys the Next.js frontend via Vercel. Convex functions require a separate `npx convex dev --once` (dev) or `npx convex deploy --yes` (prod) to go live.

Email scan pattern:

- Scan windows should anchor to the newest stored email record for that connection, not only `lastScanAt`.
- Prism intentionally rewinds the inferred scan anchor slightly and relies on `emails.messageId` deduplication so daily/manual scans do not miss boundary emails.
- Progress counts should reflect newly inserted emails, not all provider messages returned by the upstream inbox query.
- Classification is the only stage that should set `scanProgress.phase = "classifying"`; scan actions should avoid optimistic classifying state before the classifier actually starts.
- Google OAuth uses server-managed state with client-side initialization: authenticated client code writes `{ userId, orgId, returnTo, sinceDate }` into `oauthStates`, the Next.js start route only sets the OAuth state cookie + redirects to Google, and the callback consumes the opaque state token instead of trusting a client-supplied `orgId`.

## Main Product Flows

### Email Scan To Policy

1. Scan IMAP/Gmail inboxes (daily cron + manual).
2. Triage emails (skip newsletters, OTP, automated notifications).
3. Extract intelligence from substantive emails (two-agent: business + risk) with temporal awareness.
4. Extract PDFs through `cl-sdk` for policy/quote documents.
5. Store documents, chunks, embeddings, analysis, and intelligence.

### Agent Q&A

1. Load org context, policies, quotes, and intelligence.
2. Build retrieval-backed document context + deduplicated intelligence context.
3. If the user message has attachments (images, PDFs, text), read them from Convex storage and include as AI SDK multipart content parts.
4. Run chat model via `streamText` with tools (`lookup_policy`, `lookup_policy_section`, `compare_coverages`, `check_application_status`, `save_note`, `generate_coi`).
5. Persist conversation state.
6. Schedule post-response intelligence extraction (captures new facts the user revealed).

### Application Assistance

Application workflows live mainly in [convex/actions/processApplication.ts](convex/actions/processApplication.ts).

Users can also start an application directly from the `/applications` page by uploading a PDF. The upload flow stores the file, validates that it looks like an application form, creates an application session + legacy conversation, and schedules the same `startApplicationSession` pipeline used by inbound email.

The pipeline:

1. Detect application forms from inbound email or uploads.
2. Extract fillable fields.
3. Auto-fill from intelligence, profile data, policies, and prior answers.
4. Ask for missing information in batches.
5. Parse replies, update answers, and save non-transient business facts to `orgIntelligence` with `sourceLabel`.
6. Generate confirmation output and optionally a filled PDF.

## UI: Intelligence Page

The Intelligence tab at `/connections` → "Intelligence" has two sub-tabs:

- **Org Intelligence** — intelligence entries grouped by month → day (newest first), with inline editing (pencil icon), collapsible date sections, and 3D vector visualization
- **Policy Extractions** — policy document chunk index with per-policy breakdown and reindex buttons (moved from Settings)

The Activity tab shows:
- **Dream Consolidation** — real-time streaming logs with progress, LLM reasoning, and stats
- **Extraction History** — policy extraction log with status and re-extract buttons

## MCP

Prism exposes MCP functionality for remote and local AI tools.

- Remote MCP is served from Convex HTTP handlers.
- Local MCP support lives under [mcp-server/](mcp-server/).
- Tools: `get_org_info`, `get_business_context`, `update_business_context`, `ask_prism`, `list_policies`, `get_policy`, `search_policies`, `list_quotes`, `get_quote`, `list_applications`, `get_application`, `list_threads`, `get_thread_messages`, `get_policy_stats`

## Documentation Maintenance

When behavior changes, prefer updating:

- `AGENTS.md` for engineering and agent workflow detail
- inline comments only when they clarify non-obvious code paths
