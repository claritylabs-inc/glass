# Policy Extraction System

AI-powered insurance policy extraction from email inboxes. Connects to IMAP email accounts, scans for insurance-related emails, and uses Claude AI to extract structured policy data from PDF attachments.

## Getting Started

```bash
npm install
npm run dev          # Start Next.js dev server (Turbopack)
npx convex dev       # Start Convex backend (separate terminal)
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

### Environment Setup

Requires a Convex project and Anthropic API key:

- `CONVEX_DEPLOYMENT` — Convex project URL (set via `npx convex dev`)
- `ANTHROPIC_API_KEY` — Set in Convex dashboard environment variables

## Architecture

### Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- **Backend**: [Convex](https://convex.dev) — realtime serverless database + functions
- **AI**: Anthropic Claude API — Haiku for classification, Sonnet for extraction
- **Email**: ImapFlow for IMAP inbox scanning
- **UI**: shadcn/ui (base-nova style), Framer Motion, Lucide icons

### Data Flow

1. **Scan** — User configures date range + sender domain filters, triggers IMAP scan
2. **Classify** — Emails are classified using keyword heuristics + Claude Haiku for ambiguous cases
3. **Extract** — Insurance emails with PDF attachments are sent to Claude Sonnet for structured extraction with page-level provenance
4. **Review** — Users review extracted policies, coverages, and document sections with references back to source PDF pages

### Authentication

Auth uses `@convex-dev/auth` with email OTP (one-time password). All routes except `/login` require authentication.

**Important for backend development**: Convex has two function contexts:
- **Public functions** (`query`, `mutation`, `action`) — called from the browser, have user auth context
- **Internal functions** (`internalQuery`, `internalMutation`, `internalAction`) — called via scheduler or `internal.*`, run **without auth context**

Internal functions must use internal query variants (e.g., `internal.emails.getInternal`) instead of public queries that call `requireAuth`. See `convex/lib/auth.ts`.

## Routes

| Route | Auth Required | Description |
|-------|:---:|-------------|
| `/login` | No | Email OTP authentication |
| `/` | Yes | Dashboard — stats cards, filters, policy table |
| `/policies` | Yes | Policy list with type/carrier/year filters |
| `/policies/[id]` | Yes | Policy detail — sections, coverages, PDF viewer, document upload |
| `/connections` | Yes | IMAP connection management, scan configuration, real-time progress |
| `/extractions` | Yes | Extraction queue + completed extraction log |

## Key Files

### Backend (`convex/`)

| File | Purpose |
|------|---------|
| `schema.ts` | Database schema — `emailConnections`, `emails`, `policies` tables |
| `connections.ts` | Connection CRUD, scan progress/params, cascade delete |
| `emails.ts` | Email insert (dedup), classification, processing status |
| `policies.ts` | Policy CRUD, stats, file storage, extraction updates |
| `actions/scanInbox.ts` | IMAP email fetching with date/sender filters |
| `actions/classifyEmails.ts` | Email classification (keywords + AI) |
| `actions/extractPolicy.ts` | PDF extraction via Claude Sonnet (chunked for long docs) |
| `actions/retryExtraction.ts` | Re-parse or re-extract failed policies |
| `actions/reExtractFromFile.ts` | Extract from uploaded replacement PDFs |
| `lib/prompts.ts` | AI extraction prompts |
| `lib/extraction.ts` | Extraction helpers (parsing, merging, chunking) |
| `lib/auth.ts` | `requireAuth()` helper for user authentication |

### Frontend

| File | Purpose |
|------|---------|
| `app/page.tsx` | Dashboard |
| `app/connections/page.tsx` | Connection management |
| `app/policies/page.tsx` | Policy list |
| `app/policies/[id]/page.tsx` | Policy detail |
| `components/scan-modal.tsx` | Scan configuration modal |
| `components/scan-status.tsx` | Real-time scan progress display |
| `components/ui/pill-button.tsx` | Primary button component (primary/secondary/destructive/ghost/icon) |

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
