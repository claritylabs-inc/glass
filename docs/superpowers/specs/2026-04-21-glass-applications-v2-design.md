# Glass — Applications v2 Design

**Date:** 2026-04-21
**Status:** Draft — awaiting review
**Subsystem:** Applications v2 (subsystem 4)
**Depends on:** [foundation](./2026-04-21-glass-dual-org-foundation-design.md), [broker shell](./2026-04-21-glass-broker-shell-design.md), [passport](./2026-04-21-glass-client-passport-design.md)

## Context

Prism's current applications are PDF-based — broker sends a PDF, system extracts fillable fields and asks the client for missing info. Glass flips this: applications are **digital-first objects** made of question-groups, with a mix of manual and integration-backed answers. Brokers create applications three ways: from scratch, AI-generated from a prompt, or from a template (seeded with ACORD 126 / 140). In all three paths AI sets grouping and presentation order to minimize client friction.

The existing `applicationSessions` table is PDF-extraction-oriented and does not fit this model. We build a new `applications` system alongside it; the old table is deprecated but not yet removed (existing extraction flow remains for ad-hoc PDF uploads until subsystem 6 decides its fate).

## Decisions

| # | Decision |
|---|---|
| 1 | **Model:** two-level — application → question-groups → questions. Conditional questions and conditional groups. Repeating groups (e.g., per-location, per-vehicle) bound to a passport collection or a per-application list. |
| 2 | **Lifecycle:** per-section submission + multi-round broker review. Overall application status derives from group statuses. |
| 3 | **Answer sources:** hybrid — every question has a semantic `intent` tag plus an optional explicit binding. Bindings win when set; intent drives fallback matching. Sources: `manual`, `passport:fieldPath`, `integration:connectorType:fieldKey`, `document`. |
| 4 | **AI grouping/ordering:** AI owns grouping and ordering; broker does not manually reorder. Optimization target = minimize client friction (group by data source, easiest-first by source). Re-runs whenever the question set changes. |
| 4b | **Mid-flight regrouping:** only unanswered questions are regrouped. Answered questions stay in their original groups/order to preserve client context. New questions are placed into the best existing group (or a new trailing group). |
| 5 | **Creation paths:** (custom) broker adds questions from intent library; (AI) LLM generates question set from prompt; (template) broker picks from `applicationTemplates` seeded with ACORD 126 + 140, clones and customizes. All three paths produce the same object. |
| 6 | **Client UX:** Kanban overview of groups, each group opens as a full-page route, client picks order. |
| 7 | **Broker review:** per-question feedback with `needs_new_answer` re-opening individual questions without unlocking the whole section. Pattern parallels passport field flags. |
| 8 | **Completion artifact:** template-derived apps auto-fill their source PDF. Custom/AI apps are data-only. |
| 9 | **Integration answers:** pre-fill default; client can override with explicit tracking. Original synced value + override flag are preserved so brokers see "client overrode the QuickBooks value from $12M to $11.5M." On next sync, the override stays until the client clicks "use synced value again." |

## Data Model

### `questionIntents` — seed table

Canonical catalog of reusable questions. Seeded from ACORD 126/140 fields and common commercial supplements (cyber, E&O, property, CGL, professional). Loaded on deploy via a seed file.

```ts
{
  intentKey: v.string(),                // "annual_revenue", "number_of_employees", ...
  label: v.string(),                    // broker-facing short label
  defaultPrompt: v.string(),            // client-facing default question text
  answerType: v.union(
    v.literal("text"),
    v.literal("long_text"),
    v.literal("number"),
    v.literal("currency"),
    v.literal("percent"),
    v.literal("date"),
    v.literal("yes_no"),
    v.literal("select"),
    v.literal("multi_select"),
    v.literal("address"),
    v.literal("location_list"),         // repeating group bound to passportLocations
    v.literal("subsidiary_list"),
    v.literal("loss_list"),
    v.literal("file_upload"),
  ),
  selectOptions: v.optional(v.array(v.object({ value: v.string(), label: v.string() }))),
  passportFieldPath: v.optional(v.string()),           // auto-link to passport
  integrationCandidates: v.optional(v.array(v.string())), // "quickbooks:revenue", etc.
  category: v.union(                    // AI grouping hint
    v.literal("applicant_info"),
    v.literal("operations"),
    v.literal("financial"),
    v.literal("risk"),
    v.literal("history"),
    v.literal("coverage_preferences"),
    v.literal("supporting_docs"),
    v.literal("other"),
  ),
  validationHint: v.optional(v.string()),  // short instruction for AI validators / UI hints
}
```

