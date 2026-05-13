# AGENTS.md

Guidance for any coding agent working in this repository: Codex, Claude Code, Cursor, or similar tools.

## Workflow

- After major architecture or data-flow changes, update `AGENTS.md`.
- Prefer documenting current behavior over planned behavior.
- Treat the Convex worktree as potentially dirty. Do not revert unrelated user changes.
- Use `dayjs` for date parsing, formatting, comparisons, and timestamps in new or touched code instead of raw `Date.now()`, `Date.parse()`, or `new Date(...)`.

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
- Extraction, query agent, and prompts: `@claritylabs/cl-sdk@1.1.x`
- Providers: OpenAI, MoonshotAI, Anthropic, DeepSeek
- Email: outbound + inbound via Resend (no IMAP, no Gmail OAuth). All outbound Resend calls go through `convex/lib/resend.ts` (`sendResendEmail`). Sending domain comes from `AGENT_DOMAIN` (prod: `glass.claritylabs.inc`, dev: `dev.claritylabs.inc`). Inbound webhook at `POST /resend-inbound`.
- iMessage / Spectrum: Photon-backed iMessage is production-only. Set `IMESSAGE_ENABLED=true`, `IMESSAGE_WORKER_URL`, `IMESSAGE_WORKER_SECRET`, and `NEXT_PUBLIC_GLASS_IMESSAGE_NUMBER` only in production with the production Photon account. For dev/preview testing, keep `IMESSAGE_ENABLED` false and use the Spectrum Terminal provider in `imessage-worker` (`SPECTRUM_PROVIDER=terminal`, `IMESSAGE_TERMINAL_FROM_PHONE=<test user phone>`). Convex accepts terminal-driven inbound messages only when `IMESSAGE_TERMINAL_ENABLED=true`; do not set `NEXT_PUBLIC_GLASS_IMESSAGE_NUMBER` in dev/preview unless intentionally advertising a test line. iMessage direct chats and groups both enter through `/imessage-inbound`; group chats are keyed by Photon chat GUID and mirrored into `imessageChats` / `imessageParticipants` so Glass can distinguish linked users from anonymous participants.

## Current Model Routing

Default model routing lives in [convex/lib/models.ts](convex/lib/models.ts), with broker-visible catalogs in [convex/lib/modelCatalog.ts](convex/lib/modelCatalog.ts).

- `chat`, `chat_with_tools`, `email_draft`, `email_reply` → `gpt-5.4-mini`
- `application_authoring`, `analysis` → `kimi-k2.6`
- `extraction`, `classification`, `email_extraction`, `document_extraction` → `gpt-5.4-nano`
- `summary`, `triage`, `security` → `gpt-5.4-mini`
- `embeddings` → `text-embedding-3-small` at 1536 dimensions

Usage notes:

- Broker admins can configure their own provider API keys and per-use-case model routes in `/settings?section=models`.
- Broker model settings are stored in `brokerModelSettings`, keyed by broker org. Client-org workflows inherit the managing broker's settings.
- The UI never exposes Glass's exact default model configuration; model selectors unlock only for providers where the broker has supplied an API key.
- `embeddings` is routed separately from language-model use cases and is restricted to embedding models. Embeddings remain 1536-dimensional to match Convex vector indexes.
- Main org-aware actions use `getModelForOrg(ctx, orgId, task)`, which applies broker overrides only when a matching broker-owned provider key exists.
- SDK-facing extraction passes the org context into the SDK callbacks, so broker-owned provider keys and routes apply to `cl-sdk` model calls. SDK-facing workflows also pass model capability metadata from `MODEL_CAPABILITIES` in [convex/lib/modelCatalog.ts](convex/lib/modelCatalog.ts), so `cl-sdk` can resolve task-aware token budgets for extraction, query, and PCE instead of relying on low static caps.

Fallback behavior:

- If no broker key exists for a route, Glass uses its opaque default configuration.
- `getModel()` falls back to Claude Haiku if a provider is unavailable.
- `generateTextWithFallback()` and `generateStructuredWithFallback()` use task-aware fallback policy. Missing API key errors are not retried, because retrying another OpenAI model does not fix a missing key and only adds latency. Low-cost extraction/classification calls stay on the nano path by default; only SDK `taskKind`s that represent validation repair, ambiguous synthesis, unsupported source-evidence resolution, or high-risk packet generation may escalate to the fallback route in [convex/lib/modelCatalog.ts](convex/lib/modelCatalog.ts).

