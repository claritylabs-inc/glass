# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow

- **After each major change/commit**: Update `CLAUDE.md` and `README.md` to reflect architectural changes, new features, modified data flows, or new files/routes.

## Commands

- `npm run dev` — Start Next.js dev server (Turbopack)
- `npm run build` — Production build
- `npm run lint` — ESLint
- `npx convex dev` — Start Convex dev backend (runs alongside Next.js dev)
- `npx convex run seed:seed` — Seed demo data
- `npx convex run migrations:migratePolicies` — Backfill old policy records
- `npx convex run actions/backfillChunks:backfill --args '{"orgId":"..."}' ` — Embed existing policies for vector search

## Architecture

AI-powered insurance platform with policy extraction, proactive intelligence, and application assistance. Emails are scanned via IMAP, classified using keyword heuristics + Claude Haiku, and policy data is extracted from PDF attachments using Claude Sonnet. Prism handles policy/quote Q&A and insurance application form filling via email and web chat. Multi-model architecture routes tasks to DeepSeek V3 (chat/tools), Kimi K2.5 (analysis/email), Claude Haiku (classification), and Claude Sonnet (extraction), with automatic fallback. Agentic chat supports tool use (policy lookup, COI generation, email drafting). Per-org memory persists AI-extracted knowledge across sessions. Post-extraction analysis runs automatically to identify coverage gaps and portfolio risks.

### Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- **Backend**: Convex (realtime serverless DB + functions)
- **AI**: Anthropic Claude API (`@anthropic-ai/sdk`), Vercel AI SDK (`ai`, `@ai-sdk/react`, `@ai-sdk/anthropic`, `@ai-sdk/openai`), `@claritylabs/cl-sdk` v0.5.0 (coordinator/worker extraction, document chunking, vector storage interfaces, query agent, application pipeline, agent prompts, PDF filling)
- **Email**: imapflow for IMAP scanning, Resend for outbound agent emails
- **PDF Generation**: pdfkit for application summary PDFs, mupdf (WASM) for flattening broken PDFs
- **UI**: shadcn/ui (base-nova style) + Base-UI primitives, Framer Motion, Lucide icons

### Authentication & Authorization

Auth is handled by `@convex-dev/auth` with email OTP (one-time password) login. Key patterns:

- **`convex/lib/auth.ts`** — `requireAuth(ctx)` helper extracts the authenticated user ID from the Convex context. Used by all public queries/mutations that need user scoping.
- **Public queries/mutations** (`query`, `mutation`, `action`) — Have auth context from the browser session. Use `requireAuth(ctx)` or `api.users.viewer` to get the current user.
- **Internal functions** (`internalQuery`, `internalMutation`, `internalAction`) — Called via `ctx.scheduler.runAfter()` or `internal.*` references. These run **without auth context** and cannot call `requireAuth`. They must use internal queries/mutations (e.g., `internal.emails.getInternal`, `internal.connections.getInternal`) instead of public ones.
- **CRITICAL**: Never call a public `query`/`mutation` that uses `requireAuth` from an `internalAction`. This will fail with "Not authenticated". Always create corresponding `internalQuery`/`internalMutation` variants for use by scheduled/internal functions.

### Data Flow — Invitation & Login

1. Admin invites member via Settings or onboarding → creates `orgInvitation` (pending, 7-day expiry)
2. Invited user goes to `/login` → enters email → `checkEmail` + `checkPendingInvitation` queries run
3. If user record doesn't exist but has pending invitation → proceeds with OTP (not redirected to signup)
4. After auth → `onboardingComplete` is false → redirected to `/onboarding`
5. Onboarding checks `pendingInvitationForViewer` → shows invitation acceptance UI (org name, inviter, name field)
6. User clicks "Join" → `acceptInvitation` creates `orgMembership` + `completeOnboarding` → redirects to dashboard

### Data Flow — Policy Extraction

