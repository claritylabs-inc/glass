# Glass

Glass is Clarity Labs' insurance intelligence platform. It has evolved well beyond the original Glass clone into a broker/client workspace that combines document extraction, conversational AI, org memory, integrations, and API/MCP surfaces in one system.

For contributor-facing implementation detail, see [AGENTS.md](AGENTS.md).

## What Glass Does

- Ingests insurance-related documents from email and uploads
- Extracts structured policy, quote, and supporting business data
- Builds a continuously-updated `orgIntelligence` memory layer
- Supports agent workflows for Q&A, application help, COI generation, and follow-up analysis
- Exposes capabilities through UI, REST API (`/api/v1/*`), and MCP (`/mcp` + local server)
- Syncs external financial/HR context via Merge.dev

## Stack

- Next.js 16 + React 19 + Tailwind 4
- Convex (DB, actions, scheduler, storage, vector search, HTTP)
- Vercel AI SDK (`ai`) for model execution + tool-enabled chat
- `@claritylabs/cl-sdk@0.16.x` for extraction and insurance-focused primitives
- Resend + IMAP (`imapflow`) for email ingest and messaging workflows

## Getting Started

```bash
npm install
npm run dev
npx convex dev
```

Then open `http://localhost:3000`.

## Useful Commands

- `npm run build` - production build
- `npm run lint` - ESLint
- `npm test` - run tests
- `npx tsc --noEmit` - Next.js TypeScript check
- `npx convex typecheck` - Convex type check
- `npx convex deploy --yes` - deploy Convex functions to prod

## Environment

Common variables used across major workflows:

- `CONVEX_DEPLOYMENT`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `MOONSHOTAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `AUTH_RESEND_KEY` — Resend API key (shared by all outbound email)
- `RESEND_WEBHOOK_SECRET`
- `AGENT_DOMAIN` — verified Resend sending domain (prod: `glass.claritylabs.inc`, dev: `dev.claritylabs.inc`). Used for agent addresses and the `notifications@{domain}` sender.
- `AUTH_EMAIL_FROM` — optional `From:` override for OTP sign-in emails. Defaults to `Clarity Labs <noreply@{AGENT_DOMAIN}>`.
- `SITE_URL`
- `MERGE_API_KEY`
- `MERGE_WEBHOOK_SECRET`
- `INTEGRATION_TOKEN_ENC_KEY`

Not every flow requires every variable; requirements depend on which features you are running.

## Core Flows

### 1) Ingest + Extract

1. Scan inboxes or accept uploads.
2. Store raw files in Convex storage.
3. Extract structured insurance/business data via `cl-sdk`.
4. Persist policy data and chunk + embed content for retrieval.
5. Write key facts into `orgIntelligence` with temporal metadata.

### 2) Retrieval + Agent Chat

Agent responses are grounded in:

- `documentChunks` (policy/quote/supporting docs)
- `orgIntelligence` (organization facts)
- `conversationTurns` (cross-thread memory)

### 3) Application Assistance

Application sessions auto-fill from known context, ask for missing answers in batches, and store new non-transient facts back into intelligence.

### 4) Integrations + APIs

- Merge.dev sync enriches underwriting context (accounting/HR/payroll metrics)
- REST API exposes broker/client resources under `/api/v1/*`
- MCP enables remote and local AI tool access

## Model Routing

Model routing is defined in `convex/lib/models.ts`:

- `chat`, `chat_with_tools`, `extraction`, `application_authoring` -> `gpt-5.5` with OpenAI `reasoningEffort: "none"`
- `email_draft`, `email_reply`, `analysis` -> `kimi-k2.5`
- `classification`, `summary`, `triage`, `email_extraction`, `document_extraction`, `security` -> `gpt-5.4-mini`

Fallback logic retries supported calls on `gpt-5.5` with reasoning disabled if the primary provider fails.

## Convex Rule Of Thumb

Internal Convex functions do not have user auth context. Do not call public auth-dependent functions from internal actions.

## Key Files

- `convex/lib/models.ts` - model routing
- `convex/lib/sdkCallbacks.ts` - `cl-sdk` callback adapter
- `convex/lib/agentPrompts.ts` - retrieval context builders
- `convex/actions/extractPolicy.ts` - policy extraction entrypoint
- `convex/actions/processApplication.ts` - application workflow
- `convex/actions/dreamConsolidation.ts` - intelligence cleanup and consolidation
- `convex/actions/mergeSync.ts` - Merge sync pipeline
- `convex/http.ts` - HTTP, REST, and MCP routes