Index: `by_intentKey`.

### `applicationTemplates` — new table

```ts
{
  ownerScope: v.union(
    v.literal("system"),                // seeded: ACORD 126, ACORD 140
    v.literal("broker"),                // broker's own saved template
  ),
  ownerBrokerOrgId: v.optional(v.id("organizations")),  // required when ownerScope=broker
  name: v.string(),
  description: v.optional(v.string()),
  lineOfBusiness: v.optional(v.string()),  // CGL, property, cyber, E&O, etc.
  sourcePdfStorageId: v.optional(v.id("_storage")),  // for system templates backed by ACORD PDFs
  sourcePdfFieldMap: v.optional(v.any()), // maps intentKey → PDF field name for auto-fill
  questionSet: v.array(v.object({
    intentKey: v.optional(v.string()),    // when null, custom free-form question
    promptOverride: v.optional(v.string()),
    required: v.boolean(),
    conditional: v.optional(conditionalExpr),  // see below
  })),
  createdAt: v.number(),
}
```

Indexes: `by_ownerBrokerOrgId`, `by_ownerScope`.

### `applications` — new table

Replaces (does not modify) `applicationSessions` for glass workflows.

```ts
{
  brokerOrgId: v.id("organizations"),
  clientOrgId: v.id("organizations"),
  createdByUserId: v.id("users"),      // broker user
  assignedProducerId: v.optional(v.id("users")),
  sourceTemplateId: v.optional(v.id("applicationTemplates")),
  creationPath: v.union(v.literal("custom"), v.literal("ai"), v.literal("template")),
  title: v.string(),
  lineOfBusiness: v.optional(v.string()),
  aiGenerationPrompt: v.optional(v.string()),  // when creationPath=ai
  status: v.union(
    v.literal("draft"),                // broker editing, not yet sent
    v.literal("sent"),                 // client can answer; none in_progress yet
    v.literal("in_progress"),          // client has started
    v.literal("awaiting_review"),      // all groups submitted; broker to review
    v.literal("complete"),             // all groups accepted
    v.literal("cancelled"),
  ),
  sentAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  filledPdfStorageId: v.optional(v.id("_storage")),  // for template-derived apps on completion
  createdAt: v.number(),
  updatedAt: v.number(),
}
```

Indexes: `by_brokerOrgId`, `by_clientOrgId`, `by_clientOrgId_status`, `by_brokerOrgId_status`.

### `applicationGroups` — new table

```ts
{
  applicationId: v.id("applications"),
  order: v.number(),                   // AI-assigned
  title: v.string(),
  description: v.optional(v.string()),
  conditional: v.optional(conditionalExpr),
  repeating: v.optional(v.object({
    source: v.union(
      v.literal("passport_locations"),
      v.literal("passport_subsidiaries"),
      v.literal("application_list"),   // per-app list defined in the group
    ),
    minItems: v.optional(v.number()),
    maxItems: v.optional(v.number()),
  })),
  status: v.union(
    v.literal("not_started"),
    v.literal("in_progress"),
    v.literal("submitted"),
    v.literal("returned"),             // broker returned with needs_new_answer flags
    v.literal("accepted"),             // broker accepted
  ),
  submittedAt: v.optional(v.number()),
  reviewedAt: v.optional(v.number()),
}
```

Indexes: `by_applicationId`, `by_applicationId_order`.

### `applicationQuestions` — new table

