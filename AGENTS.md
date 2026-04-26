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

## High-Level Architecture (v0.2.0)

Glass is an insurance intelligence platform built on Next.js + Convex. v0.2.0 is a deliberate simplification: the product is now focused on policies, an agentic chat assistant, an agentic inbound email agent, and a lightweight per-org knowledge store (`orgMemory`). Applications v2, Client Passport / ACORD 125, email inbox scanning, org context documents, and the Merge.dev sync backend have all been removed.

Core layers:

- Frontend: Next.js 16 App Router, React 19, Tailwind 4
- Backend: Convex queries, mutations, actions, scheduler, file storage, vector search
- AI runtime: Vercel AI SDK (`ai`)
- Extraction, query agent, and prompts: `@claritylabs/cl-sdk@0.17.x`
- Providers: OpenAI, MoonshotAI, Anthropic, DeepSeek
- Email: outbound + inbound via Resend (no IMAP, no Gmail OAuth). All outbound Resend calls go through `convex/lib/resend.ts` (`sendResendEmail`). Sending domain comes from `AGENT_DOMAIN` (prod: `glass.claritylabs.inc`, dev: `dev.claritylabs.inc`). Inbound webhook at `POST /resend-inbound`.

## Current Model Routing

Default model routing lives in [convex/lib/models.ts](convex/lib/models.ts), with broker-visible catalogs in [convex/lib/modelCatalog.ts](convex/lib/modelCatalog.ts).

- `chat`, `chat_with_tools`, `extraction`, `application_authoring` → `gpt-5.5` with OpenAI `reasoningEffort: "none"`
- `email_draft`, `email_reply`, `analysis` → `kimi-k2.5` (256K context)
- `classification`, `summary`, `triage`, `email_extraction`, `document_extraction`, `security` → `gpt-5.4-mini`
- `embeddings` → `text-embedding-3-small` at 1536 dimensions

Usage notes:

- Broker admins can configure their own provider API keys and per-use-case model routes in `/settings?section=models`.
- Broker model settings are stored in `brokerModelSettings`, keyed by broker org. Client-org workflows inherit the managing broker's settings.
- The UI never exposes Glass's exact default model configuration; model selectors unlock only for providers where the broker has supplied an API key.
- `embeddings` is routed separately from language-model use cases and is restricted to embedding models. Embeddings remain 1536-dimensional to match Convex vector indexes.
- Main org-aware actions use `getModelForOrg(ctx, orgId, task)`, which applies broker overrides only when a matching broker-owned provider key exists.

Fallback behavior:

- If no broker key exists for a route, Glass uses its opaque default configuration.
- `getModel()` falls back to Claude Haiku if a provider is unavailable.
- `generateTextWithFallback()` and `generateStructuredWithFallback()` retry failed calls on `gpt-5.5` with reasoning disabled unless the original model already was GPT-5.5 or Claude Haiku.

## Org Memory

`orgMemory` is the single per-org knowledge store. It replaces the old `orgIntelligence`, `businessContext`, dream consolidation, and proactive analysis pipelines.

### Schema: `orgMemory`

Each entry has:
- `orgId`
- `kind` — `fact` | `preference` | `risk_note` | `observation`
- `content` — free-text string
- `source` — `extraction` | `analysis` | `chat` | `email`
- `sourceRef` — optional ID of originating record
- `createdAt`

No embeddings, no supersession graph, no category taxonomy. Retrieval is list-based and filtered by `kind` / `source`.

### Writers

| Source | Where | Trigger |
|--------|-------|---------|
| `save_note` chat tool | `convex/actions/processThreadChat.ts` (buildTools) | Agent tool call during chat |
| Website enrichment | `convex/actions/extractCompanyInfo.ts` | Client onboarding step 2 + manual refresh |
| Email agent post-reply summary | `convex/actions/handleInboundEmail.ts` | After a tool-using email reply resolves |

## cl-sdk Integration

The Glass-specific `cl-sdk` wiring lives under `convex/lib/`.

- [sdkCallbacks.ts](convex/lib/sdkCallbacks.ts): adapts Glass model routing to `cl-sdk` callbacks
- [extraction.ts](convex/lib/extraction.ts): builds a preconfigured extractor
- [documentMapping.ts](convex/lib/documentMapping.ts): maps SDK documents to Convex policy records
- [convexDocumentStore.ts](convex/lib/convexDocumentStore.ts): `DocumentStore` adapter
- [convexMemoryStore.ts](convex/lib/convexMemoryStore.ts): `MemoryStore` adapter
- [queryAgent.ts](convex/lib/queryAgent.ts): `createQueryAgent()` wrapper
- [agentPrompts.ts](convex/lib/agentPrompts.ts): SDK prompt exports plus Glass retrieval-backed context builders