1. `scanInbox` action (public) → fetches emails via IMAP with date range + sender domain filters, deduplicates by messageId, saves scan params
2. `classifyEmails` internal action (scheduled) → keyword matching + Claude Haiku for ambiguous cases, skips emails that already have policies, tracks progress
3. `extractPolicy` internal action (scheduled) → downloads PDF, stores in Convex file storage, runs cl-sdk coordinator/worker extraction pipeline (`createExtractor` with 11 focused extractors, review loop, parallel dispatch). Returns `InsuranceDocument` + `DocumentChunk[]`. Chunks embedded via OpenAI text-embedding-3-small and stored in `documentChunks` table for vector search.
4. `retryExtraction` action (public) → `reparse` mode re-parses saved raw response via `insuranceDocToPolicy()`; `full` mode re-runs entire extraction pipeline + re-embeds chunks
5. `reExtractFromFile` action (public) → re-extracts from an uploaded replacement PDF using unified pipeline

### Data Flow — Prism (Email)

1. **Inbound routing** (`handleInboundEmail.ts`): Resend webhook → verify signature → dedup by email_id → resolve org by agent handle → detect mode (direct/cc/forward/unknown) → resolve thread via `In-Reply-To` or subject matching
2. **Application reply routing** (before normal agent flow): checks for active application session by threadId → fallback by `lastSentMessageId` → fallback by orgId. Routes to `processApplicationReply` or `processConfirmationReply` based on session status
3. **New application detection**: direct mode + PDF attachment + keyword intent → Haiku PDF classification (confidence > 0.7) → starts application session
4. **Policy/Quote Q&A** (default): builds system prompt with org context → loads matching policies/quotes → cross-thread conversation memory search → Haiku generates response → sends reply via Resend with threading headers
5. **Unknown mode**: forwards email to org admin with notification

### Data Flow — Application Processing

Full workflow in `convex/actions/processApplication.ts`:

1. **Immediate ack email** — sends "reviewing your application" email (threaded to original) before extraction begins
2. **Field extraction** (Sonnet, `max_tokens: 16384`) — extracts all fillable fields from PDF as structured JSON. Handles grouped checkbox/radio fields as single fields with options. Falls back to `salvageTruncatedJsonArray` if response truncated
3. **Auto-fill** (Haiku) — gathers context from 5 sources:
   - Org business context (`orgBusinessContext` table)
   - Org details (name, website, industry, context, broker info)
   - User contact info (name, email, title, phone)
   - Existing policies (carrier, policy number, dates, premium, coverage limits)
   - Web research (fetches org website, Haiku extracts business facts)
   - Matches context to extracted fields, fills with confidence scores
4. **Question batching** (Haiku) — groups unfilled fields by topic (not fixed size). Aims for 3-8 topical batches. Keeps address-like fields together, conditional parents before dependents. Sends first batch email (threaded)
5. **Conversational batch emails** (Haiku, `generateBatchEmail`) — Claude generates natural, conversational email body instead of templates. Acknowledges prior answers, shows progress, groups compound questions (address fields → single question), handles conditionals naturally
6. **Smart reply handling** (Haiku, `processApplicationReply`) — classifies reply intent before parsing:
   - `answers_only`: parse answers normally
   - `question`: explain the field (with optional policy context), don't advance batch
   - `lookup_request`: load matching data (policies/quotes/profile/business context), auto-fill fields
   - `mixed`: handle answers + questions/lookups in one combined response email
   Updates fields + saves non-transient answers to business context. Sends next batch or moves to confirmation
6. **Confirmation** — generates readable summary (Haiku), sends for user review. User replies "looks good" to confirm, or requests changes
7. **Completion** (`processConfirmationReply`) — generates summary PDF (pdfkit), stores in file storage, marks session complete. Handles change requests (re-parse + re-confirm) and cancellation

**Threading**: All emails in an application session are threaded via `In-Reply-To`/`References` headers. `originalMessageId` and `lastSentMessageId` stored on session for chain continuity.

**Transient field filter**: Date fields and time-specific values (effective dates, expiry, quote-required-by, signatures) are NOT saved to persistent business context.

**Missing policy handling**: If the application asks about current insurance details but no matching policy exists, the auto-fill notes this so the agent asks the user if they have a current policy.

