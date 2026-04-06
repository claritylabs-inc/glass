# Spot Feature Migration Plan for Prism

## Context

Spot (sms-experiment) has developed several AI features that should be brought to Prism:
1. **Multi-model architecture** with centralized config + runtime fallback
2. **Per-user/org agent memory** — persistent context across conversations
3. **Proactive intelligence** — coverage gap analysis, portfolio health checks, renewal comparison
4. **Agentic tool use** — function calling for actions (email, COI, reminders)
5. **AI-written plaintext emails** instead of fixed templates
6. **COI PDF generation** (ACORD-style) with correct Producer/Insurer mapping
7. **Inbound email reply handling** with AI-driven responses

Reference implementation: `/Users/terrywang/Repos/sms-experiment/convex/`

---

## Current Prism State

**What already exists (don't rebuild):**
- Email integration (Svix webhooks, IMAP scanning, send with delay)
- Chat system (web + email threads, message history, streaming)
- Document context via `buildDocumentContext` from cl-sdk
- Application form filling (sessions, business context auto-fill)
- Cross-thread conversation memory (`agentConversations` table)
- Email draft validation (draft-first or auto-send via `autoSendEmails`)

**What's hardcoded/outdated:**
- Models in `convex/lib/ai.ts` — only `haikuModel` and `sonnetModel`, both Claude 3.5 (old)
- No multi-provider support, no fallback
- No tool use in chat (pure text generation)
- No proactive analysis
- No per-org memory system (conversation memory exists but is thread-scoped)

---

## Migration Plan

### Phase 1: Multi-Model Architecture

**Source files from Spot:**
- `sms-experiment/convex/models.ts` — centralized model config + fallback wrappers

**Changes in Prism:**

1. **Create `convex/lib/models.ts`** — port Spot's `models.ts` with task-based model routing
   - Task types for Prism: `chat`, `chat_with_tools`, `email_draft`, `email_reply`, `extraction`, `classification`, `analysis`, `summary`
   - Default config: DeepSeek V3 for chat/tools, Kimi K2.5 for analysis/email, Claude Haiku for classification, Claude Sonnet for extraction (cl-sdk requires it)
   - `generateTextWithFallback` and `generateObjectWithFallback` wrappers
   - Install: `@ai-sdk/deepseek`, `@ai-sdk/moonshotai`

2. **Update `convex/lib/ai.ts`** — replace hardcoded `haikuModel`/`sonnetModel` with `getModel(task)`
   - Keep `haikuModel`/`sonnetModel` exports for backward compat, but have them call `getModel("chat")` and `getModel("extraction")`

3. **Update all callsites** — replace `haikuModel`/`sonnetModel` with `getModel("task")`
   - `convex/actions/processThreadChat.ts` — `getModel("chat_with_tools")`
   - `convex/actions/handleInboundEmail.ts` — `getModel("email_reply")`
   - `convex/actions/extractPolicy.ts` — `getModel("extraction")` (keep Sonnet for cl-sdk quality)
   - `convex/actions/mcpChat.ts` — `getModel("chat")`

4. **Add env vars:** `DEEPSEEK_API_KEY`, `MOONSHOTAI_API_KEY`

**Estimated effort:** 2-3 hours

---

### Phase 2: Agentic Tool Use in Chat

**Source files from Spot:**
- `sms-experiment/convex/process.ts` — `handleQuestion` with 8 tools + `stopWhen: stepCountIs(5)`

**Changes in Prism:**

1. **Upgrade `processThreadChat.ts`** from `streamText` (text-only) to `generateText` with tools
   - Define tools appropriate for Prism's B2B context:
     - `lookup_policy` — search policies by carrier, number, or type
     - `compare_coverages` — compare two policies side by side
     - `generate_coi` — create COI PDF (port from Spot's `coiGenerator.ts`)
     - `send_email` — draft and send email with policy info
     - `check_application_status` — look up application fill progress
     - `save_note` — save a note/observation about a policy or account
   - Use `COVERAGE_COMPARISON_TOOL` from cl-sdk (already exported)

2. **Port `convex/coiGenerator.ts`** from Spot — ACORD-style COI PDF with correct Producer (broker) / Insurer (security) mapping. Prism has richer data (carrierLegalName, carrierNaicNumber, carrierAmBestRating) to populate the COI.

3. **Update streaming** — tools don't work with `streamText` in the same way. Options:
   - Switch to `generateText` + send complete response (simpler, works with tools)
   - Use `streamText` with `onToolCall` callbacks (more complex, preserves streaming UX)
   - Recommended: `generateText` for tool-use queries, `streamText` for pure Q&A (detect intent first)

**Estimated effort:** 4-6 hours

---

### Phase 3: Per-Org Agent Memory

**Source files from Spot:**
- `sms-experiment/convex/memory.ts` — CRUD + `buildMemoryContext`

**Changes in Prism:**

1. **Add `orgMemory` table to schema** — similar to Spot's `userMemory` but scoped to org:
   ```
   orgMemory: {
     orgId: v.id("orgs"),
     type: v.string(), // "fact" | "preference" | "risk_note" | "observation"
     content: v.string(),
     source: v.string(), // "extraction" | "analysis" | "chat" | "email"
     policyId?: v.id("policies"),
     quoteId?: v.id("quotes"),
     expiresAt?: v.number(),
     createdAt: v.number(),
     updatedAt: v.number(),
   }
   ```

2. **Create `convex/lib/orgMemory.ts`** — port `memory.ts` with org-scoping instead of user-scoping

3. **Wire into `processThreadChat.ts`** — load org memories and include in system prompt via `buildMemoryContext`

4. **Auto-populate from extraction** — after policy extraction, save key facts (carrier, insured, address, policy type, notable exclusions)

5. **Add `save_note` tool** — lets the agent save observations during chat

**Note:** Prism already has `agentConversations` for cross-thread memory. The org memory system adds *structured* persistent knowledge vs raw conversation replay.

**Estimated effort:** 3-4 hours

---

### Phase 4: Proactive Intelligence

**Source files from Spot:**
- `sms-experiment/convex/proactive.ts` — `analyzePolicy`, `analyzePortfolio`, `compareRenewal`
- `sms-experiment/convex/proactiveAlerts.ts` — alert CRUD
- `sms-experiment/convex/proactiveAlertActions.ts` — cron handler

**Changes in Prism:**

1. **Port `analyzePolicy`** — runs after extraction, produces health check stored on policy record
   - Add `analysis: v.optional(v.any())` to policies table
   - Adapt policy-type guidance for commercial lines (GL, WC, property, professional liability, cyber)
   - Store risk notes in org memory

2. **Port `analyzePortfolio`** — cross-policy analysis for an org
   - Prism has multiple policies per org — natural fit
   - Add `portfolioAnalysis` to orgs table
   - Run when new policy extracted for an org with existing policies

3. **Port `compareRenewal`** — detect same policyNumber with different dates
   - Prism already has `priorPolicyNumber` field — use it for renewal detection
   - Output comparison as a thread message or email to the broker

4. **Add commercial lines analysis guidance:**
   - GL: per-occurrence vs aggregate, products/completed ops, defense cost treatment
   - WC: experience mod, employer's liability limits, state-specific requirements
   - Property: coinsurance adequacy, business income limits, equipment breakdown
   - Professional liability: claims-made vs occurrence, retroactive date, extended reporting
   - Cyber: first-party vs third-party, sublimits, social engineering coverage

5. **Cron for scheduled analysis** — add to existing cron infrastructure
   - Policy expiration alerts (already partially exists via cl-sdk)
   - Premium trend analysis across renewals

**Estimated effort:** 6-8 hours

---

### Phase 5: AI-Written Emails

**Source files from Spot:**
- `sms-experiment/convex/emailActions.ts` — `generateEmailBody` action

**Changes in Prism:**

1. **Add `generateEmailBody` action** — AI writes email content from policy data instead of fixed templates
   - Prism already has `agentEmailTemplate.ts` for markdown→HTML conversion — keep that for formatting
   - Replace the fixed template content with AI-generated text
   - Include full rawExtracted data in the prompt for rich, accurate emails

2. **Update email sending flow** — current flow in `processThreadChat.ts` builds email body inline. Separate into:
   - AI generates plaintext body
   - `agentEmailTemplate.ts` wraps it in HTML with Prism branding
   - Send via existing email pipeline

3. **Inbound email reply intelligence** — port Spot's `handleInboundEmail` pattern:
   - When a recipient replies, load policy context + org memory
   - AI decides: answer directly or escalate to broker
   - If answering: include policy data provenance

**Estimated effort:** 3-4 hours

---

### Phase 6: COI PDF Generation

**Source files from Spot:**
- `sms-experiment/convex/coiGenerator.ts` — ACORD-style PDF via pdf-lib

**Changes in Prism:**

1. **Port `coiGenerator.ts`** — Prism has richer data to populate:
   - `carrierLegalName` → Insurer name
   - `carrierNaicNumber` → NAIC code on COI
   - `carrierAmBestRating` → AM Best rating
   - `carrierAdmittedStatus` → Admitted/Non-admitted/Surplus lines
   - `broker`, `brokerAgency`, `brokerContactName` → Producer section
   - `limits` object → detailed limits grid (per occurrence, aggregate, etc.)

2. **Add as a tool** in chat — broker asks "generate a COI for [policy]" and Spot creates it

3. **Consider cl-sdk's `fillAcroForm`** — if we have an actual ACORD 25 PDF template, we can fill the official form fields instead of generating from scratch

**Estimated effort:** 2-3 hours

---

## Implementation Order

| Phase | What | Depends On | Hours |
|-------|------|-----------|-------|
| 1 | Multi-model config | Nothing | 2-3h |
| 2 | Agentic tool use | Phase 1 | 4-6h |
| 3 | Org memory | Phase 1 | 3-4h |
| 4 | Proactive intelligence | Phases 1, 3 | 6-8h |
| 5 | AI-written emails | Phase 1 | 3-4h |
| 6 | COI generation | Phase 2 | 2-3h |
| **Total** | | | **20-28h** |

Phases 2, 3, 5, 6 can be parallelized after Phase 1 is done.

---

## Key Differences: Spot vs Prism

| Aspect | Spot (Consumer) | Prism (B2B) |
|--------|----------------|-------------|
| Users | Individual policyholders | Insurance brokers/agencies |
| Policies | Personal lines (auto, home, renters) | Commercial + personal lines |
| Tone | Casual texting ("hey, your policy looks solid") | Professional ("coverage analysis for [insured]") |
| Channel | iMessage/SMS/email | Web chat + email |
| Memory | Per-user | Per-org |
| Analysis | Consumer-friendly gaps | Broker-grade: limits adequacy, E&O exposure, compliance |
| Email | Plaintext to landlords/lenders | Professional to carriers/underwriters |
| COI | Informational summary | Should match ACORD 25 as closely as possible |

---

## Files to Port (Reference)

| Spot File | Prism Destination | Notes |
|-----------|-------------------|-------|
| `convex/models.ts` | `convex/lib/models.ts` | Adapt task types for Prism |
| `convex/memory.ts` | `convex/lib/orgMemory.ts` | Scope to orgId instead of userId |
| `convex/proactive.ts` | `convex/actions/proactiveAnalysis.ts` | Add commercial lines guidance |
| `convex/proactiveAlerts.ts` | `convex/lib/proactiveAlerts.ts` | Same pattern |
| `convex/coiGenerator.ts` | `convex/lib/coiGenerator.ts` | Enrich with Prism's richer fields |
| `convex/emailActions.ts` (generateEmailBody) | `convex/actions/generateEmailBody.ts` | Integrate with existing email pipeline |
| `convex/sendHelpers.ts` | Not needed | Prism uses web chat, not SMS |
