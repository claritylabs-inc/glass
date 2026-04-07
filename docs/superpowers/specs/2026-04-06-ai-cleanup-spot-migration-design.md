# AI Cleanup + Spot Feature Migration — Design Spec

## Context

Prism's AI layer has accumulated significant technical debt: blank streaming responses in web chat, stuck application processing, 4x duplicated utility code, inconsistent error handling, and hardcoded model selection. Simultaneously, Spot (sms-experiment) has proven features — multi-model architecture, agentic tool use, per-org memory, proactive intelligence, AI-written emails, and COI generation — ready for migration.

This spec combines both efforts into a single interleaved plan where each phase ships both cleanup and new capabilities.

---

## Phase 0: Emergency Streaming Fix

**Goal:** Fix blank responses in web chat and stuck application sessions.

### Web Chat Blank Responses

**Root causes to investigate and fix:**

1. **Auth token race condition** — `useChat` fires `/api/chat` before Convex auth token is ready. The 401 response is swallowed silently by `useChat`, leaving the user staring at a spinner.
   - **Fix:** Guard `useChat.sendMessage()` on auth token readiness. Add `onError` callback to `useChat` config that surfaces errors in the chat UI.

2. **Unhandled `streamText` exceptions** — If the model call throws (rate limit, oversized prompt, network timeout), `/api/chat/route.ts` catches at the top level but may not return a response the client can parse.
   - **Fix:** Wrap `streamText()` in try/catch that returns a structured JSON error response with status 500. Ensure `useChat` `onError` displays it.

3. **`onFinish` persist failure** — If saving the completed response to Convex fails, the streaming overlay message disappears when the subscription updates (because the persisted message never arrives).
   - **Fix:** Add retry (1 attempt) in `onFinish`. If persist still fails, keep the streaming message visible and show an inline error "Response generated but failed to save."

### Application Stuck States

1. **Timeout detection** — Add a check: if `applicationSession.status` hasn't changed in 5 minutes and status is `extracting_fields` or `filling_known`, mark as `failed` with `failureReason`.
   - Implement as a Convex cron or a check on session load.

2. **JSON extraction validation** — After `salvageTruncatedJsonArray`, validate output shape with a lightweight check (array of objects with required keys). If invalid, mark extraction as failed with retry option instead of proceeding with bad data.

3. **Explicit error status** — Add `failed` to `applicationSessions.status` union. Add `failureReason: v.optional(v.string())` field.

### Files touched:
- `app/api/chat/route.ts` — error handling, structured error responses
- `app/agent/thread/[id]/page.tsx` — `onError` callback, auth guard
- `convex/actions/processApplication.ts` — timeout detection, JSON validation
- `convex/schema.ts` — application session `failed` status + `failureReason`
- `convex/applicationSessions.ts` — failure mutations

---

## Phase 1: AI Foundation

**Goal:** Replace hardcoded models with task-based routing, consolidate 4 duplicated utility patterns, fix error handling.

### 1a. Multi-Model Architecture

**New file: `convex/lib/models.ts`**

Port from Spot's `sms-experiment/convex/models.ts` with Prism-specific task types:

```typescript
type TaskType = 
  | "chat"              // Web chat Q&A
  | "chat_with_tools"   // Agentic chat with function calling  
  | "email_draft"       // AI-generated email body
  | "email_reply"       // Inbound email agent response
  | "extraction"        // PDF policy/quote extraction (Sonnet required by cl-sdk)
  | "classification"    // Email classification, intent detection
  | "analysis"          // Policy/portfolio analysis
  | "summary"           // Summarization tasks

function getModel(task: TaskType): LanguageModel
function generateTextWithFallback(task: TaskType, params: GenerateTextParams): Promise<GenerateTextResult>
function generateObjectWithFallback(task: TaskType, params: GenerateObjectParams): Promise<GenerateObjectResult>
```

**Default model routing:**

| Task | Primary | Fallback |
|------|---------|----------|
| chat | DeepSeek V3 | Claude Haiku |
| chat_with_tools | DeepSeek V3 | Claude Haiku |
| email_draft | Kimi K2.5 | Claude Haiku |
| email_reply | Kimi K2.5 | Claude Haiku |
| extraction | Claude Sonnet | — (cl-sdk requires it) |
| classification | Claude Haiku | DeepSeek V3 |
| analysis | Kimi K2.5 | Claude Haiku |
| summary | DeepSeek V3 | Claude Haiku |