**PDF filling**: On-demand from application detail page via `fillApplicationPdf` action. Three modes (tried in order):
- **AcroForm** (fillable PDFs): detects form fields with pdf-lib, Haiku maps extracted values to AcroForm field names, fills and flattens
- **Flat/scanned PDFs** (text overlay): sends PDF to Haiku Vision to locate field positions (as percentage coordinates), then overlays text at those positions using pdf-lib's `drawText`
- **Flattened overlay** (broken PDFs): when pdf-lib can't load the PDF (broken page tree), calls `POST /api/flatten-pdf` which uses mupdf WASM to rasterize pages to PNG at 144 DPI and rebuilds a clean PDF. If flattened PDF loads in pdf-lib, proceeds with overlay path
- **Standalone** (fallback): when flattening is unavailable or fails, generates a new pdfkit document with filled values organized by section
Filled PDF stored as `filledFileId` on the session.

**PDF flattening**: `app/api/flatten-pdf/route.ts` — Next.js API route using mupdf WASM. Authenticated via `FLATTEN_API_KEY` bearer token. Called from Convex `fillApplicationPdf` action when pdf-lib fails. Requires `FLATTEN_API_KEY` env var in both Vercel and Convex.


### Data Flow — Web Chat (Streaming)

Web chat uses a hybrid architecture: `useChat` from `@ai-sdk/react` handles streaming via `/api/chat`, while Convex subscriptions provide the persisted message history.

1. User clicks "New Chat" on `/agent` → `create` mutation creates thread → navigated to thread page
2. User sends message → `sendMessage` mutation inserts message (with `skipAgentResponse: true`) → `useChat.sendMessage()` calls `/api/chat` streaming route
3. **Streaming route** (`app/api/chat/route.ts`): validates auth via Convex token in `Authorization` header → loads org, policies, quotes, thread messages → builds system prompt (`@claritylabs/cl-sdk`) → `streamText()` with Claude Haiku → returns `toUIMessageStreamResponse()`
4. `onFinish`: persists final message to Convex via `threads.updateAgentResponse`, auto-titles on first message
5. **Hybrid rendering**: Thread page shows Convex subscription messages for full history + overlays `useChat` streaming message at bottom during generation. Deduplicates when persisted message appears in subscription.
6. **Email-triggered flows**: `processThreadChat.ts` still handles inbound email → agent response (with 150ms DB flush for real-time display)

### Data Flow — Proactive Intelligence

1. Policy extracted successfully → `analyzePolicy` scheduled immediately via `ctx.scheduler.runAfter(0, ...)`
2. `analyzePolicy` generates structured health check (overallScore, strengths, gaps, recommendations, limitAssessment, deductibleAssessment, notableExclusions) using `getModel("analysis")` → stored on `policies.analysis`
3. Key facts and risk notes saved to `orgMemory` table (carrier + type → "fact" and coverage gaps → "risk_note")
4. If org has 2+ policies → `analyzePortfolio` scheduled (5s delay) — cross-policy gap identification, overlap detection → stored on `organizations.portfolioAnalysis`
5. If extracted policy has `priorPolicyNumber` matching an existing policy → `compareRenewal` scheduled — premium/limit/deductible/coverage diff → saved as observation in `orgMemory`
6. All analysis uses `generateTextWithFallback` for automatic Claude Sonnet fallback if primary model (Kimi K2.5) fails
7. Org memories loaded into system prompt for all chat pathways (web, email, MCP) via `buildMemoryContext()`

### Data Flow — Business Context

- `orgBusinessContext` table stores reusable org data (company info, operations, financial, coverage, etc.)
- Auto-saved from application answers (excluding transient/date fields) for future pre-filling
- Manually managed via Settings > Business Context tab
- Used as primary auto-fill source for new applications

### `@claritylabs/cl-sdk` Package

cl-sdk v0.5.0 is a provider-agnostic platform with coordinator/worker extraction, document chunking, vector storage interfaces, query agent, and application pipeline. The local `convex/lib/` files provide Prism-specific wiring:

- `lib/sdkCallbacks.ts` — Adapts Prism's AI SDK model routing into cl-sdk's provider-agnostic callbacks (`GenerateText`, `GenerateObject`, `EmbedText`). Embeddings via OpenAI `text-embedding-3-small` (1536 dims).
- `lib/documentMapping.ts` — Maps between cl-sdk `InsuranceDocument` and Prism's `policies` table schema. `insuranceDocToPolicy()` (extraction → Convex) and `policyToInsuranceDoc()` (Convex → SDK).
- `lib/extraction.ts` — Re-exports `createExtractor`, `chunkDocument`, `stripFences`, `sanitizeNulls`, `POLICY_TYPES`, `CONTEXT_KEY_MAP`, PDF operations. Provides `buildExtractor()` factory pre-configured with Prism's model routing.
- `lib/convexDocumentStore.ts` — Implements cl-sdk `DocumentStore` interface on Convex's `policies` table.
- `lib/convexMemoryStore.ts` — Implements cl-sdk `MemoryStore` interface using Convex vector search over `documentChunks` and `conversationTurns` tables.
- `lib/queryAgent.ts` — Wraps cl-sdk `createQueryAgent` with Prism's model routing and Convex storage. Provides citation-backed Q&A.
- `lib/agentPrompts.ts` — Re-exports `buildAgentSystemPrompt`, `buildConversationMemoryGuidance`. Provides async `buildDocumentContext()` (vector search with keyword fallback) and `buildConversationMemoryContext()` (vector search over conversation turns).
- `lib/applicationPrompts.ts` — Re-exports application prompts (classify, extract fields, auto-fill, batch questions, etc.)
- `lib/pdfFiller.ts` — Re-exports PDF filling functions (getAcroFormFields, fillAcroForm, overlayTextOnPdf) and types
- `lib/aiClassifier.ts` — Re-exports `buildClassifyMessagePrompt(platform: Platform)`

To modify prompts or extraction logic, update the `@claritylabs/cl-sdk` package and bump the version.

### Key Backend Files (convex/)

- `schema.ts` — Tables: `emailConnections`, `emails`, `policies`, `organizations`, `orgMemberships`, `orgInvitations`, `agentConversations`, `orgBusinessContext`, `applicationSessions`, `webChats`, `webChatMessages`, `apiKeys`, `documentChunks` (vector search), `conversationTurns` (vector search)
- `documentChunks.ts` — CRUD for document chunks (get, listByPolicy, hasChunksForOrg, insert, deleteByPolicy). Supports vector search via `by_embedding` index (1536-dim, org-scoped).
- `conversationTurns.ts` — CRUD for conversation turns (get, listByConversation, insert). Supports vector search via `by_embedding` index (1536-dim, org-scoped).
- `policies.ts` — Queries (list, stats, getFileUrl, emailIdsWithPolicies) and mutations (insert, updateExtraction, softDelete, restore, generateUploadUrl)
- `connections.ts` — CRUD + cascade delete with optional policy cleanup. Internal queries (`getInternal`) for scheduled actions
- `emails.ts` — Insert with messageId dedup, classification, processing status. Internal queries (`getInternal`, `listByConnection`) for scheduled actions
- `businessContext.ts` — CRUD for org business context (list grouped by category, upsert by key, bulk upsert). Public + internal variants
- `applicationSessions.ts` — Application session lifecycle (list, get, stats, cancel). Internal: create, updateFields, updateStatus, findByThreadId, markComplete
- `webChats.ts` — Web chat CRUD (list, get, messages, create, sendMessage, archive). Internal mutations for agent response (insertAgentMessage, updateAgentMessage, updateAgentError, touchChat, updateTitleInternal)
- `agentConversations.ts` — Agent conversation records with cross-thread memory
- `actions/handleInboundEmail.ts` — Inbound email routing: application detection, reply routing, agent Q&A
- `actions/processApplication.ts` — Application workflow: field extraction, auto-fill, batched Q&A, confirmation, summary PDF generation
- `actions/processThreadChat.ts` — Agent response for email-triggered flows (kept for inbound email → agent response with 150ms DB flush)
- `apiKeys.ts` — API key management: generate (with Web Crypto), revoke, remove, list. Internal: validateKey (hash lookup), touchLastUsed
- `oauth.ts` — OAuth 2.1 logic: client registration, auth code creation/exchange, token validation/refresh/revocation, connected apps listing
- `actions/mcpChat.ts` — Simplified chat action for MCP: non-streaming, generates response via `generateText`, persists to thread, auto-titles
- `actions/` — Also: IMAP scanning, classification, extraction
- `lib/applicationTypes.ts` — Types for form fields (SimpleField, TableField, DeclarationField), QuestionBatch
- `lib/policyTypes.ts` — Insurance keyword lists, policy type label map (22 types), section type labels/colors
- `lib/models.ts` — Multi-model architecture: task-based routing (DeepSeek V3, Kimi K2.5, Claude Haiku/Sonnet) with automatic fallback via `generateTextWithFallback`
- `lib/aiUtils.ts` — Centralized AI utilities: `stripMarkdown`, `markdownToHtml`, `buildSignature`, `buildMessageHistory`, `buildSystemPromptForContext` (with prompt injection fencing), `logAiError` (with secret redaction)
- `lib/chatTools.ts` — AI SDK v6 tool definitions for agentic chat (`lookupPolicy`, `compareCoverages`, `sendEmail`, `checkApplicationStatus`, `saveNote`, `generateCoi`)
- `lib/orgMemoryContext.ts` — `buildMemoryContext()`: formats org memories into grouped system prompt block
- `lib/coiGenerator.ts` — COI PDF generator with ACORD-style layout using pdfkit (`CoiData`, `policyToCoiData`, `generateCoiPdf`)
- `orgMemory.ts` — Org memory CRUD: facts, preferences, risk notes, observations. Content-hash dedup, expiry, scoped to orgId
- `actions/proactiveAnalysis.ts` — `analyzePolicy` (health check), `analyzePortfolio` (cross-policy gaps), `compareRenewal` (premium/limit diff). Triggered post-extraction.
- `actions/backfillChunks.ts` — One-time migration to embed and chunk existing policies for vector search. Run per-org via `npx convex run actions/backfillChunks:backfill`.
- `actions/generateEmailBody.ts` — AI-written email body via `getModel("email_draft")` (Kimi K2.5)
- `actions/generateCoi.ts` — COI generation: maps policy → CoiData → PDF → Convex file storage, returns storageId