## Compliance Requirements

Glass now has a top-level compliance workflow for contractor/vendor insurance monitoring. `insuranceRequirements` stores one active/archived requirement set per organization; requirements are category-tagged rules that apply to vendors, the org's own coverage, or both. Requirement records deliberately mirror the policy `coverages` shape (`name`, `coverageCode`, `limit`, numeric `limitAmount`, limit typing, deductible fields, and `originalContent`) so compliance comparison can operate on the same schema as extracted policy coverage data. Client/customer requirements establish the minimum vendor standard. Requirements can be created one at a time or bulk-generated from pasted text / uploaded requirement documents through `convex/actions/complianceRequirements.ts`, which extracts text from TXT/Markdown/PDF/DOCX/CSV/JSON inputs and uses Glass's static `gpt-5.4-mini` chat route to produce coverage-shaped structured requirements. Current web and MCP surfaces compute live checklist status from active connected vendors plus extracted `policies` data. The daily `vendorComplianceMonitor` cron records deterministic snapshots in `vendorComplianceChecks`, creates client notifications and notification emails for new or recurring compliance gaps, drafts vendor follow-up emails when a vendor contact is available, and sends iMessage/SMS alerts to org admins with phone numbers when the worker is configured. The deterministic checker matches requirement categories/text against policy types, summaries, coverages, expiration dates, structured coverage limits, and insured names, returning `met`, `missing`, `expiring_soon`, or `expired`; future LLM review should augment this table rather than replacing requirement ownership.

Surfaces:

- Web: `/compliance` is focused on requirement creation/management. Its top-bar actions open separate right-side asides for bulk import and manual entry; it should not render vendor/client monitoring cards. Vendor orgs also see active client-owned vendor requirements as read-only rows under **My requirements**, labeled as client requirements from the source client org; those rows cannot be archived by the vendor. **My requirements** rows include live compliance status badges (`Met`, `Needs attention`, `Not met`) based on the org's current policies. Orgs that are purely vendors hide the **Vendor requirements** tab, while mixed orgs still show both **Vendor requirements** and **My requirements**.
- Connect: `/connect/vendors` is for vendors the org contracts with and monitors against its own standards; active vendor rows hide the invite/note copy, show one of `invited`, `waiting on policies`, `active / noncompliant`, or `active / compliant`, expand into a full requirement checklist with matched policy, limit, expiration, and insured-name details, and link to read-only vendor policy pages under `/connect/vendors/:vendorOrgId/policies`. `/connect/clients` is for clients the org reports insurance requirements to and approves access for. Vendor/client monitoring belongs on these Connect surfaces, not on `/compliance`. Legacy `/connected-orgs/*` paths redirect to the shorter `/connect/*` routes.
- MCP/CLI/REST: compliance requirements and vendor compliance are exposed through `list_insurance_requirements`, `create_insurance_requirement`, `list_vendor_compliance`, `GET/POST /api/v1/compliance/requirements`, and `GET /api/v1/compliance/vendors`.
- Agent: web chat and MCP chat include a vendor compliance snapshot in context so users can ask questions such as “are all my vendors compliant?”
- Agent tools: web chat, inbound email, iMessage, and MCP chat expose `lookup_connected_vendors`, `lookup_vendor_policies`, and `lookup_vendor_compliance` so agents can answer vendor-specific compliance questions with the actual vendor roster, vendor policies, and requirement-by-requirement diffs instead of relying only on the generic requirements summary.

## Connected Vendor/Client Accounts

Glass supports one-way connected organization relationships for vendor/client insurance access, modeled after the platform/connected-account idea of a parent org receiving scoped access to a connected org's records. The implementation intentionally keeps this separate from the broker/client hierarchy so broker portal features remain broker-only.

