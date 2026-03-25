# Prism — Insurance Intelligence Platform

AI-powered insurance platform with policy extraction, quote management, and application assistance. Connects to IMAP email accounts, scans for insurance-related emails, extracts structured policy data from PDFs, and provides an AI agent (Prism) that handles policy Q&A and insurance application form filling via email and web chat.

## Getting Started

```bash
npm install
npm run dev          # Start Next.js dev server (Turbopack)
npx convex dev       # Start Convex backend (separate terminal)
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

### Environment Setup

Requires a Convex project and API keys:

- `CONVEX_DEPLOYMENT` — Convex project URL (set via `npx convex dev`)
- `ANTHROPIC_API_KEY` — Set in Convex dashboard environment variables
- `AUTH_RESEND_KEY` — Resend API key for outbound agent emails + OTP auth
- `RESEND_WEBHOOK_SECRET` — Resend webhook verification secret
- `AGENT_DOMAIN` — Domain for agent email addresses (default: `prism.claritylabs.inc`)
- `SITE_URL` — Public URL for the app (default: `https://prism.claritylabs.inc`)

## Architecture

### Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- **Backend**: [Convex](https://convex.dev) — realtime serverless database + functions
- **AI**: Anthropic Claude API — Haiku for classification/routing, Sonnet for extraction
- **Email Inbound**: ImapFlow for IMAP inbox scanning, Resend webhooks for agent inbound
- **Email Outbound**: Resend API for agent replies + auth OTP
- **PDF Generation**: pdfkit for application summary PDFs
- **UI**: shadcn/ui (base-nova style), Framer Motion, Lucide icons

### Authentication

Auth uses `@convex-dev/auth` with email OTP (one-time password). All routes except `/login` require authentication.

**Important for backend development**: Convex has two function contexts:
- **Public functions** (`query`, `mutation`, `action`) — called from the browser, have user auth context
- **Internal functions** (`internalQuery`, `internalMutation`, `internalAction`) — called via scheduler or `internal.*`, run **without auth context**

Internal functions must use internal query variants (e.g., `internal.emails.getInternal`) instead of public queries that call `requireAuth`. See `convex/lib/auth.ts`.

## Data Flows

### Policy Extraction

1. **Scan** — User configures date range + sender domain filters, triggers IMAP scan
2. **Classify** — Emails classified using keyword heuristics + Claude Haiku for ambiguous cases
3. **Extract** — Insurance emails with PDF attachments sent to Claude Sonnet for structured extraction with page-level provenance
4. **Review** — Users review extracted policies, coverages, and document sections with references back to source PDF pages

### Prism — Email Q&A

1. **Inbound routing** — Resend webhook → verify signature → dedup → resolve org by agent handle → detect mode (direct/cc/forward/unknown) → resolve thread
2. **Policy/Quote Q&A** — Builds system prompt with org context, loads matching policies/quotes, searches cross-thread conversation memory → Haiku generates response → sends reply with threading headers
3. **Unknown mode** — Forwards unclassifiable emails to org admin for manual review

### Application Processing

Prism can help users fill out insurance application forms (PDFs). The full workflow:

#### Detection
- **Trigger**: Direct email to agent with PDF attachment + application intent keywords ("help fill out", "application", "acord", etc.)
- **Classification**: Claude Haiku classifies the PDF as an application form (vs policy/quote/certificate). Requires confidence > 0.7
- **Immediate ack**: Sends "reviewing your application" email before extraction begins (threaded to original)

#### Step 1: Field Extraction (Claude Sonnet)
- Extracts all fillable fields from the PDF as structured JSON
- Field types: `text`, `numeric`, `currency`, `date`, `yes_no`, `table`, `declaration`
- Handles grouped checkbox/radio fields as single fields with `options` array (e.g., "Business Type" with options [Corporation, Partnership, LLC, ...])
- `max_tokens: 16384` for large forms; falls back to `salvageTruncatedJsonArray` if response is truncated
- Stores raw extraction response for retry capability

#### Step 2: Auto-Fill (Claude Haiku)
Gathers context from 5 sources and matches to extracted fields:

| Source | Data |
|--------|------|
| **Org business context** | Saved answers from previous applications (`orgBusinessContext` table) |
| **Org details** | Company name, website, industry, industry vertical, business description, broker info |
| **User contact info** | Name, email, title, phone |
| **Existing policies** | Carrier, policy number, effective/expiry dates, premium, coverage limits, deductibles — from the `policies` table |
| **Web research** | Fetches org website → Haiku extracts business facts (services, years in business, employees, certifications) |

If no matching current policy exists for the application type, a note is included so the agent asks the user if they have a current policy.

#### Step 3: Question Batching (Claude Haiku)
- Groups unfilled fields by **topic** (Company Info, Operations, Financial, Coverage, Declarations, etc.)
- No fixed batch size — each topic gets its own email, aiming for 3-8 total batches
- Questions formatted with numbered list, field-type hints (dollar amounts, dates, options), and table column specs
- Sends first batch email (threaded to ack)

#### Step 4: Answer Parsing (Claude Haiku)
- Parses user's email reply to extract answers for the current batch
- Handles: numbered answers, inline references, table data, yes/no with explanations, partial responses
- Updates field values + marks answered in batch
- Saves non-transient answers to `orgBusinessContext` for future applications
- **Transient filter**: Date fields and time-specific values (effective dates, expiry, quote-required-by, signatures) are NOT saved to persistent context
- If unanswered questions remain: re-asks just those. If batch complete: sends next batch or moves to confirmation