### Key Frontend Patterns

- **App Shell layout**: All authenticated pages use `<AppShell>` which provides a persistent left sidebar (`AppSidebar`), top bar with breadcrumbs (`AppTopBar`), and "Ask Prism" chat input at the bottom (`AskPrismInput`). Pages just render their content inside `<AppShell>`.
- **Sidebar**: `components/app-sidebar.tsx` — collapsible (220px / 56px), persisted in localStorage, mobile overlay drawer. Sections: Insurance (Dashboard, Policies, Quotes, Applications), Tools (Connections, Prism), Chats (latest 5 web chats + new chat button), bottom links (Settings for admin, Profile, Sign out).
- **Typography**: Headings use Geist Sans (semibold, -0.025em tracking) — no serif in-app. Instrument Serif available via `.serif` class for marketing only.
- All pages are `"use client"` with Convex React hooks (`useQuery`, `useMutation`, `useAction`)
- Path alias: `@/*` maps to project root
- Filtering/aggregation done client-side with `useMemo` over Convex query results
- FadeIn wrapper component for staggered animations
- Dialog component (from shadcn/base-ui) for destructive action confirmations
- PillButton component with variants: primary, secondary, destructive, ghost, icon
- StatCard component for consistent metric cards across pages (dashboard, applications)
- SearchableSelect component for styled dropdowns (used in settings, business context)
- ModeBadge component for conversation type indicators (direct, cc, forward, application)
- **AI SDK Elements** (`components/ai-elements/`): Scaffolded PromptInput, Message, Conversation components from `ai-elements` CLI. Used via `PrismPromptInput` wrapper (`components/prism-prompt-input.tsx`) for branded chat input.
- **Streaming chat**: `useChat` from `@ai-sdk/react` with `DefaultChatTransport` pointed at `/api/chat`. Auth token passed via `useAuthToken()` from `@convex-dev/auth/react`.

### Schema Notes

