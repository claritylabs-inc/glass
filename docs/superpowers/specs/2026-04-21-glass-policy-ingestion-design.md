# Glass — Policy / Quote Ingestion Rebrand Design

**Date:** 2026-04-21
**Status:** Draft — awaiting review
**Subsystem:** Policy / quote ingestion rebrand (subsystem 6)
**Depends on:** [foundation](./2026-04-21-glass-dual-org-foundation-design.md), [broker shell](./2026-04-21-glass-broker-shell-design.md), [applications](./2026-04-21-glass-applications-v2-design.md)

## Context

Prism's policy/quote ingestion pipeline (email scan + file upload → `cl-sdk` extraction → `policies` table + `documentChunks` vector index + `orgIntelligence` synthesis) is the most mature subsystem in the existing codebase. This spec rebrands and rewires it for Glass's broker↔client network — without rebuilding the extraction pipeline itself.

Two things change:

1. **Ingestion entry points** — brokers upload policies/quotes on the client detail page, clients continue to upload their own and to scan their own email inbox. Broker email scanning is out of scope for v1.
2. **Old `applicationSessions` retires** — uploading an application-style PDF produces a new digital-first `applications` row (creation path `extracted_pdf`) that runs through the regular applications-v2 flow, rather than the legacy session-based fill-over-email flow.

Nothing about `cl-sdk` calling conventions, `sdkCallbacks.ts`, or the core extraction output (`InsuranceDocument`, chunks, declarations, etc.) changes in this subsystem.

## Decisions

| # | Decision |
|---|---|
| 1 | **Entry points:** broker upload on client detail page; client upload in client Policies tab; client email scan (unchanged from prism). No broker email scanning in v1. |
| 2 | **Quote interactions:** display-only in v1. No accept/decline/compare UI. Brokers and clients message out-of-band. |
| 3 | **`applicationSessions`:** retired. The existing PDF→FormField extraction machinery is refactored to emit `applicationQuestions` and create an `applications` row with `creationPath = "extracted_pdf"`. |
| 4 | **Broker upload delivery:** auto-deliver. Policy/quote becomes visible to the client as soon as it's uploaded; extraction runs in the background with a "processing" state rendered to both sides. |

## Ingestion Flows

### Flow 1 — Broker uploads a policy or quote PDF

- Surface: `/clients/[clientOrgId]/policies` tab on the broker side; header "Upload policy / quote" button.
- Upload form: file picker, document type radio (`policy` | `quote`), optional note.
- Server:
  1. Store PDF in Convex `_storage`.
  2. Insert `policies` row with `orgId = clientOrgId`, `documentType`, `extractionStatus = "pending"`, `uploadedByUserId`, `uploadedBySide = "broker"`, `uploadedByBrokerOrgId`.
  3. Emit `brokerActivity.policy_uploaded` event.
  4. Schedule `actions/extractFromUpload.ts` (existing action) against the new row.
- Client: sees the new policy immediately in their Policies tab with a "Processing" badge. On extraction complete, the badge clears and all extracted fields render; `brokerActivity.policy_extraction_completed` fires; both sides get notifications.

### Flow 2 — Client uploads their own policy

- Surface: `/policies` tab on the client side; header "Upload policy / quote" button.
- Same server handling as Flow 1 except `uploadedBySide = "client"` and no `uploadedByBrokerOrgId`.
- Broker sees the upload on the client detail page's Policies tab, styled to indicate client-provided provenance.

### Flow 3 — Client email scan (unchanged)

- Existing prism pipeline: `scanGmail` / `scanInbox` → triage → extract PDFs → write policies.
- Only change: `policies.orgId = clientOrgId` (already correct; foundation enforces org scoping).
- `brokerActivity.policy_extraction_completed` emits when a scanned policy completes (new event wiring).
- Raw emails remain `client_internal` per foundation spec; brokers do NOT see the scan itself, only the resulting policy.

### Flow 4 — Broker uploads an application-style PDF

- Same upload button on broker side; new document type radio option: `application`.
- On selection, the upload routes to a different pipeline (see next section).

## Application PDF Extraction → `applications`

### New action: `actions/extractApplicationPdf.ts`

Consolidates the existing PDF→FormField logic (currently spread across `processApplication.ts` and related files) into a single action that produces a digital-first application.

Steps:

1. Receive `{ brokerOrgId, clientOrgId, fileId, uploadedByUserId }`.
2. Validate the PDF looks like an application form (reuse existing `cl-sdk` classifier step).
3. Run fillable-field extraction (reuse existing extractor).
4. Map each extracted field to an `applicationQuestions` row:
   - Try to match the field label / PDF form field name against `questionIntents` (label fuzzy match + normalized form field name match). When matched, set `intentKey` and inherit defaults.
   - When no match, create as a free-form question with a synthesized `intentKey: null`, `prompt` from the PDF field label, `answerType` inferred from the PDF field widget (text → `text`, checkbox → `yes_no`, etc.).
5. Create `applications` row with:
   - `creationPath: "extracted_pdf"`
   - `sourceTemplateId: null` (extracted PDF isn't a template unless the broker saves it)
   - `status: "draft"` — broker reviews before sending.
6. Run `regroupAndOrder` once to produce initial groups.
7. Emit `brokerActivity.application_extracted` event.

### Broker review step

Broker opens the draft application in the standard applications editor drawer. They can:

- Add / remove / edit questions (same as other creation paths).
- Review the AI-assigned grouping (no manual reorder per applications spec).
- Click "Send to client" to flip `status → sent`.

The broker can also click "Save as template" after reviewing; the application snapshot is captured into `applicationTemplates` with `sourcePdfStorageId` pointing at the uploaded PDF so future uses can auto-fill the PDF on completion.

### `applicationSessions` removal

- The old table and all code paths it drives (`processApplication.ts`, inbound email application detection in `handleInboundEmail.ts`, application-via-email follow-ups) are deleted as part of this subsystem.
- Email-driven applications (client receives an application request by email, replies with answers) are NOT reimplemented here — Glass's model is in-app. If brokers or clients want to email an answer, they still can via the existing agent conversation flow, but it doesn't feed the applications system automatically.
- The `/applications` upload entry point that currently creates an `applicationSessions` row is replaced by the broker-side upload under Flow 4. Client-side application uploads are not supported (clients answer applications, they don't typically upload blank forms).

### FormField extraction logic — where it lives after refactor

- Existing helpers in `convex/lib/applicationTypes.ts` (`FormField`, `QuestionBatch`, etc.) are pruned to just what the new flow needs.
- `convex/lib/applicationPrompts.ts` — application filling prompts are removed; regroup/ordering prompts live in applications-v2's `applicationAuthoring.ts`.
- PDF → FormField extraction remains in a single module (`convex/lib/applicationPdfExtraction.ts`), called by the new action.

## Access & Visibility

Existing prism queries on `policies` already filter by `orgId`. Under glass:

- Client members: full read/write on their own org's policies.
- Broker (`accessType = "broker_of_client"`): read + upload (new — existing code allows only members to upload; loosen to permit broker uploads).
- Same for `documentChunks`, `policyFiles`, `policyAuditLog`.

Capability helpers in `access.ts`:

- `assertCanUploadPolicy(access)` — member OR broker_of_client (defined in foundation; this subsystem is the first consumer).
- `assertCanDeletePolicy(access)` — member only for client-uploaded; broker_of_client allowed only for policies their broker uploaded (`uploadedBySide = "broker"` and `uploadedByBrokerOrgId` matches).
- `assertCanReadPolicy(access)` — already defined as `assertCanReadPolicies` in foundation.

### `policies` table additions

```ts
uploadedBySide: v.optional(v.union(
  v.literal("broker"),
  v.literal("client"),
  v.literal("email_scan"),
)),
uploadedByUserId: v.optional(v.id("users")),
uploadedByBrokerOrgId: v.optional(v.id("organizations")),
```

No other schema changes.

## Quote Handling

- Quotes continue to be `policies` rows with `documentType = "quote"`.
- Client's Policies tab splits into **Policies** and **Quotes** sub-tabs (client side).
- Broker's client-detail Policies tab does the same split.
- Display only — no accept/decline/compare UI. Extracted data renders; the existing policy preview drawer is reused (it already handles both types).
- When a broker uploads a quote, the activity event is `quote_uploaded` (new event type added to `brokerActivity`).

## Rebrand Touch Points in This Subsystem

Parts of the current ingestion pipeline carry Prism branding that will be rebranded as part of the cross-cutting rebrand spec, but two places are worth calling out here because they affect behavior, not just copy:

- The `orgIntelligence` synthesis step after policy extraction adds `sourceLabel` values like "Prism analysis"; these become "Glass analysis" — stored under broker-scoped prompts where applicable.
- Email templates used for acknowledging client uploads (e.g., "we received your policy") move to broker-branded templates keyed on `clientOrg.brokerOrgId.brandingColor`, `agentDisplayName`, `logoStorageId`.

Both are covered in detail by the cross-cutting rebrand spec; flagging them here so the work isn't missed during this subsystem's refactor.

## Event Emission (additions for broker activity)

New / adjusted event types in `brokerActivity`:

- `policy_uploaded` — broker or client upload. Payload: `{ policyId, documentType, uploadedBySide }`.
- `policy_extraction_completed` — wired from existing extraction action on completion.
- `quote_uploaded` — broker or client upload of a `documentType="quote"` doc.
- `quote_extraction_completed` — same wiring as policy.
- `application_extracted` — new, for the extracted-PDF application path.

All emissions go through `recordBrokerActivity` (defined in broker-shell spec).

## Convex Functions (Summary)

### Mutations

- `policies.createBrokerUpload({ clientOrgId, fileId, documentType, note? })` — broker-authed.
- `policies.createClientUpload({ orgId, fileId, documentType })` — client-authed (existing, kept).
- `policies.delete({ policyId })` — capability-gated.

### Actions

- `actions/extractFromUpload.ts` — existing, unchanged other than routing to the new upload mutation inputs.
- `actions/extractApplicationPdf.ts` — new, replaces `processApplication.ts`.
- Existing `actions/extractPolicy.ts`, `actions/extractFromDocument.ts`, etc. — unchanged.

### Queries

- `policies.listForClient` / `policies.listForBroker` — existing, keep. Already split by documentType.

## Frontend Additions

### New / changed routes

- `/clients/[clientOrgId]/policies` — already placeholdered in broker-shell spec; this subsystem fills in:
  - Policies / Quotes sub-tabs.
  - Upload button + drawer (entity-preview-panel).
  - List + clickable rows that open the existing policy preview drawer.
- `/policies` — client side, unchanged except for the Policies/Quotes sub-tab split.
- `/applications` upload entry point on the broker side (new path for application PDF uploads) — produces a draft `applications` row, opens editor drawer.

### Removed

- Any UI that referenced `applicationSessions` (inbound email application views, session status pages). Replaced by `/applications/[applicationId]` routes defined in applications-v2 spec.

## Migration / Cleanup Steps

1. Add `uploadedBySide`, `uploadedByUserId`, `uploadedByBrokerOrgId` fields to `policies`.
2. Write the new broker upload mutation + wire the upload drawer.
3. Implement `extractApplicationPdf` action and applications editor integration for the `extracted_pdf` path.
4. Wire new activity events.
5. Remove `applicationSessions` table, related queries/mutations/actions, and UI.
6. Remove legacy application-filling prompts / helpers from `convex/lib/` (`applicationPrompts.ts`, unused bits of `applicationTypes.ts`).

All steps are additive until step 5; the removal is the risk point. Since foundation spec decided on clean-slate (no data to migrate), removal is a code delete, not a data migration.

## Testing Strategy (outline)

- Integration: broker uploads policy PDF → client sees "processing" → extraction completes → both sides see extracted fields → `policy_extraction_completed` activity emits.
- Integration: broker uploads application PDF → draft `applications` row created → broker reviews → sends → client sees in Kanban.
- Integration: client email-scan path unchanged, still produces a `policies` row with `uploadedBySide = "email_scan"`.
- Access: client attempt to delete a broker-uploaded policy rejected; broker attempt to delete a client-uploaded policy rejected.
- Extraction mapping: PDF form field labels like "Annual Revenue" resolve to `questionIntents` with `intentKey: "annual_revenue"`; novel labels produce free-form questions.

## Out of Scope

- Accept / decline / compare for quotes (deferred; revisit when flow demands it).
- E-bind or other downstream quote-to-policy conversion.
- Broker email scanning.
- Re-implementation of application-by-email (inbound email → automatic fill) — not a Glass pattern.
- Automatic template creation from extracted PDFs (broker can explicitly "Save as template" if desired).
- Bulk broker upload of a client's entire prior book in one operation.
- Specific branding string replacements ("Prism" → "Glass") — handled in the rebrand subsystem.
