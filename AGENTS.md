# AGENTS.md

Guidance for any coding agent working in this repository: Codex, Claude Code, Cursor, or similar tools.

## Workflow

- After major architecture or data-flow changes, update `AGENTS.md` and `README.md`.
- Prefer documenting current behavior over planned behavior.
- Treat the Convex worktree as potentially dirty. Do not revert unrelated user changes.

## Commands

- `npm install` — install dependencies
- `npm run dev` — start the Next.js app
- `npx convex dev` — start the Convex backend
- `npm run build` — production build
- `npm run lint` — repo-wide ESLint
- `npx tsc --noEmit` — TypeScript validation
- `npx convex run seed:seed` — seed demo data
- `npx convex run actions/backfillChunks:backfill --args '{"orgId":"..."}'` — embed existing documents for vector search

## High-Level Architecture

Prism is an insurance intelligence platform built on Next.js + Convex. It ingests insurance documents from email and uploads, extracts structured policy or quote data with `@claritylabs/cl-sdk`, stores retrieval-friendly chunks for vector search, and exposes that data to agent workflows for Q&A, application assistance, COI generation, and MCP access.

Core layers:

- Frontend: Next.js 16 App Router, React 19, Tailwind 4
- Backend: Convex queries, mutations, actions, scheduler, file storage, vector search
- AI runtime: Vercel AI SDK (`ai`)
- Extraction and prompts: `@claritylabs/cl-sdk@0.11.x`
- Providers: OpenAI, MoonshotAI, Anthropic
- Email: IMAP scanning via `imapflow`, outbound/inbound flows via Resend

## Current Model Routing

Model routing lives in [convex/lib/models.ts](/Users/terrywang/Repos/prism/convex/lib/models.ts).

- `chat`, `chat_with_tools`, `extraction` → `gpt-5.4-mini`
- `email_draft`, `email_reply`, `analysis` → `kimi-k2.5`
- `classification`, `summary` → `claude-haiku-4-5-20251001`

Fallback behavior:

- `getModel()` falls back to Claude Haiku if a provider is unavailable.
- `generateTextWithFallback()` and `generateStructuredWithFallback()` retry failed calls on Claude Haiku unless the original model already was Haiku.

## cl-sdk Integration

The Prism-specific `cl-sdk` wiring lives under `convex/lib/`.

- [sdkCallbacks.ts](/Users/terrywang/Repos/prism/convex/lib/sdkCallbacks.ts): adapts Prism model routing to `cl-sdk` callbacks
- [extraction.ts](/Users/terrywang/Repos/prism/convex/lib/extraction.ts): builds a preconfigured extractor
- [documentMapping.ts](/Users/terrywang/Repos/prism/convex/lib/documentMapping.ts): maps SDK documents to Convex policy records
- [convexDocumentStore.ts](/Users/terrywang/Repos/prism/convex/lib/convexDocumentStore.ts): `DocumentStore` adapter
- [convexMemoryStore.ts](/Users/terrywang/Repos/prism/convex/lib/convexMemoryStore.ts): `MemoryStore` adapter
- [queryAgent.ts](/Users/terrywang/Repos/prism/convex/lib/queryAgent.ts): `createQueryAgent()` wrapper
- [agentPrompts.ts](/Users/terrywang/Repos/prism/convex/lib/agentPrompts.ts): SDK prompt exports plus Prism retrieval-backed context builders

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

- [convex/actions/extractPolicy.ts](/Users/terrywang/Repos/prism/convex/actions/extractPolicy.ts)
- [convex/actions/extractFromUpload.ts](/Users/terrywang/Repos/prism/convex/actions/extractFromUpload.ts)
- [convex/actions/reExtractFromFile.ts](/Users/terrywang/Repos/prism/convex/actions/reExtractFromFile.ts)
- [convex/actions/retryExtraction.ts](/Users/terrywang/Repos/prism/convex/actions/retryExtraction.ts)

Flow:

1. Fetch or receive a PDF.
2. Store the raw PDF in Convex file storage.
3. Run `buildExtractor().extract(pdfBase64, documentId)`.
4. Map `InsuranceDocument` into Prism policy fields.
5. Persist the extracted document and metadata.
6. Chunk the document and embed each chunk with `text-embedding-3-small`.
7. Store chunks in `documentChunks` for semantic retrieval.
8. Schedule proactive analysis and renewal comparison jobs.

## Retrieval And Agent Context

Prism uses two vector-backed stores:

- `documentChunks` for extracted policy/quote content
- `conversationTurns` for cross-thread memory

[agentPrompts.ts](/Users/terrywang/Repos/prism/convex/lib/agentPrompts.ts) builds agent context like this:

- if chunks exist, embed the query and search `documentChunks`
- otherwise, fall back to a keyword-scored document summary
- combine policy index, quote index, and relevant chunk excerpts into one prompt block

[queryAgent.ts](/Users/terrywang/Repos/prism/convex/lib/queryAgent.ts) wraps `cl-sdk`’s `createQueryAgent()` with Convex-backed document and memory stores.

## Convex Patterns

Auth pattern:

- Public Convex functions have user auth context.
- Internal functions do not.
- Never call a public function that depends on `requireAuth()` from an internal action.

Storage and retrieval pattern:

- `policies.document` stores the structured extracted document
- `documentChunks` stores semantic chunks plus embeddings
- `orgMemory` stores analysis-derived facts, preferences, risk notes, and observations

## Main Product Flows

### Email Scan To Policy

1. Scan IMAP inboxes.
2. Classify insurance-related emails.
3. Extract PDFs through `cl-sdk`.
4. Store documents, chunks, embeddings, and analysis.

### Agent Q&A

1. Load org context, policies, quotes, and memory.
2. Build retrieval-backed document context.
3. Run the selected chat model.
4. Persist conversation state and any relevant memory.

### Application Assistance

Application workflows live mainly in [convex/actions/processApplication.ts](/Users/terrywang/Repos/prism/convex/actions/processApplication.ts).

The pipeline:

1. Detect application forms from inbound email or uploads.
2. Extract fillable fields.
3. Auto-fill from business context, profile data, policies, and prior answers.
4. Ask for missing information in batches.
5. Parse replies, update answers, and save non-transient business facts.
6. Generate confirmation output and optionally a filled PDF.

## MCP

Prism exposes MCP functionality for remote and local AI tools.

- Remote MCP is served from Convex HTTP handlers.
- Local MCP support lives under [mcp-server/](/Users/terrywang/Repos/prism/mcp-server).
- Settings UI refers to remote connected apps and local API-key-based tools separately.

## Documentation Maintenance

When behavior changes, prefer updating:

- `README.md` for user-facing architecture and setup
- `AGENTS.md` for engineering and agent workflow detail
- inline comments only when they clarify non-obvious code paths