```ts
{
  applicationId: v.id("applications"),
  groupId: v.id("applicationGroups"),
  order: v.number(),                   // AI-assigned within group
  intentKey: v.optional(v.string()),   // null when free-form custom question
  prompt: v.string(),                  // final client-facing prompt
  answerType: v.string(),              // mirror of questionIntents.answerType (stored for custom questions)
  selectOptions: v.optional(v.array(v.object({ value: v.string(), label: v.string() }))),
  required: v.boolean(),
  conditional: v.optional(conditionalExpr),
  binding: v.optional(v.object({       // explicit binding (overrides intent-based fallback)
    source: v.union(
      v.literal("manual"),
      v.literal("passport"),
      v.literal("integration"),
      v.literal("document"),
    ),
    target: v.optional(v.string()),    // passport field path, integration "connector:field", etc.
  })),
  helpText: v.optional(v.string()),
  placedByAi: v.optional(v.boolean()), // true when AI regrouping moved this question here
  createdAt: v.number(),
}
```

Indexes: `by_applicationId`, `by_groupId`, `by_groupId_order`.

### `applicationAnswers` — new table

One row per answer. For repeating groups, the `rowKey` disambiguates instances.

```ts
{
  applicationId: v.id("applications"),
  questionId: v.id("applicationQuestions"),
  rowKey: v.optional(v.string()),      // e.g., passportLocationId or "new_location_1"
  value: v.optional(v.any()),          // shape varies by answerType
  source: v.union(
    v.literal("manual"),
    v.literal("passport"),
    v.literal("integration"),
    v.literal("document"),
  ),
  sourceRef: v.optional(v.string()),   // integration connectionId, docId, intelligenceId
  // Override tracking — set when the client edits an integration-sourced pre-fill.
  // The answer's `value` holds the override; these fields preserve the synced original
  // so brokers can see the delta and the client can revert to live sync.
  overrideOfIntegration: v.optional(v.object({
    connectorKey: v.string(),          // "quickbooks:revenue"
    syncedValue: v.any(),              // the integration-provided value at override time
    syncedAt: v.number(),
    overriddenAt: v.number(),
  })),
  status: v.union(
    v.literal("answered"),
    v.literal("needs_new_answer"),     // broker returned this specific question
  ),
  answeredAt: v.number(),
  answeredByUserId: v.optional(v.id("users")),
}
```

Indexes: `by_applicationId`, `by_questionId`, `by_applicationId_questionId_rowKey`.

### `applicationQuestionFlags` — new table

Broker comments + per-question review state. Parallels `passportFieldFlags`.

```ts
{
  applicationId: v.id("applications"),
  groupId: v.id("applicationGroups"),
  questionId: v.id("applicationQuestions"),
  rowKey: v.optional(v.string()),
  flagType: v.union(
    v.literal("comment"),              // info / clarification
    v.literal("needs_new_answer"),     // re-opens the question
  ),
  authorUserId: v.id("users"),         // broker
  message: v.string(),
  status: v.union(v.literal("open"), v.literal("resolved"), v.literal("dismissed")),
  createdAt: v.number(),
  resolvedAt: v.optional(v.number()),
}
```

Indexes: `by_applicationId`, `by_questionId`, `by_groupId_status`.

### Conditional expression shape

```ts
type ConditionalExpr = {
  all?: ConditionalExpr[];
  any?: ConditionalExpr[];
  not?: ConditionalExpr;
  questionId?: Id<"applicationQuestions">;
  intentKey?: string;                  // alternate lookup — resolved at evaluation time
  operator?: "equals" | "not_equals" | "truthy" | "falsy" | "contains" | "gt" | "lt";
  value?: any;
};
```

Evaluation is pure — given the current answer set, a helper `evaluateConditional(expr, answers) → boolean` decides whether a question/group is visible. UI and backend share this evaluator.

## AI Services

All AI calls route through the existing model registry (`convex/lib/models.ts`); a new role `application_authoring` is added (defaults to `chat_with_tools` model).