- `policies.policyTypes` is an array (multi-type support); old `policyType` field kept as optional for backward compat
- `policies.documentType` distinguishes `"policy"` from `"quote"`
- `policies.deletedAt` for soft deletes — all list/stats queries filter these out
- `policies.rawExtractionResponse` stores Claude's raw output for retry without API call
- `policies.document` stores structured sections with provenance (page numbers, section references)
- Entity fields: `security` (insurer), `underwriter`, `mga` (program administrator), `broker`
- Enriched entity fields (cl-sdk 1.2+): `carrierLegalName`, `carrierNaicNumber`, `carrierAmBestRating`, `carrierAdmittedStatus`, `brokerAgency`, `brokerContactName`, `brokerLicenseNumber`, `priorPolicyNumber`, `programName`, `isPackage`
- Insured details: `insuredDba`, `insuredAddress`, `insuredEntityType`, `insuredFein`, `additionalNamedInsureds`
- Structured limits/deductibles: `limits` (LimitSchedule), `deductibles` (DeductibleSchedule), `coverageForm`, `retroactiveDate`, `effectiveTime`
- Schedules: `locations` (InsuredLocation[]), `vehicles` (InsuredVehicle[]), `classifications` (ClassificationCode[]), `formInventory` (FormReference[]), `taxesAndFees` (TaxFeeItem[])
- Quotes enriched fields: `enrichedSubjectivities`, `enrichedUnderwritingConditions`, `warrantyRequirements`, `limits`, `deductibles`, `taxesAndFees`
- PolicyType expanded to 22 values (cl-sdk 1.2+): general_liability, commercial_property, commercial_auto, non_owned_auto, workers_comp, umbrella, excess_liability, professional_liability, cyber, epli, directors_officers, fiduciary_liability, crime_fidelity, inland_marine, builders_risk, environmental, ocean_marine, surety, product_liability, bop, management_liability_package, property, other
- `policies.document.conditions` (cl-sdk 3.0+): array of policy conditions/subjectivities with title, content, pageNumber
- `policies.document.endorsements` (cl-sdk 3.0+): array of endorsements with title, content, pageStart, effectType (informational/restrictive)
- `quotes.document.conditions`, `quotes.document.endorsements`, `quotes.document.costsAndFees`, `quotes.document.regulatoryContext` (cl-sdk 3.0+) — same structure as policies for quote documents
- `policies.policyTermType`, `policies.minPremium`, `policies.depositPremium`, `policies.auditProvision`, `policies.cancellationProvisions`, `policies.nonRenewalProvisions`, `policies.assignmentClause`, `policies.subrogationClause`, `policies.otherInsuranceClause` (cl-sdk 3.0+)
- `quotes.quoteTermType`, `quotes.proposedTerm`, `quotes.minPremium`, `quotes.depositPremium`, `quotes.paymentTerms`, `quotes.auditProvision`, `quotes.cancellationProvisions`, `quotes.nonQuoteProvisions` (cl-sdk 3.0+)
- `emailConnections.scanProgress` tracks real-time scan progress (phase, counts)
- `emailConnections.lastScanParams` stores last scan configuration for modal defaults
- `orgBusinessContext` stores reusable org data keyed by category + key, with source tracking (manual, onboarding, application, user_email) and confidence (confirmed, inferred)
- `applicationSessions.extractedFields` and `questionBatches` are JSON-serialized strings (Convex doesn't support deeply nested dynamic objects)
- `applicationSessions.filledFileId` stores the filled PDF (generated on demand via AcroForm, overlay, or standalone mode)
- `applicationSessions.status` lifecycle: extracting_fields → filling_known → asking_questions → pending_confirmation → confirmed → complete (or cancelled)
- `webChats` stores org-scoped chat sessions with title, createdBy, lastMessageAt, optional archivedAt
- `webChatMessages` stores chat messages with role (user/agent), denormalized userName, optional status (processing/error)
- `apiKeys` stores org-scoped API keys for MCP auth: SHA-256 hash of key, prefix for display, lastUsedAt, revokedAt for soft revoke
- `oauthClients` stores dynamically registered OAuth clients (clientId, clientName, redirectUris)
- `oauthAuthCodes` stores authorization codes with PKCE challenge, 10-minute expiry, used-once tracking
- `oauthTokens` stores access tokens (1-hour expiry) and refresh tokens (30-day expiry), indexed by hash for validation
- `orgMemory` stores org-scoped AI knowledge (type: fact/preference/risk_note/observation) with source (extraction/analysis/chat/email), optional policyId link, and optional expiresAt. Indexed by `by_org` and `by_org_type`. Content-hash deduplication via `upsert`.
- `policies.analysis` stores AI-generated health check (structured JSON: overallScore, strengths, gaps, recommendations, limitAssessment, deductibleAssessment, notableExclusions)
- `organizations.portfolioAnalysis` stores cross-policy portfolio analysis (overallHealth, coverageGaps, overlaps, recommendations, totalPremium, keyRisks)
- `applicationSessions.status` includes `"failed"` for timeout/error cases; `failureReason: v.optional(v.string())` holds the reason; `lastProgressAt: v.optional(v.number())` tracks last state change for stale detection (cron checks every 2min, marks stale after 5min)
- `documentChunks` stores org-scoped, policy-linked document chunks for vector search. Fields: orgId, policyId, chunkId (SDK-assigned `${docId}:${type}:${index}`), chunkType (carrier_info, named_insured, coverage, endorsement, etc.), text, metadata, embedding (1536-dim float64 array). Vector index `by_embedding` with orgId filter.
- `conversationTurns` stores org-scoped conversation turns for cross-thread memory search. Fields: orgId, conversationId, role, content, embedding (1536-dim float64 array). Vector index `by_embedding` with orgId filter.

### Routes

All routes require authentication (redirect to `/login` if not logged in) except `/login` itself.

- `/` — Dashboard with stats cards, filters, policy table
- `/login` — Email OTP authentication (no auth required)
- `/signup` — New user registration
- `/onboarding` — Post-signup onboarding wizard
- `/policies` — Full policy list with type/carrier/year filters
- `/policies/[id]` — Policy detail with document sections, coverages table, PDF download/upload, soft delete
- `/quotes` — Quote list with filters
- `/quotes/[id]` — Quote detail page
- `/applications` — Application sessions list with stats (active/completed/total)
- `/applications/[id]` — Application detail: fields by section, batch timeline, progress, PDF download
- `/connections` — IMAP connection management with scan modal and real-time progress
- `/extractions` — Pending extraction queue + completed extraction log
- `/agent` — Prism: unified conversations (email threads + web chats with "New Chat" button, application badges), settings (email address, modes)
- `/settings` — Organization settings with 5 tabs: Basic Information, Team Members, Business Context, Connected Apps, API Keys (Local)
- `/oauth/authorize` — OAuth 2.1 authorization page (login + consent for MCP remote clients)
- `/profile` — User profile page
- `/api/chat` — POST: Streaming chat API route for `useChat` (auth via Convex token in Authorization header)
- `/api/flatten-pdf` — POST: PDF flattening via mupdf WASM (bearer token auth, no user auth)
- `/mcp/*` — HTTP action routes for MCP data API (API key or OAuth auth via Bearer token)
- `/mcp` — POST: MCP Streamable HTTP transport endpoint (JSON-RPC 2.0, for Claude.ai/ChatGPT connectors)
- `/oauth/authorize` — OAuth 2.1 authorization page (Next.js, login + consent)
- `/.well-known/oauth-authorization-server` — GET: OAuth authorization server metadata
- `/oauth/register` — POST: Dynamic Client Registration (RFC 7591)
- `/oauth/token` — POST: Token exchange (authorization_code, refresh_token)
- `/oauth/revoke` — POST: Token revocation

### MCP Server

Exposes Prism functionality to AI agents via the Model Context Protocol. Supports two transports:

1. **Remote (Streamable HTTP)** — Single `POST /mcp` endpoint in `convex/http.ts` implementing MCP JSON-RPC 2.0 protocol. Used by Claude.ai connectors, ChatGPT, and other remote MCP clients. URL: `https://<deployment>.convex.site/mcp`. Auth via OAuth 2.1 (browser-based login) or API key.
2. **Local (stdio)** — `mcp-server/` Node.js package for local tools (Claude Code, Cursor). Translates MCP tool calls into HTTP requests to `/mcp/*` data routes. Auth via API key.

**Architecture**:
```
Remote clients (Claude.ai)         Local clients (Claude Code)
  ↕ HTTP POST (JSON-RPC 2.0)        ↕ stdio (MCP protocol)
  POST /mcp endpoint               MCP Server (mcp-server/)
  (convex/http.ts)                    ↕ HTTP with Bearer API key
  ↕ OAuth 2.1 or API key auth      GET/POST /mcp/* data routes
  internal queries/mutations        (convex/http.ts)
  ↕                                   ↕ internal queries/mutations
  Convex Database                   Convex Database
```

**Auth (dual mode)**:
- **Remote (OAuth 2.1)**: MCP client discovers OAuth endpoints via `/.well-known/oauth-authorization-server`, dynamically registers via `/oauth/register`, opens browser to `/oauth/authorize` (Next.js page where user logs in via Email OTP), user clicks "Allow", auth code exchanged for tokens via `/oauth/token`. Access tokens: `prsm_at_` prefix, 1-hour expiry. Refresh tokens: `prsm_rt_` prefix, 30-day expiry. PKCE (S256) required.
- **Local (API key)**: User generates API key in Settings > API Keys. Key is `prism_` + 64 hex chars. Stored as SHA-256 hash in `apiKeys` table.
- `requireMcpAuth` in `http.ts` tries API key first (if `prism_` prefix), then OAuth token (if `prsm_at_` prefix). Returns 401 with `WWW-Authenticate: Bearer` when no auth (triggers OAuth flow).

**OAuth tables**: `oauthClients` (dynamic registration), `oauthAuthCodes` (PKCE codes, 10-min expiry), `oauthTokens` (access + refresh, revocable)

**Remote MCP endpoint** (`POST /mcp`):
- Implements MCP Streamable HTTP transport (JSON-RPC 2.0 over HTTP POST)
- Handles: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`
- All 14 tools defined inline with JSON Schema input schemas
- Tool execution routed to same internal queries/mutations as data API routes

**Local MCP Server** (`mcp-server/`):
- `src/index.ts` — Entry point, validates env vars, registers tools, connects via stdio
- `src/client.ts` — `PrismClient` HTTP client for Convex MCP data routes
- `src/tools/` — Tool definitions: policies, quotes, applications, threads, context, org, agent

**14 MCP Tools**: `list_policies`, `get_policy`, `search_policies`, `get_policy_stats`, `list_quotes`, `get_quote`, `list_applications`, `get_application`, `list_threads`, `get_thread_messages`, `get_business_context`, `get_org_info`, `ask_prism`, `update_business_context`

**Key files**:
- `convex/oauth.ts` — OAuth logic: client registration, code exchange, token validation/refresh/revocation, connected apps listing
- `convex/apiKeys.ts` — API key CRUD + internal validation
- `convex/lib/mcpAuth.ts` — Legacy `requireApiKey` helper (now superseded by `requireMcpAuth` in http.ts)
- `convex/actions/mcpChat.ts` — Non-streaming chat action for `ask_prism` tool
- `convex/http.ts` — OAuth endpoints + remote MCP endpoint (`/mcp`) + data API routes (`/mcp/*`)
- `app/oauth/authorize/page.tsx` — OAuth authorization page (login + consent UI)

**Setup (Remote — Claude.ai, ChatGPT)**:
1. In Claude.ai: Settings > Connectors > Add custom connector
   - Name: `Prism`
   - Remote MCP server URL: `https://<deployment>.convex.site/mcp`
2. Claude.ai auto-discovers OAuth, opens browser for login, user signs in and clicks "Allow"
3. Connected apps appear in Settings > Connected Apps and can be revoked

**Setup (Local — Claude Code, Cursor)**:
Build with `cd mcp-server && npm install && npm run build`. Configure in `~/.claude/mcp.json`:
```json
{
  "mcpServers": {
    "prism": {
      "command": "node",
      "args": ["<path>/mcp-server/dist/index.js"],
      "env": {
        "PRISM_CONVEX_SITE_URL": "https://<deployment>.convex.site",
        "PRISM_API_KEY": "prism_..."
      }
    }
  }
}
```