#### Step 5: Confirmation
- Generates readable summary grouped by section (Claude Haiku)
- Sends confirmation email: "Reply 'Looks good' to confirm, or describe any changes needed"
- Status: `pending_confirmation`

#### Step 6: Completion
- **Confirmed**: Generates summary PDF (pdfkit), stores in file storage, marks complete
- **Changes requested**: Parses changes, updates fields, re-sends updated confirmation
- **Cancelled**: Marks session cancelled, sends acknowledgment

#### Email Threading
All application emails are threaded via `In-Reply-To` and `References` headers. The session stores `originalMessageId` (from inbound) and `lastSentMessageId` (from latest outbound) for chain continuity.

#### Reply Routing
Replies to application emails are detected via 3 fallback strategies:
1. **By threadId** — standard email threading resolution (In-Reply-To → findByMessageId)
2. **By lastSentMessageId** — matches reply's In-Reply-To against `applicationSessions.lastSentMessageId`
3. **By orgId** — finds any active application session in asking/pending state for the org

#### Retry
Failed application sessions can be retried from the frontend (Applications list, application detail page, or conversation thread). Resets session state and re-schedules from field extraction.

### Business Context

- `orgBusinessContext` table stores reusable org data keyed by category + key
- Categories: company_info, operations, financial, coverage, loss_history, declarations, other
- Source tracking: manual, onboarding, application, user_email
- Confidence: confirmed, inferred
- Auto-saved from application answers (excluding transient fields)
- Managed via Settings > Business Context tab (table UI grouped by category)

## Routes

| Route | Auth | Description |
|-------|:---:|-------------|
| `/login` | No | Email OTP authentication |
| `/signup` | No | New user registration |
| `/onboarding` | Yes | Post-signup onboarding wizard |
| `/` | Yes | Dashboard — stats cards, filters, policy table |
| `/policies` | Yes | Policy list with type/carrier/year filters |
| `/policies/[id]` | Yes | Policy detail — sections, coverages, PDF viewer |
| `/quotes` | Yes | Quote list with filters |
| `/quotes/[id]` | Yes | Quote detail page |
| `/applications` | Yes | Application sessions — stats, status, progress |
| `/applications/[id]` | Yes | Application detail — fields by section, batch timeline, PDF download |
| `/connections` | Yes | IMAP connection management, scan config, real-time progress |
| `/extractions` | Yes | Extraction queue + completed log |
| `/agent` | Yes | Prism — conversations, settings |
| `/settings` | Yes | Org settings: info, team, context, connected apps, API keys |
| `/oauth/authorize` | No* | OAuth 2.1 authorization page (login + consent for MCP remote clients) |
| `/profile` | Yes | User profile |

## Key Files

### Backend (`convex/`)

| File | Purpose |
|------|---------|
| `schema.ts` | Database schema — all tables and indexes |
| `policies.ts` | Policy CRUD, stats, file storage, extraction updates |
| `quotes.ts` | Quote CRUD (similar to policies) |
| `connections.ts` | IMAP connection CRUD, scan progress, cascade delete |
| `emails.ts` | Email insert (dedup), classification, processing status |
| `orgs.ts` | Organization CRUD, member management, agent handle |
| `businessContext.ts` | Business context CRUD (grouped by category, upsert by key, bulk upsert) |
| `applicationSessions.ts` | Application session lifecycle (create → complete/cancel) |
| `agentConversations.ts` | Agent conversation records, thread resolution, cross-thread memory |
| `actions/handleInboundEmail.ts` | Inbound email routing — application detection, reply routing, Q&A |
| `actions/processApplication.ts` | Full application workflow — extraction, auto-fill, Q&A, confirmation, PDF |
| `actions/scanInbox.ts` | IMAP email fetching with date/sender filters |
| `actions/classifyEmails.ts` | Email classification (keywords + AI) |
| `actions/extractPolicy.ts` | PDF extraction via Claude Sonnet |
| `lib/applicationPrompts.ts` | Application prompts (classify, extract, auto-fill, batch, parse, summary) |
| `lib/applicationTypes.ts` | Types: FormField (Simple/Table/Declaration), QuestionBatch |
| `lib/prompts.ts` | Policy extraction prompts |
| `lib/extraction.ts` | Extraction helpers (parsing, merging, chunking) |
| `lib/agentPrompts.ts` | Agent system prompts, document context builder, memory context |
| `lib/auth.ts` | `requireAuth()` helper |
| `oauth.ts` | OAuth 2.1: client registration, auth code, token exchange/refresh/revocation |
| `apiKeys.ts` | API key management for local MCP servers |

### Frontend

| File | Purpose |
|------|---------|
| `components/policy-table.tsx` | Policy list table with sorting, filters |
| `components/applications-list.tsx` | Application sessions table with error dialog, retry |
| `components/business-context-manager.tsx` | Business context table UI grouped by category |
| `components/stats-cards.tsx` | Reusable StatCard component for metric displays |
| `components/conversation-message.tsx` | Agent conversation message bubbles |
| `components/scan-modal.tsx` | IMAP scan configuration modal |
| `components/ui/pill-button.tsx` | Primary button (primary/secondary/destructive/ghost/icon) |
| `components/ui/searchable-select.tsx` | Styled searchable dropdown |

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npx convex dev` | Start Convex dev backend |
| `npx convex run seed:seed` | Seed demo data |
| `npx convex run migrations:migratePolicies` | Backfill old policy records |

## Deployment

- **Frontend**: Deployed on [Vercel](https://vercel.com)
- **Backend**: Deployed on [Convex](https://convex.dev) (auto-deploys via GitHub Action when `convex/` changes)