### Question generation (creation path = AI)

Input: broker prompt, client passport snapshot, existing intent catalog.
Output: list of `{ intentKey?, customPrompt?, answerType, required, conditional? }` items — constrained to the intent catalog where possible.
Implementation: `actions/applicationAuthoring.ts::generateQuestionSet`.

### Grouping & ordering

Input: question set (with intents / categories / passport + integration availability signals), answered questions snapshot (for mid-flight regrouping).
Output: `{ groups: [{ title, description, questionIds[], order }] }` where only unanswered questions are re-placed; answered questions keep their existing groups/order.
Optimization target (prompt-encoded): minimize client friction — group by data source (passport/integration/document/manual), order groups easiest-first, within a group order dependencies last.
Implementation: `actions/applicationAuthoring.ts::regroupAndOrder`. Runs:
- On application send (first-time grouping).
- After any broker edit to the question set (add/remove question; edit prompt does not trigger regroup).
- When integrations are connected/disconnected on the client (changes easiest-first math).

Regrouping is idempotent: if inputs don't change, the output is stable.

### Template-loading heuristics

Template → application transform resolves each template item into an `applicationQuestions` row. Intent references pull defaults from `questionIntents`. Free-form items are inserted as-is.

## Creation Flows (Broker)

All three flows land in the broker's application editor drawer (entity-preview-panel) open on the client detail page's Applications tab.

### Custom

1. Broker clicks "Create application" → drawer opens.
2. Title + line of business. Empty question list.
3. "Add question" → popover with search over `questionIntents` (labels, categories, LOB tags). Picking one inserts a row with defaults. "Add custom question" inserts a free-form row where the broker types the prompt and picks an answerType.
4. Broker marks required / conditional per question.
5. Broker clicks "Send to client" → `regroupAndOrder` runs → application transitions `draft` → `sent`. Broker can preview the client-facing view but cannot reorder.

### AI-generated

1. Broker clicks "Create with AI" → drawer opens.
2. Broker types prompt ("cyber liability app for a SaaS company, 50 employees, annual revenue ~$12M, needs tech E&O angle").
3. `generateQuestionSet` runs → returns a draft question list.
4. Broker reviews; can add/remove questions (same editor as custom path). No manual reorder.
5. Send → `regroupAndOrder` → `sent`.

### Template