### Callback Contract

Current `cl-sdk` passes document content through callback `providerOptions`.

- `providerOptions.pdfBase64` carries the PDF for classification, planning, review, and page-scoped extraction calls.
- `providerOptions.images` carries page images when PDF-to-image conversion is used.

Glass translates those into AI SDK multipart message content in `sdkCallbacks.ts`:

- PDFs become `{ type: "file", data, mediaType: "application/pdf" }`
- images become `{ type: "image", image, mediaType }`

Notes:

- The `providerOptions.images` items from `cl-sdk` do not carry a `type` field; Glass adds `type: "image"` when building AI SDK parts.

### Extraction Shape

`cl-sdk` 0.17 adds first-class `definitions` and `coveredReasons` arrays, plus premium promotion from declaration fields into `premium`, `totalCost`, and `taxesAndFees`.

Glass persists:

- Top-level policy financials: `premium`, `totalCost`, `taxesAndFees`, `premiumBreakdown`, `minPremium`, `depositPremium`
- Document detail: `document.sections`, `document.definitions`, `document.coveredReasons`, `document.endorsements`, `document.exclusions`, `document.conditions`
- Declarations, form inventory, and supplementary facts as top-level policy fields

### Token Limits

Glass preserves a higher extraction token allowance for exclusion-heavy documents in `sdkCallbacks.ts`.

- Default token limits come from `cl-sdk`.
- If the prompt matches the exclusions extractor, Glass raises the effective max token count to `8192`.

## Policy Extraction

Two entrypoints, both PDF-only:

- [convex/actions/extractFromUpload.ts](convex/actions/extractFromUpload.ts) — `extractFromUpload` (public action) for direct user uploads; `extractFromUploadInternal` (internal action) for the email agent.
- [convex/actions/extractPolicy.ts](convex/actions/extractPolicy.ts) — internal helpers used by the email agent via the `extract_policy_attachment` tool.
- [convex/actions/reExtractFromFile.ts](convex/actions/reExtractFromFile.ts) / [retryExtraction.ts](convex/actions/retryExtraction.ts) — re-run and retry.

### Flow

1. Fetch or receive a PDF.
2. Store the raw PDF in Convex file storage.
3. Run `buildExtractor().extract(pdfBase64, documentId)`.
4. Map `InsuranceDocument` into Glass policy fields.
5. Persist the extracted document and metadata.
6. Chunk the document and embed each chunk with `text-embedding-3-small`.
7. Store chunks in `documentChunks` for semantic retrieval.

## Retrieval And Agent Context

Glass uses two vector-backed stores plus one list-based store:

- `documentChunks` — extracted policy/quote content chunks (vector)
- `conversationTurns` — cross-thread conversation memory (vector)
- `orgMemory` — business facts/preferences/risk notes/observations (list, filtered by kind/source)

[agentPrompts.ts](convex/lib/agentPrompts.ts) builds agent context:

- `buildDocumentContext()` — if chunks exist, embed query and search `documentChunks`; otherwise fall back to keyword-scored document summary.
- `buildOrgMemoryContext()` — lists recent `orgMemory` entries, grouped by kind.
- `buildConversationMemoryContext()` — vector search over `conversationTurns` for cross-thread memory.

[aiUtils.ts](convex/lib/aiUtils.ts) owns shared agent instructions for web chat and email:

- `buildSystemPromptForContext()` builds the Glass-specific capability and safety prompt. It deliberately allows the agent's real insurance operations: answer questions, draft/send/forward validated emails, read/upload policies for extraction, generate COIs, and save durable notes.
- `buildChannelInstructions()` adds channel-specific web-chat/email behavior without duplicating the base prompt.
- `buildPolicyToolInstructions()` adds shared policy lookup and analysis standards.
- `policySearchScore()` provides shared policy search ranking for natural language requests such as "what's my policy number?"

## Convex Patterns

Auth pattern:

- Public Convex functions have user auth context.
- Internal functions do not.
- Never call a public function that depends on `requireAuth()` from an internal action.

Storage and retrieval pattern:

- `policies.document` stores the structured extracted document.
- `documentChunks` stores semantic chunks plus embeddings.
- `orgMemory` stores all per-org knowledge.

Important: `git push` only deploys the Next.js frontend via Vercel. Convex functions require a separate `npx convex dev --once` (dev) or `npx convex deploy --yes` (prod) to go live.

## Main Product Flows

### Onboarding

Onboarding is role-specific.

- `/onboarding` is a router-only entrypoint.
- Broker users (or users without an org) are sent to `/onboarding/broker` (unchanged from v0.1.x).
- Client users are sent to `/onboarding/setup`, a 4-step wizard:
  1. **Identity** — name + role.
  2. **Org** — organization name + website; on continue, `extractCompanyInfo` runs server-side enrichment from the website and writes `orgMemory` facts.
  3. **Policies** — list current policies; user can upload PDFs (extracted via `extractFromUpload`) or forward them to the org's inbound address.
  4. **Finish** — intro to the chat assistant + MCP connection info.

Passport onboarding (`/onboarding/passport/*`) has been removed.

### Email Agent (Inbound)

Inbound email arrives at `POST /resend-inbound` and is handled by `convex/actions/handleInboundEmail.ts`.

- No hardcoded intent routing. The agent runs `streamText` with `getModel("chat")` and a tool set:
  - `lookup_policy`
  - `lookup_policy_section`
  - `compare_coverages`
  - `save_note` — writes to `orgMemory`
  - `generate_coi`
  - `extract_policy_attachment` — extracts PDF attachments via `extractFromUploadInternal`
- After a reply is produced, a Haiku summarization pass writes a `source: "email"` observation to `orgMemory`.

### Agent Q&A (Chat)

1. Load org context, policies, and `orgMemory`.
2. Build retrieval-backed document context + orgMemory context + conversation memory.
3. If the user message has attachments (images, PDFs, text), read them from Convex storage and include as AI SDK multipart content parts.
4. Run chat model via `streamText` with tools: `lookup_policy`, `lookup_policy_section`, `compare_coverages`, `save_note`, `generate_coi`.
5. Persist conversation state.

## UI

- `/policies` — list, detail, upload, re-extract.
- `/chat` — threaded assistant.
- `/settings` — org settings, branding, members, and an **Integrations** section rendered as a coming-soon grid. The Merge.dev backend and all integration sync tables/actions have been removed; only the static grid remains.

## MCP

Glass exposes MCP functionality for remote and local AI tools.

- Remote MCP is served from Convex HTTP handlers at `/mcp`.
- Local MCP support lives under [mcp-server/](mcp-server/).
- MCP discovery: `GET /.well-known/mcp.json`

### Tools (trimmed in v0.2.0)

- `list_policies`, `get_policy`
- `list_quotes`, `get_quote`
- `list_threads`, `get_thread_messages`
- `get_org_info`
- `ask_glass`
- `list_clients`, `get_client` (broker)
- `list_broker_activity` (broker)
- `list_my_policies` (client)

Application, passport, business-context, and integration tools are gone.

All MCP tool invocations require a Bearer token (OAuth or API key) and resolve org from session metadata. Write tools require a token with `write` scope.

## REST API

Versioned REST API under `/api/v1/*`. All routes require:
- `Authorization: Bearer <token>` (OAuth token from `/oauth/token`)
- `X-Org-Id: <orgId>` header

Scopes: `read` (default) and `write`. Write endpoints require a `write` token.

Error shape: `{ "error": { "code": "...", "message": "...", "request_id": "..." } }`

Pagination shape: `{ "data": [...], "next_cursor": "opaque_or_null" }` with `?limit` capped at 100.

Rate limit: 600 req/min burst, 20 req/s sustained per token. Returns 429 with `Retry-After`.

OpenAPI spec: `GET /api/v1/openapi.json`

### Resources

- `GET /api/v1/me`
- `GET /api/v1/org`
- `GET /api/v1/clients` / `GET /api/v1/clients/:id` (broker)
- `POST /api/v1/clients/invitations` (write)
- `GET /api/v1/policies` / `GET /api/v1/policies/:id`
- `GET /api/v1/notifications`
- `GET /api/v1/activity`

Write requests are audit-logged to `apiAuditLog`.

## Documentation Maintenance

When behavior changes, prefer updating:

- `AGENTS.md` for engineering and agent workflow detail
- inline comments only when they clarify non-obvious code paths

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->
