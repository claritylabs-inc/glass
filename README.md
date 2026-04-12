# Prism

Prism is an insurance intelligence platform for ingesting policy and quote documents, extracting structured insurance data, and using that data in agent workflows for Q&A, application assistance, COI generation, and MCP integrations.

For contributor-facing architecture notes, see [AGENTS.md](/Users/terrywang/Repos/prism/AGENTS.md).

## Getting Started

```bash
npm install
npm run dev
npx convex dev
```

Open `http://localhost:3000`.

## Environment

Common environment variables:

- `CONVEX_DEPLOYMENT`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `MOONSHOTAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `AUTH_RESEND_KEY`
- `RESEND_WEBHOOK_SECRET`
- `AGENT_DOMAIN`
- `SITE_URL`
- `FLATTEN_API_KEY`

Exact requirements depend on which workflows you are exercising.

## Architecture

Prism is built with:

- Next.js 16 + React 19 for the app UI
- Convex for database, actions, scheduler, file storage, and vector search
- Vercel AI SDK for model calls
- `@claritylabs/cl-sdk@0.9.x` for document extraction, query-agent primitives, insurance prompts, chunking, and PDF helpers
- Resend + IMAP for inbound and outbound email workflows

### Current Model Routing

Model routing is centralized in [convex/lib/models.ts](/Users/terrywang/Repos/prism/convex/lib/models.ts).

- `gpt-5.4-mini` handles chat, tool chat, and extraction
- `kimi-k2.5` handles email drafting, reply writing, and analysis
- `claude-haiku-4-5-20251001` handles classification and summary tasks

If a configured provider is unavailable, Prism falls back to Claude Haiku for protected fallback paths.

## Core Flows

### Policy And Quote Extraction

1. Fetch a PDF from IMAP or upload flow.
2. Store the original file in Convex storage.
3. Run `buildExtractor()` from [convex/lib/extraction.ts](/Users/terrywang/Repos/prism/convex/lib/extraction.ts).
4. Let `cl-sdk` classify, plan, extract, review, and assemble the final `InsuranceDocument`.
5. Map the SDK document into Prism’s policy schema.
6. Chunk the document and embed those chunks for semantic retrieval.

### cl-sdk Callback Wiring

Prism’s `cl-sdk` adapter lives in [convex/lib/sdkCallbacks.ts](/Users/terrywang/Repos/prism/convex/lib/sdkCallbacks.ts).

`cl-sdk v0.9` passes document content through callback `providerOptions`:

- `providerOptions.pdfBase64`
- `providerOptions.images`

Prism converts those into AI SDK multipart content:

- PDFs become file parts
- images become image parts

Prism also preserves a higher token ceiling for exclusion-heavy extraction prompts.

### Retrieval And Agent Context

Prism stores semantic context in:

- `documentChunks` for extracted document content
- `conversationTurns` for conversation memory

[convex/lib/agentPrompts.ts](/Users/terrywang/Repos/prism/convex/lib/agentPrompts.ts) builds retrieval-backed policy and quote context. When chunks are unavailable, it falls back to a keyword-scored summary.

### Application Assistance

Application workflows live primarily in [convex/actions/processApplication.ts](/Users/terrywang/Repos/prism/convex/actions/processApplication.ts).

High-level flow:

1. Detect likely insurance application forms.
2. Extract fillable fields from the PDF.
3. Auto-fill from org context, user data, prior policies, and saved answers.
4. Ask the user for remaining data in batches.
5. Parse replies and update the application session.
6. Generate confirmation output and optionally a filled PDF.

### Proactive Analysis

After extraction, Prism can schedule follow-up analysis to:

- score a policy
- identify risks and gaps
- compare renewals
- produce portfolio-level observations

## Important Convex Rule

Internal Convex actions do not run with user auth context.

- Public functions can use auth helpers like `requireAuth()`.
- Internal functions must use internal query and mutation variants.
- Do not call public auth-dependent functions from internal actions.

## Main Files

- [convex/lib/models.ts](/Users/terrywang/Repos/prism/convex/lib/models.ts): model routing
- [convex/lib/sdkCallbacks.ts](/Users/terrywang/Repos/prism/convex/lib/sdkCallbacks.ts): `cl-sdk` callback adapter
- [convex/lib/extraction.ts](/Users/terrywang/Repos/prism/convex/lib/extraction.ts): extractor factory
- [convex/lib/agentPrompts.ts](/Users/terrywang/Repos/prism/convex/lib/agentPrompts.ts): retrieval-backed prompt context
- [convex/actions/extractPolicy.ts](/Users/terrywang/Repos/prism/convex/actions/extractPolicy.ts): IMAP-backed extraction entrypoint
- [convex/actions/processApplication.ts](/Users/terrywang/Repos/prism/convex/actions/processApplication.ts): application workflow
- [convex/http.ts](/Users/terrywang/Repos/prism/convex/http.ts): HTTP and MCP surface area

## Validation

Useful checks while working:

- `npx tsc --noEmit`
- `npm run lint`

Repo-wide lint currently includes unrelated legacy issues, so targeted validation is often more useful when working on a specific area.
