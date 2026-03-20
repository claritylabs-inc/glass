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

## Architecture

AI-powered insurance platform with policy extraction and application assistance. Emails are scanned via IMAP, classified using keyword heuristics + Claude Haiku, and policy data is extracted from PDF attachments using Claude Sonnet. Clarity Agent handles policy/quote Q&A and insurance application form filling via email and web chat.

### Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- **Backend**: Convex (realtime serverless DB + functions)
- **AI**: Anthropic Claude API (`@anthropic-ai/sdk`), `@claritylabs-inc/cl-sdk` (shared prompts, extraction logic, PDF filling)
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
3. `extractPolicy` internal action (scheduled) → downloads PDF, stores in Convex file storage, sends to Claude Sonnet for structured extraction with provenance tracking
4. `retryExtraction` action (public) → re-parses saved raw response first, falls back to full API call
5. `reExtractFromFile` action (public) → re-extracts from an uploaded replacement PDF

### Data Flow — Clarity Agent (Email)

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

### Data Flow — Web Chat

1. User clicks "New Chat" on `/agent` → `create` mutation creates `webChats` record → chat selected in UI
2. User sends message → `sendMessage` mutation inserts `webChatMessages` (role="user"), updates `lastMessageAt`, schedules `processWebChat` action
3. `processWebChat` internal action: inserts processing placeholder → loads org, policies, quotes → builds system prompt (reuses `buildSystemPrompt` from `agentPrompts.ts` in direct mode + web-chat addendum) → loads document context + cross-thread email memory → calls Claude Haiku → updates agent message
4. Auto-title: after first agent response, generates 3-6 word title via Haiku
5. Real-time: Convex subscriptions update all connected clients instantly (multi-user collaboration)

### Data Flow — Business Context

- `orgBusinessContext` table stores reusable org data (company info, operations, financial, coverage, etc.)
- Auto-saved from application answers (excluding transient/date fields) for future pre-filling
- Manually managed via Settings > Business Context tab
- Used as primary auto-fill source for new applications

### `@claritylabs-inc/cl-sdk` Package

All prompts, AI extraction logic, PDF filling helpers, and agent prompt building have been extracted into the `@claritylabs-inc/cl-sdk` npm package (hosted on GitHub Package Registry via `.npmrc`). The local `convex/lib/` files now re-export from `@claritylabs-inc/cl-sdk`:

- `lib/prompts.ts` — Re-exports extraction prompts (EXTRACTION_PROMPT, METADATA_PROMPT, buildSectionsPrompt, etc.)
- `lib/extraction.ts` — Re-exports extraction helpers (stripFences, applyExtracted, callClaude, extractFromPdf, etc.) and types (LogFn, PromptBuilder)
- `lib/applicationPrompts.ts` — Re-exports application prompts (classify, extract fields, auto-fill, batch questions, etc.)
- `lib/pdfFiller.ts` — Re-exports PDF filling functions (getAcroFormFields, fillAcroForm, overlayTextOnPdf) and types
- `lib/aiClassifier.ts` — Re-exports CLASSIFY_EMAIL_PROMPT
- `lib/agentPrompts.ts` — Re-exports buildSystemPrompt, buildConversationMemoryContext + thin adapter functions (`buildDocumentContext`, `buildPolicyContext`) that map Convex `Doc` types to cell's framework-agnostic interfaces

To modify prompts or extraction logic, update the `@claritylabs-inc/cl-sdk` package and bump the version.

### Key Backend Files (convex/)