Schema: `connectedOrgRelationships` stores approved/resolvable org-to-org requests with `clientOrgId`, `vendorOrgId`, `status` (`pending` | `active` | `revoked`), audit user IDs, label/note, and timestamps. `connectedOrgInvitations` stores email-backed pending requests and token hashes for vendors who need an approval/signup link. Active relationships grant the client/customer org read-only access to selected vendor insurance system-of-record data. Relationships are one-hop only; a client that can read a vendor does not inherit that vendor's broker, clients, vendors, email, threads, or write capabilities. White labeling continues to be resolved from the viewer's own org/broker context, not from a connected vendor.

Shared access rules live in `convex/lib/access.ts`:

- `member` — direct org member, full org-member capabilities by role.
- `broker_of_client` — broker member viewing a managed client, matching existing broker portal behavior.
- `connected_client` — member of a client/customer org viewing an approved vendor org, read-only for policies/org profile.

Surfaces:

- Web: Connect in the main app menu uses `convex/connectedOrgs.ts` to request vendor access by email, approve email request links, and revoke relationships.
- REST: `GET /api/v1/vendors`, `GET /api/v1/vendors/:id`, and `GET /api/v1/vendors/:id/policies`.
- MCP/CLI: `list_connected_vendors`, `get_connected_vendor`, `list_connected_vendor_policies`.
- Agent: MCP chat receives connected-vendor roster context; exact vendor policy lists should come from the MCP vendor tools.

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

| Source                         | Where                                              | Trigger                                   |
| ------------------------------ | -------------------------------------------------- | ----------------------------------------- |
| `save_note` chat tool          | `convex/actions/processThreadChat.ts` (buildTools) | Agent tool call during chat               |
| Website enrichment             | `convex/actions/extractCompanyInfo.ts`             | Client onboarding step 2 + manual refresh |
| Email agent post-reply summary | `convex/actions/handleInboundEmail.ts`             | After a tool-using email reply resolves   |

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
- Raw source evidence in `sourceSpans` and embedded `sourceChunks` when cl-sdk returns source spans/chunks. These source units preserve stable `sourceSpanIds` for exact policy citations.

### Token Limits

Glass preserves higher extraction token allowances for long-list extractors in `sdkCallbacks.ts`.

- Default token limits come from `cl-sdk`.
- If the prompt matches the exclusions extractor, Glass raises the effective max token count to `8192`.
- If the prompt matches the covered reasons extractor, Glass raises the effective max token count to `24576`.

## Policy Extraction

Two entrypoints, both PDF-only:

- [convex/actions/extractFromUpload.ts](convex/actions/extractFromUpload.ts) — `extractFromUpload` (public action) for direct user uploads; `extractFromUploadInternal` (internal action) for the email agent.
- [convex/actions/extractPolicy.ts](convex/actions/extractPolicy.ts) — internal helpers used by the email agent via the `extract_policy_attachment` tool.
- [convex/actions/reExtractFromFile.ts](convex/actions/reExtractFromFile.ts) / [retryExtraction.ts](convex/actions/retryExtraction.ts) — re-run and retry.

### Flow

1. Fetch or receive a PDF.
2. Store the raw PDF in Convex file storage.
3. Load the PDF bytes from Convex file storage, build local PDF.js source spans, and run `buildExtractor().extract(pdfBytes, documentId, { sourceSpans })`. Do not pass a signed storage URL into `cl-sdk`; review and follow-up extractors can run long enough that repeated URL fetches become unreliable.
4. Map `InsuranceDocument` into Glass policy fields.
5. Persist the extracted document and metadata.
6. Chunk the document and embed each chunk with `text-embedding-3-small`.
7. Store chunks in `documentChunks` for semantic retrieval.

Pipeline runtime state:

- Policy extraction status remains denormalized on `policies.pipelineStatus` / `pipelineError` for fast list filtering.
- High-churn extraction runtime state lives in `policyExtractionRuns`: `pipelineCheckpoint`, `pipelineLog`, leases, heartbeat timestamps, and detailed progress. This avoids rewriting large policy documents for every log, checkpoint, and heartbeat. Large `cl-sdk` checkpoint payloads and extraction-to-embedding payloads are stored in Convex file storage and tracked by `policyExtractionArtifacts` records keyed by policy/job ID and artifact kind. The pipeline checkpoint only keeps compact storage IDs and summaries.
- Query surfaces such as `policies.get` and `policies.getInternal` merge runtime state from `policyExtractionRuns`, falling back to legacy fields on `policies` for old in-flight jobs.
- The extract phase stores `documentChunksForEmbedding`, `sourceSpansForStorage`, and `sourceChunksForEmbedding` in a storage-backed `embedding_payload` artifact before advancing to `embed_and_store`, so a resumed embedding phase can reload transient artifacts without inflating checkpoint documents. Artifact blobs are cleaned up after durable embedding/source-span storage succeeds, cancellation, terminal success, and full restart; generic errors keep artifacts for resume/retry.
- Extraction concurrency defaults to 6 SDK worker calls (`EXTRACTION_CONCURRENCY`, bounded 1-8), and page mapping, focused extraction, and formatting default to that same concurrency unless independently tuned with `EXTRACTION_PAGE_MAP_CONCURRENCY`, `EXTRACTION_EXTRACTOR_CONCURRENCY`, and `EXTRACTION_FORMAT_CONCURRENCY` (each bounded 1-8). Review defaults to `EXTRACTION_REVIEW_MODE=auto` with 1 round (`EXTRACTION_MAX_REVIEW_ROUNDS`, bounded 0-2), so cl-sdk's evidence-gated review semantics decide when a repair pass is useful. Embedding defaults to 8 concurrent embedding calls (`EXTRACTION_EMBEDDING_CONCURRENCY`, bounded 1-16). Current dev/prod deployments intentionally run aggressive speed settings: extraction/page-map/extractor/format concurrency 8 and embedding concurrency 16.

Cancellation:

- `policies.cancelExtraction` marks `pipelineError` as `Cancelled by user`.
- `policyExtraction.ts` checks that flag before phases, before/after each `cl-sdk` model call, and before checkpoint saves. Cancellation stops at the next provider-call boundary and is recorded as an expected pipeline error, not as a transient action failure.
- `policyExtraction:advance` uses a Convex-backed checkpoint lease before running a phase. This prevents overlapping scheduled advances from running the same long extraction phase concurrently and racing to overwrite extracted policy data. The lease is heartbeat-based and watchdog-scheduled, so if an advance action dies during a long provider call, a later advance can reclaim the checkpoint after the heartbeat goes stale instead of leaving the policy stuck in `running`.

## Retrieval And Agent Context

Glass uses two vector-backed stores plus one list-based store:

- `sourceChunks` — raw source-span evidence chunks (vector), preferred for exact policy terms when present
- `documentChunks` — extracted policy/quote content chunks (vector)
- `conversationTurns` — cross-thread conversation memory (vector)
- `orgMemory` — business facts/preferences/risk notes/observations (list, filtered by kind/source)

[agentPrompts.ts](convex/lib/agentPrompts.ts) builds agent context:

- `buildDocumentContext()` — if chunks exist, embed query and search `documentChunks`; otherwise fall back to keyword-scored document summary.
- When `sourceChunks` exist, `buildDocumentContext()` searches them before `documentChunks` and labels the results as source-span evidence with stable `sourceSpanIds`.
- `lookup_policy_section` uses [policyLookup.ts](convex/lib/policyLookup.ts) in web chat, inbound email, and iMessage to return structured policy matches enriched with stable `sourceSpanIds` and short raw evidence excerpts.
- SDK query-agent wrappers use [convexSourceRetriever.ts](convex/lib/convexSourceRetriever.ts) to search `sourceChunks` and return source spans for SDK hybrid retrieval.
- `buildOrgMemoryContext()` — lists recent `orgMemory` entries, grouped by kind.
- `buildConversationMemoryContext()` — vector search over `conversationTurns` for cross-thread memory.

## Policy Change / Endorsement Cases

Glass persists first-class policy-change case state for endorsement workflows:

- `policyChangeCases` stores request text, status, affected policy, evidence source IDs, validation issues, and packet references.
- `pcePackets` stores generated carrier packet artifacts and validation snapshots.
- `caseMessages`, `caseEvidenceLinks`, and `caseValidationReports` preserve missing-info replies, source evidence links, and audit-friendly validation history.
- `convex/policyChanges.ts` exposes safe entrypoints to create requests from chat, email, or uploaded documents, process replies, generate a carrier packet preview, and mark lifecycle status.
- Client-facing policy change views should stay progress-focused: show the request, simple lifecycle status, and cancellation when the case is still open. Broker/operator-only packet generation, submission, acceptance, decline controls, raw packet previews, validation internals, and audit details are hidden from clients.
- The `create_policy_change_request` tool is available in web chat, inbound email, and iMessage. It creates a persistent case and uses SDK PCE analysis when the installed `@claritylabs/cl-sdk` exposes `createPceAgent`; otherwise it falls back to deterministic case creation with source evidence IDs.
- Web chat stores the created `policyChangeCases` ID on the producing `threadMessages` record as a visible policy-change artifact. The thread renders a compact request card under the assistant response and can open the case in the right-side preview panel.
- Clients can review policy-change requests and provide missing information, but carrier packet generation and lifecycle status updates are broker-side actions. Client orgs without a connected broker cannot open full policy-change/PCE requests because there is no broker workflow to submit the change. Broker users can manage a client request through broker-of-client access; connected-client/vendor access remains read-only and cannot manage PCE workflows.

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
  - `email_expert` — delegates outbound drafting/sending to the shared email subagent when the sender is an authenticated internal team member in direct mode
  - `save_note` — writes to `orgMemory`
  - `generate_coi`
  - `extract_policy_attachment` — extracts PDF attachments via `extractFromUploadInternal`
- After a reply is produced, a Haiku summarization pass writes a `source: "email"` observation to `orgMemory`.

### iMessage Agent (Inbound)

Inbound iMessage arrives through the `imessage-worker` Spectrum bridge and `POST /imessage-inbound`. Direct chats and group chats share the same handler in `convex/actions/handleInboundImessage.ts`.

- The worker forwards the Photon chat GUID, group flag, chat title, sender address, and participant roster when available.
- Convex stores group-level state in `imessageChats` and one row per participant in `imessageParticipants`; do not create auth `users` rows for unlinked group participants.
- If no participant in a group has a linked Glass phone number, Glass sends the signup fallback and asks the worker to leave the group.
- If one or more linked participants resolve to the same org, the group runs in single-org mode while preserving anonymous speaker labels for context.
- If linked participants resolve to multiple orgs, the agent may read context from the linked orgs represented in the group, but write actions require an unambiguous org/policy and a linked current sender. Mutating tools should fail closed rather than guessing across orgs.
- Thread routing for iMessage groups uses `threads.imessageChatGuid`; legacy direct-chat routing by `threadPhone` is retained for fallback/proactive sends.

### Glass Agent Email Sending

Outbound emails sent by Glass Agent are centralized in `convex/lib/emailSubagent.ts`.

- Channel agents should delegate draft/send/forward requests to the `email_expert` tool instead of hand-rolling email payloads.
- The email subagent owns recipient caution, formatting, signatures, attachment preparation, Resend payload construction, pending-send scheduling, and sent-email thread records.
- It can attach original policy PDFs from `policies.fileId`, user-uploaded files already present in the conversation, and generated COI PDFs from `generateCoi.run`.
- `generateCoi.run` stores every newly generated COI PDF in Convex file storage and records it in `certificates` with `policyId`, `orgId`, certificate-holder text, source, creator, and storage file ID. The policy detail page's Certificates tab reads this table; direct page generation uses `certificates.generateForPolicy`. Programmatic generation is exposed through REST (`GET/POST /api/v1/policies/:id/certificates`) and MCP/CLI tools (`list_policy_certificates`, `generate_policy_certificate`).
- It requires confirmation instead of sending when the recipient email is inferred or unknown, the body/subject is incomplete, attachments are ambiguous, or `autoSendEmails` is false and the user has not explicitly approved the exact draft.
- Web chat, inbound email, iMessage, and MCP/CLI surfaces all route directed outbound email through shared email-draft primitives rather than hand-rolled send paths. The shared email identity falls back to `agent@${AGENT_DOMAIN}` when no custom agent handle is configured. Web chat and iMessage pass the current user's email/name as the default recipient so "email me" requests resolve without asking for already-known contact details. The `bccRequesterOnAgentEmails` org setting defaults on and blind-copies the requesting team member on directed outbound emails. The email expert supports structured `cc` and `bcc` recipients.
- In web chat, draft emails are persisted as native email-channel thread messages backed by a `pendingEmails` draft. The chat still shows a concise assistant note that an email was drafted, while the full copy lives in the email card/right-side preview. The user can review or quickly send from the draft card, send/cancel from the resizable right-side email preview panel, or use typed chat approval as a fallback that sends the current draft artifact instead of requiring a regenerated draft message. Right-side previews can stack, so an email draft and PDF/policy preview may be open at the same time; when stacked, panels begin at equal widths with the main content and the PDF panel stays furthest right.
- MCP and local CLI expose the same durable draft lifecycle through `list_email_drafts`, `draft_email`, `update_email_draft`, `send_email_draft`, and `cancel_email_draft`. Programmatic tools should update the existing draft artifact in place and send/cancel by draft ID; `ask_glass` remains for Q&A and contextual reasoning.
- Pending emails persist attachment metadata in `pendingEmails.attachments`; the scheduled sender writes those attachments back into the unified thread email message after Resend accepts the send.

