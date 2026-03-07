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

AI-powered insurance policy extraction system. Emails are scanned via IMAP, classified using keyword heuristics + Claude Haiku, and policy data is extracted from PDF attachments using Claude.

### Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- **Backend**: Convex (realtime serverless DB + functions)
- **AI**: Anthropic Claude API (`@anthropic-ai/sdk`)
- **Email**: imapflow for IMAP scanning
- **UI**: shadcn/ui (base-nova style) + Base-UI primitives, Framer Motion, Lucide icons

### Data Flow

1. `scanInbox` action → fetches emails via IMAP, deduplicates by messageId
2. `classifyEmails` action → keyword matching + Claude Haiku for ambiguous cases, skips emails that already have policies
3. `extractPolicy` action → downloads PDF, stores in Convex file storage, sends to Claude for structured extraction
4. `retryExtraction` action → re-parses saved raw response first, falls back to full API call

### Key Backend Files (convex/)

- `schema.ts` — Three tables: `emailConnections`, `emails`, `policies`
- `policies.ts` — Queries (list, stats, getFileUrl, emailIdsWithPolicies) and mutations (insert, updateExtraction, softDelete, restore)
- `connections.ts` — CRUD + cascade delete with optional policy cleanup
- `emails.ts` — Insert with messageId dedup, classification, processing status
- `actions/` — Server actions for IMAP scanning, classification, extraction
- `lib/policyTypes.ts` — Insurance keyword lists and policy type label map

### Key Frontend Patterns

- All pages are `"use client"` with Convex React hooks (`useQuery`, `useMutation`, `useAction`)
- Path alias: `@/*` maps to project root
- Filtering/aggregation done client-side with `useMemo` over Convex query results
- FadeIn wrapper component for staggered animations
- Dialog component (from shadcn/base-ui) for destructive action confirmations

### Schema Notes

- `policies.policyTypes` is an array (multi-type support); old `policyType` field kept as optional for backward compat
- `policies.documentType` distinguishes `"policy"` from `"quote"`
- `policies.deletedAt` for soft deletes — all list/stats queries filter these out
- `policies.rawExtractionResponse` stores Claude's raw output for retry without API call
- Carrier, MGA (`mga`), and broker are separate optional fields

### Routes

- `/` — Dashboard with stats cards, filters, policy table
- `/policies` — Full policy list with type/carrier/year filters
- `/policies/[id]` — Policy detail with coverages table, PDF download, soft delete
- `/connections` — IMAP connection management with scan triggers
- `/extractions` — Pending extraction queue + completed extraction log