**New env vars:** `DEEPSEEK_API_KEY`, `MOONSHOTAI_API_KEY`
**New packages:** `@ai-sdk/deepseek`, `@ai-sdk/moonshotai`

**Update `convex/lib/ai.ts`:** Keep `haikuModel`/`sonnetModel` exports for backward compat during migration, but have them delegate to `getModel("classification")` and `getModel("extraction")`.

### 1b. Centralized AI Utilities

**New file: `convex/lib/aiUtils.ts`**

Consolidates code currently duplicated across `processThreadChat.ts`, `handleInboundEmail.ts`, `processApplication.ts`, and `app/api/chat/route.ts`:

```typescript
// Markdown processing (currently 3 separate implementations)
function stripMarkdown(text: string): string
function markdownToHtml(markdown: string): string

// Email signatures (currently 3 variants)
function buildSignature(org: OrgDoc): string

// Message history formatting (currently 4 implementations)
function buildMessageHistory(messages: MessageDoc[]): CoreMessage[]

// System prompt wrapper (eliminates `as any` casts)
function buildSystemPromptForContext(params: {
  org: OrgDoc;
  mode: "web" | "email" | "mcp";
  pageContext?: string;
  additionalInstructions?: string;
}): string

// Structured error logging
function logAiError(action: string, error: unknown, context: Record<string, unknown>): void
```

### 1c. Security fixes in this phase
- **API key redaction:** Sanitize `AUTH_RESEND_KEY` and other secrets from error log output
- **Prompt sanitization:** `buildSystemPromptForContext` escapes user-controlled fields (`org.context`, `org.name`) to prevent prompt injection. Use a delimiter/fence pattern so the model treats them as data, not instructions.

### 1d. Migration of callsites

Replace all direct model references:
- `processThreadChat.ts`: `haikuModel` → `getModel("chat")` / `getModel("email_reply")`
- `handleInboundEmail.ts`: `haikuModel` → `getModel("classification")` / `getModel("email_reply")`
- `processApplication.ts`: `haikuModel` → `getModel("classification")` / `getModel("chat")`
- `mcpChat.ts`: `haikuModel` → `getModel("chat")`
- `app/api/chat/route.ts`: `haikuModel` → `getModel("chat")`

Replace all duplicated utilities with imports from `aiUtils.ts`.

### Files touched:
- `convex/lib/models.ts` — new
- `convex/lib/aiUtils.ts` — new
- `convex/lib/ai.ts` — update to delegate
- `convex/actions/processThreadChat.ts` — replace imports
- `convex/actions/handleInboundEmail.ts` — replace imports
- `convex/actions/processApplication.ts` — replace imports
- `convex/actions/mcpChat.ts` — replace imports
- `app/api/chat/route.ts` — replace imports
- `package.json` — add `@ai-sdk/deepseek`, `@ai-sdk/moonshotai`

---

## Phase 2: Chat Architecture

**Goal:** Add agentic tool use, unify streaming patterns, fix application processing reliability.

### 2a. Agentic Tool Use

**Update `processThreadChat.ts` and `app/api/chat/route.ts`:**

Add intent detection before response generation:
1. Classify user message: pure Q&A vs action request (lightweight — keyword matching + model classification if ambiguous)
2. Route:
   - **Q&A** → `streamText()` with `getModel("chat")` (preserves streaming UX)
   - **Action** → `generateText()` with `getModel("chat_with_tools")` + tools + `maxSteps: 5`

**6 tools:**

| Tool | Description | Implementation |
|------|-------------|----------------|
| `lookup_policy` | Search policies by carrier, number, type, date range | Internal query on policies table |
| `compare_coverages` | Side-by-side comparison of two policies | Uses `COVERAGE_COMPARISON_TOOL` from cl-sdk |
| `send_email` | Draft/send email with policy context | Existing email pipeline, respects `autoSendEmails` |
| `check_application_status` | Look up application session progress | Internal query on applicationSessions |
| `save_note` | Save observation to org memory | Writes to `orgMemory` table (Phase 3) |
| `generate_coi` | Create COI PDF for a policy | Calls COI generator (Phase 4) |

Tools that depend on later phases (`save_note`, `generate_coi`) are defined in Phase 2 but return "not yet available" until their backing implementation ships.

### 2b. Unified Streaming

Three patterns, each appropriate for its context:

| Endpoint | Pattern | Why |
|----------|---------|-----|
| `/api/chat` (web) | `streamText()` → `toUIMessageStreamResponse()` | Direct browser streaming via useChat |
| `processThreadChat` (email-triggered) | `streamText()` with proper stream consumption | Align with web pattern, remove manual 150ms flush hack |
| `mcpChat` | `generateText()` | No UI to stream to — correct as-is |

**Key change in `processThreadChat.ts`:** Replace the manual chunk-loop + 150ms debounce with the AI SDK's built-in `onChunk`/`onFinish` callbacks. Use `streamText` result's `.text` promise for the final content instead of accumulating chunks manually.

### 2c. Application Processing Reliability

1. **Retry wrapper** — Each AI call in `processApplication.ts` gets 1 retry with 2s backoff on failure
2. **Zod validation** — Add schemas for extracted field shapes. Validate after JSON parse instead of trusting raw output.
3. **Relative date fix** — Move date resolution from parse time to fill time. Store raw relative references, resolve when generating the batch email or filling the PDF.
4. **Progress tracking** — Add `lastProgressAt: v.number()` to application sessions. Update on every state transition. Cron checks for stale sessions (>5 min no progress).

### Files touched:
- `convex/actions/processThreadChat.ts` — tool use, streaming overhaul
- `app/api/chat/route.ts` — tool use, intent detection
- `convex/actions/processApplication.ts` — retry logic, zod validation, date fix
- `convex/lib/chatTools.ts` — new, tool definitions
- `convex/schema.ts` — `lastProgressAt` on application sessions
- `convex/applicationSessions.ts` — progress tracking mutations

---

## Phase 3: Memory + Intelligence

**Goal:** Persistent org-scoped knowledge and proactive analysis.

### 3a. Org Memory

**Schema addition — `orgMemory` table:**
```
orgMemory: defineTable({
  orgId: v.id("organizations"),
  type: v.union(v.literal("fact"), v.literal("preference"), v.literal("risk_note"), v.literal("observation")),
  content: v.string(),
  source: v.union(v.literal("extraction"), v.literal("analysis"), v.literal("chat"), v.literal("email")),
  policyId: v.optional(v.id("policies")),
  quoteId: v.optional(v.id("policies")),  // quotes share policies table
  expiresAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_org", ["orgId"])
  .index("by_org_type", ["orgId", "type"])
```

**New file: `convex/orgMemory.ts`** — CRUD: list by org, list by type, upsert by content hash, bulk insert, delete expired.

**New file: `convex/lib/orgMemoryContext.ts`** — `buildMemoryContext(memories: OrgMemory[]): string` — formats memories into a system prompt section grouped by type.

**Integration points:**
- `processThreadChat.ts` — load org memories, include in system prompt
- `app/api/chat/route.ts` — same
- `handleInboundEmail.ts` — same
- `save_note` tool (Phase 2) — writes to this table

### 3b. Auto-Populate from Extraction

After `extractPolicy` completes successfully:
- Save key facts to `orgMemory`: carrier name, insured name/address, policy type, notable limits, exclusions, endorsements
- Source: `"extraction"`, linked to `policyId`
- Skip if duplicate fact already exists (content hash dedup)

### 3c. Proactive Analysis

**New file: `convex/actions/proactiveAnalysis.ts`**

Three analysis actions, all using `getModel("analysis")`:

1. **`analyzePolicy`** — Runs after extraction. Produces structured health check:
   - Coverage adequacy assessment
   - Notable exclusions/gaps
   - Limit recommendations by policy type
   - Commercial lines guidance: GL (per-occurrence vs aggregate, products/completed ops), WC (experience mod, employer's liability), Property (coinsurance, business income), Professional liability (claims-made vs occurrence, retro date), Cyber (first vs third party, sublimits)
   - Stored as `policies.analysis` (new field)

2. **`analyzePortfolio`** — Runs when new policy extracted for org with 2+ policies:
   - Cross-policy gap identification
   - Overlapping coverage detection
   - Total insured value assessment
   - Stored as `organizations.portfolioAnalysis` (new field)

3. **`compareRenewal`** — Triggered when policy with matching `priorPolicyNumber` detected:
   - Premium change analysis
   - Coverage modifications
   - Limit/deductible changes
   - Output as thread message to broker

**Schema additions:**
- `policies.analysis: v.optional(v.any())` — structured health check
- `organizations.portfolioAnalysis: v.optional(v.any())` — cross-policy analysis

**Scheduling:** Analysis actions triggered via `ctx.scheduler.runAfter(0, ...)` after successful extraction. No cron needed for initial implementation.

### Files touched:
- `convex/schema.ts` — `orgMemory` table, `policies.analysis`, `organizations.portfolioAnalysis`
- `convex/orgMemory.ts` — new, CRUD
- `convex/lib/orgMemoryContext.ts` — new, context builder
- `convex/actions/proactiveAnalysis.ts` — new, 3 analysis actions
- `convex/actions/extractPolicy.ts` — trigger analysis + memory population after extraction
- `convex/actions/processThreadChat.ts` — load memory into prompt
- `app/api/chat/route.ts` — load memory into prompt
- `convex/actions/handleInboundEmail.ts` — load memory into prompt

---

## Phase 4: Email + COI

**Goal:** AI-generated email content and ACORD-style COI PDFs.

### 4a. AI-Written Emails

**New file: `convex/actions/generateEmailBody.ts`**

```typescript
export const generateEmailBody = internalAction({
  args: { 
    orgId: v.id("organizations"),
    intent: v.string(),       // what the email should accomplish
    policyContext: v.optional(v.any()),
    recipientContext: v.optional(v.string()),
    tone: v.optional(v.string()),  // defaults to "professional"
  },
  handler: async (ctx, args) => {
    // Uses getModel("email_draft")
    // Loads org memory for personalization
    // Returns { subject: string, body: string }
  }
})
```

**Integration:** Replace inline body construction in `processThreadChat.ts` email sending flow. The existing `agentEmailTemplate.ts` continues to handle HTML wrapping/branding.

### 4b. COI PDF Generation

**New file: `convex/lib/coiGenerator.ts`**

Ported from Spot's `coiGenerator.ts`, enriched with Prism's data:

| ACORD Field | Prism Source |
|-------------|-------------|
| Producer | `broker`, `brokerAgency`, `brokerContactName`, `brokerLicenseNumber` |
| Insurer Name | `carrierLegalName` or `security` |
| NAIC # | `carrierNaicNumber` |
| AM Best Rating | `carrierAmBestRating` |
| Admitted Status | `carrierAdmittedStatus` |
| Limits | `limits` (LimitSchedule) |
| Insured | `insuredName`, `insuredDba`, `insuredAddress`, `insuredFein` |

Two modes:
1. **AcroForm** — If ACORD 25 PDF template is available, use cl-sdk's `fillAcroForm` to fill the official form fields
2. **Generated** — Build PDF with pdfkit matching ACORD 25 layout (Producer section, Insurer table, Coverage grid, etc.)

Exposed via the `generate_coi` tool defined in Phase 2.

### Files touched:
- `convex/actions/generateEmailBody.ts` — new
- `convex/lib/coiGenerator.ts` — new
- `convex/actions/processThreadChat.ts` — use `generateEmailBody` for email content

---

## Security Fixes Summary

| Fix | Phase | Description |
|-----|-------|-------------|
| Auth token guard | 0 | Guard useChat on token readiness |
| Error response structure | 0 | Never expose stack traces to client |
| API key redaction | 1 | Sanitize secrets from error logs |
| Prompt injection defense | 1 | Fence user-controlled data in system prompts |
| Thread access validation | 2 | Verify org membership before thread operations |
| Email recipient validation | 2 | Validate syntax + optionally MX before sending |
| Memory access scoping | 3 | orgMemory queries enforce org membership |
| PDF content sanitization | 2 | Fence PDF text content before passing to model |

---

## Implementation Order

```
Phase 0  ──────►  Phase 1  ──────►  Phase 2  ──────►  Phase 3  ──────►  Phase 4
(1 day)           (2 days)          (3 days)          (2 days)          (2 days)
                                        │
                                   Phase 3 and 4 can 
                                   run in parallel after 
                                   Phase 2 ships
```

Total: ~10 working days for the full combined effort.

---

## Out of Scope

- Distributed tracing / OpenTelemetry (worthwhile but separate initiative)
- Token/cost tracking dashboard (add after multi-model is stable)
- Streaming cancellation for Convex actions (Convex platform limitation)
- Rate limiting on inbound email webhook (infrastructure concern, not AI layer)
- Thread email enumeration hardening (security review, separate scope)