1. Broker clicks "From template" → template picker (system templates + broker's saved templates, filterable by LOB).
2. Broker picks ACORD 126 → question set is cloned into the application.
3. Broker reviews; can add/remove questions.
4. Send → `regroupAndOrder` runs (reoptimizing away from ACORD form order for client friction).
5. On completion (all groups accepted), if `sourceTemplateId.sourcePdfStorageId` is set, an action generates a filled PDF using `sourcePdfFieldMap` to map intentKey → PDF form field and writes it to `applications.filledPdfStorageId`.

### "Save as template" (broker reuse)

After sending any application (or after completion), broker can click "Save as template" → prompts for name, LOB → creates an `applicationTemplates` row with `ownerScope: "broker"`. The question set is captured; answers are not. Subsequent uses of this template clone the question set.

## Client Answering Flow

### Routes

- `/applications` — applications list for the client (Kanban cards, one per application).
- `/applications/[applicationId]` — single-application overview: Kanban of groups, at-a-glance status chips, progress bar.
- `/applications/[applicationId]/groups/[groupId]` — full-page group filler.

### Kanban overview

Columns: `Not started`, `In progress`, `Returned`, `Submitted`, `Accepted`. Cards per group. Click → opens the group's page. Client can enter any group.

### Group page

- Header: group title, description, submit button (sticky).
- Questions rendered in AI-assigned order.
- Each question renders via `QuestionField` — a polymorphic component that dispatches on `answerType`.
- Pre-fill resolution runs client-side on mount:
  - If binding present → fetch from that source.
  - Else if intentKey has `passportFieldPath` → read passport.
  - Else if intentKey has `integrationCandidates` → check connected integrations.
  - Pre-filled answer is shown with a subtle source chip ("From passport", "From QuickBooks"). Client can edit. When an integration-sourced pre-fill is edited, the answer's `source` stays `integration` but `overrideOfIntegration` is populated capturing the synced value and timestamps; the chip switches to "Overridden from QuickBooks · was $12M" with a "use synced value" action that clears the override. On next background sync, the override is preserved until the client explicitly reverts.
- Conditional questions are hidden until their expression is satisfied.
- Repeating groups: if `repeating.source = passport_locations`, one row per `passportLocations` entry plus an optional "add location" control if the group allows per-app additions. Otherwise an "add row" button for application-scoped lists.
- Inline per-question badges for `needs_new_answer` flags (red) and open `comment` flags (blue). Clicking opens the broker's note.
- Submit button validates required fields + conditional visibility, then marks the group `submitted` and clears any prior `returned` state. Returned questions (`needs_new_answer`) are re-answered on this submit.

### Notifications

- Broker returning a group / flagging a question → client sees an in-app notification (subsystem 7) and an email.
- Client submitting a group → broker sees an activity event (subsystem 2's `brokerActivity.application_batch_submitted`) and a notification.

## Broker Review Flow

### Routes

Reuses `/clients/[clientOrgId]/applications` and a new `/clients/[clientOrgId]/applications/[applicationId]` route.

### Review UX

- Same Kanban as the client view, but with broker-side actions on each group card:
  - `Submitted` → click opens review pane.
  - Review pane: every question + answer, per-question action menu (`Comment`, `Needs new answer`, `Clear flag`). Section-level action bar: `Accept section` | `Return section`.
  - `Return section` is allowed only when at least one `needs_new_answer` flag is open; otherwise the action is disabled and "Accept section" is the only path forward. (This prevents empty returns that just frustrate the client.)
- When the last group is `accepted`, application status → `complete`; if template-derived, `generateFilledPdf` action runs and stores the filled PDF.

### Application-level status transitions

Derived from group statuses:

- All groups `not_started` → application status held at `sent`.
- Any group `in_progress` → `in_progress`.
- All groups in `submitted` or `accepted`, with at least one `submitted` → `awaiting_review`.
- All groups `accepted` → `complete`.
- Any group `returned` → application status stays at `in_progress` (client is working on revisions).

A computed `getApplicationStatus(applicationId)` query runs this derivation for UI consumption; the stored status is updated by the mutations that change group states.

## Access Control

All application queries/mutations route through `getOrgAccess` and new capability asserts:

- `assertCanCreateApplication` — broker_of_client only.
- `assertCanEditApplicationDraft` — broker_of_client, application must be `draft`.
- `assertCanSendApplication` — broker_of_client (reuses the existing foundation capability).
- `assertCanAnswerApplication` — member of client org only.
- `assertCanReviewApplication` — broker_of_client only.
- `assertCanCreateBrokerTemplate` — member of broker org.
- `assertCanUseSystemTemplate` — broker of any client.

`applicationTemplates` queries filter by `ownerScope` and `ownerBrokerOrgId` so brokers only see their own + system templates.

## Convex Functions (Summary)

### Queries

- `applications.listForClient(clientOrgId)`
- `applications.listForBroker(brokerOrgId, { clientOrgId?, status? })`
- `applications.get(applicationId)` — returns application + groups + questions + answers + flags (all in one response; broker or client view inferred from access).
- `applicationTemplates.list({ lineOfBusiness? })`
- `questionIntents.search({ query, category?, lineOfBusiness? })`

### Mutations

- `applications.createDraft({ clientOrgId, path, title, ... })`
- `applications.addQuestion`, `applications.removeQuestion`, `applications.updateQuestion`
- `applications.send(applicationId)` — triggers `regroupAndOrder`, flips status.
- `applications.cancel(applicationId)`
- `applicationAnswers.upsert({ questionId, rowKey?, value, source? })`
- `applicationGroups.submit(groupId)`
- `applicationGroups.acceptSection(groupId)` / `returnSection(groupId)`
- `applicationQuestionFlags.create` / `updateStatus`
- `applicationTemplates.create({ ... })` (broker scope)
- `applicationTemplates.fromApplication(applicationId, { name })`

### Actions

- `actions/applicationAuthoring.ts::generateQuestionSet(prompt, clientOrgId)`
- `actions/applicationAuthoring.ts::regroupAndOrder(applicationId)`
- `actions/applicationOutput.ts::generateFilledPdf(applicationId)` — template-derived completion only.

### Helpers

- `convex/lib/applicationConditionals.ts::evaluateConditional(expr, answers)`
- `convex/lib/applicationDerivation.ts::deriveApplicationStatus(groupStatuses)`
- `convex/lib/applicationPrefill.ts::resolvePrefill(question, passport, integrations)`

## Frontend Additions (Summary)

### Broker-side

- `components/applications/create-drawer.tsx` — shared entry for all three paths.
- `components/applications/editor-custom.tsx`, `editor-ai.tsx`, `editor-template.tsx` — path-specific.
- `components/applications/question-intent-picker.tsx`
- `components/applications/template-picker.tsx`
- `components/applications/review-kanban.tsx`
- `components/applications/review-group-pane.tsx`
- `components/applications/save-as-template-dialog.tsx`

### Client-side

- `app/applications/page.tsx` — applications list.
- `app/applications/[applicationId]/page.tsx` — Kanban overview.
- `app/applications/[applicationId]/groups/[groupId]/page.tsx` — group filler.
- `components/applications/client-kanban.tsx`
- `components/applications/group-filler.tsx`
- `components/applications/question-field.tsx` — polymorphic dispatcher.
- `components/applications/question-field-badges.tsx` — flag chips.
- `components/applications/prefill-chip.tsx`

## Relationship to Existing `applicationSessions`

- `applicationSessions` is **not** deleted in this subsystem. PDF-upload-based ad-hoc application filling (prism's current flow) stays for now; it's decoupled from the broker → client workflow.
- Subsystem 6 (policy/quote ingestion rebrand) may deprecate or merge `applicationSessions` with `applications` once the flows converge.
- `brokerActivity` event type `application_sent` / `application_batch_submitted` / `application_completed` apply only to the new `applications` table.

## Seed Data

- `questionIntents` seeded from ACORD 126 + ACORD 140 fields + common supplements. Initial seed target: ~150 intents covering the most common lines of business. Living seed file at `convex/seed/questionIntents.ts`.
- `applicationTemplates` — two system templates on first deploy: ACORD 126 (CGL supplement) and ACORD 140 (property supplement). ACORD PDFs uploaded to storage and wired into `sourcePdfStorageId` + `sourcePdfFieldMap`. Requires the ACORD template PDFs to be added to `docs/acord-templates/` first.

## Testing Strategy (outline)

- Unit: `evaluateConditional` across all operator forms and nested `all`/`any`/`not`.
- Unit: `deriveApplicationStatus` across all group-status combinations.
- Unit: `resolvePrefill` priority order (binding > intent match > none).
- Unit: `regroupAndOrder` preserves answered questions' positions (mid-flight regrouping rule).
- Integration: create template-derived app → client fills → broker accepts → filled PDF generated with correct field mapping.
- Integration: broker flags question as `needs_new_answer` → group returns to `returned` → client re-answers → group re-submits cleanly.
- Access: client attempt to `acceptSection` fails; broker attempt to `upsert` answer fails.

## Out of Scope

- Expression-based computed fields, formulas.
- Generic PDF summary output for custom/AI apps (Q8 option C deferred).
- Submission to carriers directly from Glass.
- Per-application discussion thread (broker ↔ client chat scoped to an application — could reuse `threads` but not in v1).
- Versioning of applications after send (other than mid-flight add/remove).
- Signing / witness / e-signature workflows.
- Approval chains on the client side (e.g., CFO must approve before submit).
- Deprecating `applicationSessions` (subsystem 6).