### Agent Q&A (Chat)

1. Load org context, policies, and `orgMemory`.
2. Build retrieval-backed document context + orgMemory context + conversation memory.
3. If the user message has attachments (images, PDFs, text), read them from Convex storage and include as AI SDK multipart content parts.
4. Run chat model via `streamText` with tools: `lookup_policy`, `lookup_policy_section`, `compare_coverages`, `email_expert`, `save_note`, `generate_coi`.
5. Persist conversation state.

## UI

- `/policies` — list, detail, upload, re-extract, and generated certificate history.
- `/chat` — threaded assistant.
- `/agent/thread/:id` — renders unified `threads` records. Legacy `webChats`, `webChatMessages`, and `agentConversations` backend tables/functions have been removed after migration to `threads` + `threadMessages`.
- Proactive features that create a chat thread use `threads.createProactiveInternal` so the thread starts with an agent message explaining why Glass created it, what evidence or trigger was found, and what the user should do next. Proactive email drafts attach to that agent message via `pendingEmailId`, so the chat context and email card render together.
- Chat artifact cards such as email drafts should keep meaningful visual presence. Sources and tool calls should stay compact and consistent in the message footer row: inline policy citations are small chips, footer source chips open the right-side preview, and tool call parameters expand only on demand.
- Web chat email artifacts are visually attached to the assistant message that created them, not rendered as a separate standalone chat turn. Sent email artifacts use `View sent email` instead of draft language.
- Automatic chat title generation lives in `convex/actions/threadTitle.ts`. It should use the initial user message plus `threads.initialContext` and attachments, prefer the user's work intent/deliverable, and avoid recipient names, email domains, usernames, or file IDs.
- `/settings` — org settings, branding, members, and an **Integrations** section rendered as a coming-soon grid. The Merge.dev backend and all integration sync tables/actions have been removed; only the static grid remains.

## MCP

Glass exposes MCP functionality for remote and local AI tools.

- Remote MCP is served from Convex HTTP handlers at `/mcp`.
- Local MCP support lives under [mcp-server/](mcp-server/).
- MCP discovery: `GET /.well-known/mcp.json`

### Tools (trimmed in v0.2.0)

- `list_policies`, `get_policy`, `list_policy_certificates`, `generate_policy_certificate`
- `list_quotes`, `get_quote`
- `list_threads`, `get_thread_messages`
- `list_email_drafts`, `draft_email`, `update_email_draft`, `send_email_draft`, `cancel_email_draft`
- `get_org_info`
- `ask_glass`
- `list_clients`, `get_client` (broker)
- `list_broker_activity` (broker)
- `list_my_policies` (client)

Application, passport, business-context, and integration tools are gone. The local MCP server should only register current policy, quote, thread, org, agent, broker/client, certificate, and connected-vendor tools.

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
- `GET /api/v1/policies/:id/certificates` / `POST /api/v1/policies/:id/certificates` (write)
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
