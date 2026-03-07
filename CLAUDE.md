# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Start Next.js dev server (Turbopack)
- `npm run build` — Production build
- `npm run lint` — ESLint
- `npx convex dev` — Start Convex dev backend (runs alongside Next.js dev)
- `npx convex run seed:seed` — Seed demo data
- `npx convex run migrations:migratePolicies` — Backfill old policy records

## Architecture

AI-powered insurance policy extraction system. Emails are scanned via IMAP, classified using keyword heuristics + Claude Haiku, and policy data is extracted from PDF attachments using Claude Sonnet.

### Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- **Backend**: Convex (realtime serverless DB + functions)
- **AI**: Anthropic Claude API (`@anthropic-ai/sdk`)
- **Email**: imapflow for IMAP scanning
- **UI**: shadcn/ui (base-nova style) + Base-UI primitives, Framer Motion, Lucide icons

### Authentication & Authorization

Auth is handled by `@convex-dev/auth` with email OTP (one-time password) login. Key patterns:

- **`convex/lib/auth.ts`** — `requireAuth(ctx)` helper extracts the authenticated user ID from the Convex context. Used by all public queries/mutations that need user scoping.
- **Public queries/mutations** (`query`, `mutation`, `action`) — Have auth context from the browser session. Use `requireAuth(ctx)` or `api.users.viewer` to get the current user.
- **Internal functions** (`internalQuery`, `internalMutation`, `internalAction`) — Called via `ctx.scheduler.runAfter()` or `internal.*` references. These run **without auth context** and cannot call `requireAuth`. They must use internal queries/mutations (e.g., `internal.emails.getInternal`, `internal.connections.getInternal`) instead of public ones.
- **CRITICAL**: Never call a public `query`/`mutation` that uses `requireAuth` from an `internalAction`. This will fail with "Not authenticated". Always create corresponding `internalQuery`/`internalMutation` variants for use by scheduled/internal functions.

### Data Flow

1. `scanInbox` action (public) → fetches emails via IMAP with date range + sender domain filters, deduplicates by messageId, saves scan params
2. `classifyEmails` internal action (scheduled) → keyword matching + Claude Haiku for ambiguous cases, skips emails that already have policies, tracks progress
3. `extractPolicy` internal action (scheduled) → downloads PDF, stores in Convex file storage, sends to Claude Sonnet for structured extraction with provenance tracking
4. `retryExtraction` action (public) → re-parses saved raw response first, falls back to full API call
5. `reExtractFromFile` action (public) → re-extracts from an uploaded replacement PDF

### Key Backend Files (convex/)

- `schema.ts` — Three tables: `emailConnections`, `emails`, `policies`
- `policies.ts` — Queries (list, stats, getFileUrl, emailIdsWithPolicies) and mutations (insert, updateExtraction, softDelete, restore, generateUploadUrl)
- `connections.ts` — CRUD + cascade delete with optional policy cleanup. Internal queries (`getInternal`) for scheduled actions
- `emails.ts` — Insert with messageId dedup, classification, processing status. Internal queries (`getInternal`, `listByConnection`) for scheduled actions
- `actions/` — Server actions for IMAP scanning, classification, extraction
- `lib/prompts.ts` — Extraction prompts (EXTRACTION_PROMPT, METADATA_PROMPT, buildSectionsPrompt)
- `lib/extraction.ts` — Shared extraction helpers (stripFences, applyExtracted, mergeChunkedSections, getPageChunks)
- `lib/policyTypes.ts` — Insurance keyword lists and policy type label map

### Key Frontend Patterns

- All pages are `"use client"` with Convex React hooks (`useQuery`, `useMutation`, `useAction`)
- Path alias: `@/*` maps to project root
- Filtering/aggregation done client-side with `useMemo` over Convex query results
- FadeIn wrapper component for staggered animations
- Dialog component (from shadcn/base-ui) for destructive action confirmations
- PillButton component with variants: primary, secondary, destructive, ghost, icon

### Schema Notes

- `policies.policyTypes` is an array (multi-type support); old `policyType` field kept as optional for backward compat
- `policies.documentType` distinguishes `"policy"` from `"quote"`
- `policies.deletedAt` for soft deletes — all list/stats queries filter these out
- `policies.rawExtractionResponse` stores Claude's raw output for retry without API call
- `policies.document` stores structured sections with provenance (page numbers, section references)
- Entity fields: `security` (insurer), `underwriter`, `mga` (program administrator), `broker`
- `emailConnections.scanProgress` tracks real-time scan progress (phase, counts)
- `emailConnections.lastScanParams` stores last scan configuration for modal defaults

### Routes

All routes require authentication (redirect to `/login` if not logged in) except `/login` itself.

- `/` — Dashboard with stats cards, filters, policy table
- `/login` — Email OTP authentication (no auth required)
- `/policies` — Full policy list with type/carrier/year filters
- `/policies/[id]` — Policy detail with document sections, coverages table, PDF download/upload, soft delete
- `/connections` — IMAP connection management with scan modal and real-time progress
- `/extractions` — Pending extraction queue + completed extraction log