- `schema.ts` — Tables: `emailConnections`, `emails`, `policies`, `organizations`, `orgMemberships`, `orgInvitations`, `agentConversations`, `orgBusinessContext`, `applicationSessions`, `webChats`, `webChatMessages`
- `policies.ts` — Queries (list, stats, getFileUrl, emailIdsWithPolicies) and mutations (insert, updateExtraction, softDelete, restore, generateUploadUrl)
- `connections.ts` — CRUD + cascade delete with optional policy cleanup. Internal queries (`getInternal`) for scheduled actions
- `emails.ts` — Insert with messageId dedup, classification, processing status. Internal queries (`getInternal`, `listByConnection`) for scheduled actions
- `businessContext.ts` — CRUD for org business context (list grouped by category, upsert by key, bulk upsert). Public + internal variants
- `applicationSessions.ts` — Application session lifecycle (list, get, stats, cancel). Internal: create, updateFields, updateStatus, findByThreadId, markComplete
- `webChats.ts` — Web chat CRUD (list, get, messages, create, sendMessage, archive). Internal mutations for agent response (insertAgentMessage, updateAgentMessage, updateAgentError, touchChat, updateTitleInternal)
- `agentConversations.ts` — Agent conversation records with cross-thread memory
- `actions/handleInboundEmail.ts` — Inbound email routing: application detection, reply routing, agent Q&A
- `actions/processApplication.ts` — Application workflow: field extraction, auto-fill, batched Q&A, confirmation, summary PDF generation
- `actions/processWebChat.ts` — Web chat agent response: builds context from policies/quotes/email memory, calls Claude Haiku, auto-titles
- `actions/` — Also: IMAP scanning, classification, extraction
- `lib/applicationTypes.ts` — Types for form fields (SimpleField, TableField, DeclarationField), QuestionBatch
- `lib/policyTypes.ts` — Insurance keyword lists and policy type label map

### Key Frontend Patterns

- **App Shell layout**: All authenticated pages use `<AppShell>` which provides a persistent left sidebar (`AppSidebar`), top bar with breadcrumbs (`AppTopBar`), and "Ask Clarity" chat input at the bottom (`AskClarityInput`). Pages just render their content inside `<AppShell>`.
- **Sidebar**: `components/app-sidebar.tsx` — collapsible (220px / 56px), persisted in localStorage, mobile overlay drawer. Sections: Insurance (Dashboard, Policies, Quotes, Applications), Tools (Connections, Clarity Agent), Chats (latest 5 web chats + new chat button), bottom links (Settings for admin, Profile, Sign out).
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

### Schema Notes

- `policies.policyTypes` is an array (multi-type support); old `policyType` field kept as optional for backward compat
- `policies.documentType` distinguishes `"policy"` from `"quote"`
- `policies.deletedAt` for soft deletes — all list/stats queries filter these out
- `policies.rawExtractionResponse` stores Claude's raw output for retry without API call
- `policies.document` stores structured sections with provenance (page numbers, section references)
- Entity fields: `security` (insurer), `underwriter`, `mga` (program administrator), `broker`
- `emailConnections.scanProgress` tracks real-time scan progress (phase, counts)
- `emailConnections.lastScanParams` stores last scan configuration for modal defaults
- `orgBusinessContext` stores reusable org data keyed by category + key, with source tracking (manual, onboarding, application, user_email) and confidence (confirmed, inferred)
- `applicationSessions.extractedFields` and `questionBatches` are JSON-serialized strings (Convex doesn't support deeply nested dynamic objects)
- `applicationSessions.filledFileId` stores the filled PDF (generated on demand via AcroForm, overlay, or standalone mode)
- `applicationSessions.status` lifecycle: extracting_fields → filling_known → asking_questions → pending_confirmation → confirmed → complete (or cancelled)
- `webChats` stores org-scoped chat sessions with title, createdBy, lastMessageAt, optional archivedAt
- `webChatMessages` stores chat messages with role (user/agent), denormalized userName, optional status (processing/error)

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
- `/agent` — Clarity Agent: unified conversations (email threads + web chats with "New Chat" button, application badges), settings (email address, modes)
- `/settings` — Organization settings with 3 tabs: Basic Information, Team Members, Business Context
- `/profile` — User profile page
- `/api/flatten-pdf` — POST: PDF flattening via mupdf WASM (bearer token auth, no user auth)
