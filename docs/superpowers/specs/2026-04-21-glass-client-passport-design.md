# Glass — Client Onboarding + ACORD 125 Passport Design

**Date:** 2026-04-21
**Status:** Draft — awaiting review
**Subsystem:** Client onboarding + ACORD 125 passport (subsystem 3)
**Depends on:** [foundation](./2026-04-21-glass-dual-org-foundation-design.md), [broker shell](./2026-04-21-glass-broker-shell-design.md)

## Context

The "client passport" is the reusable, persistent record of a client's ACORD 125 Commercial Insurance Application Common Policy data. Every future insurance application the broker sends reads from this record. The onboarding wizard is the first-time UI for filling it out.

This subsystem covers:
- The passport data model (structured + side tables + intelligence fan-out).
- The onboarding wizard flow.
- Broker-side requirement configuration.
- Auto-fill sources and provenance.
- Broker-side passport viewer + field flags.

Note: actual ACORD 125 template PDFs aren't in the repo yet at `docs/acord-templates/`. This spec works from the public ACORD 125 structure; field lists will be cross-checked against the template when it's added.

## Decisions

| # | Decision |
|---|---|
| 1 | **Wizard vs passport:** Wizard is a thin first-run UI over the persistent passport record. Post-onboarding the client edits the same record from the Passport tab. |
| 2 | **Storage:** Hybrid — structured `clientPassport` table + side tables (`passportLocations`, `passportSubsidiaries`, `passportPriorCarriers`, `passportLosses`, `passportAdditionalInterests`) + fan-out into `orgIntelligence` for retrieval. |
| 3 | **Field scope:** All 8 ACORD 125 groups. Core 4 (applicant info, nature of business, premises/locations, general info) always required. Last 4 (prior carrier, loss history, additional interests, transaction info / desired coverage profile) broker-controlled via a requirement toggle; default off. |
| 4 | **Requirement config:** Broker-org default + per-client override. |
| 5 | **Auto-fill:** Manual + invite-sourced → confirmed. Website enrichment + document extraction → suggested. Every field carries provenance. Designed to extend to integration sources without a schema change. |
| 6 | **Wizard flow:** Hybrid — core 4 linear (fields build on each other), extended sections as a picker grid after. Gating: core 4 hard-gated (E1); broker-required extras nudged via persistent banner (E2). |
| 7 | **Broker passport view:** Read + annotate. Broker leaves flags/comments on fields; client sees them as badges on their Passport tab. |

## Passport Data Model

### `clientPassport` — new table (one row per client org)

Flat record for well-known ACORD 125 fields. Nested collections go into side tables.

```ts
{
  clientOrgId: v.id("organizations"),

  // Applicant info
  legalName: v.optional(v.string()),
  dba: v.optional(v.string()),
  entityType: v.optional(v.string()),  // corporation, llc, partnership, sole_proprietor, etc.
  fein: v.optional(v.string()),
  website: v.optional(v.string()),
  primaryContactName: v.optional(v.string()),
  primaryContactTitle: v.optional(v.string()),
  primaryContactEmail: v.optional(v.string()),
  primaryContactPhone: v.optional(v.string()),
  mailingAddress: v.optional(addressObject),

  // Nature of business
  businessDescription: v.optional(v.string()),
  naicsCode: v.optional(v.string()),
  sicCode: v.optional(v.string()),
  yearsInBusiness: v.optional(v.number()),
  yearEstablished: v.optional(v.number()),
  numberOfEmployees: v.optional(v.number()),
  annualRevenue: v.optional(v.string()),
  operationsSummary: v.optional(v.string()),

  // General info (booleans + short text)
  hasPriorBankruptcy: v.optional(v.boolean()),
  bankruptcyDetails: v.optional(v.string()),
  hasPriorCancellation: v.optional(v.boolean()),
  cancellationDetails: v.optional(v.string()),
  hasForeignOperations: v.optional(v.boolean()),
  foreignOperationsDetails: v.optional(v.string()),
  ownershipNotes: v.optional(v.string()),

  // Transaction / desired coverage profile (passport-level; per-application specifics live on applications)
  desiredEffectiveDate: v.optional(v.string()),
  desiredPolicyTerm: v.optional(v.string()),
  desiredLinesOfBusiness: v.optional(v.array(v.string())),

  // Completion tracking
  coreCompletedAt: v.optional(v.number()),
  lastEditedAt: v.number(),
  lastEditedBy: v.optional(v.id("users")),
}
```

Index: `by_clientOrgId`.

### `passportFieldProvenance` — new table

One row per field (or field path) that carries non-default provenance. Sparse; absence means "blank."

```ts
{
  clientOrgId: v.id("organizations"),
  fieldPath: v.string(),           // "legalName", "locations.0.address.state", etc.
  source: v.union(
    v.literal("manual"),
    v.literal("invite"),
    v.literal("website"),
    v.literal("document"),
    v.literal("integration"),      // reserved; used by subsystem 5
    v.literal("broker"),
  ),
  confidence: v.union(v.literal("confirmed"), v.literal("suggested")),
  sourceRef: v.optional(v.string()),    // docId / intelligenceId / integration connectionId
  sourceLabel: v.optional(v.string()),
  suggestedValue: v.optional(v.any()),   // set when confidence=suggested and user hasn't accepted
  setAt: v.number(),
  setByUserId: v.optional(v.id("users")),
}
```

Index: `by_clientOrgId_fieldPath`, `by_clientOrgId`.

**Semantics:** when a field has a `suggested` row, the passport UI shows both the current stored value (if any) and the suggested one, with one-click accept. Accepting promotes the suggestion to the field value and updates provenance to `confirmed`. The passport `value` itself lives on `clientPassport` (or the relevant side table row); provenance is metadata.

### `passportLocations` — new side table

```ts
{
  clientOrgId: v.id("organizations"),
  number: v.number(),              // 1-indexed display order
  address: addressObject,
  description: v.optional(v.string()),
  occupancy: v.optional(v.string()),
  squareFootage: v.optional(v.number()),
  yearBuilt: v.optional(v.number()),
  constructionType: v.optional(v.string()),
  protectionClass: v.optional(v.string()),
  sprinklered: v.optional(v.boolean()),
  alarmType: v.optional(v.string()),
  buildingValue: v.optional(v.string()),
  contentsValue: v.optional(v.string()),
  businessIncomeValue: v.optional(v.string()),
}
```

Index: `by_clientOrgId`.

### `passportSubsidiaries`, `passportPriorCarriers`, `passportLosses`, `passportAdditionalInterests` — side tables

- **`passportSubsidiaries`:** name, ownership %, entityType, description, naicsCode, indexed `by_clientOrgId`.
- **`passportPriorCarriers`:** lineOfBusiness, carrierName, policyNumber, effectiveDate, expirationDate, premium, notes, indexed `by_clientOrgId`.
- **`passportLosses`:** dateOfLoss, lineOfBusiness, claimNumber, description, amountPaid, amountReserved, status (open/closed), sourceDocumentId (set when extracted from a loss run PDF), indexed `by_clientOrgId`.
- **`passportAdditionalInterests`:** name, role (mortgagee/loss_payee/additional_insured), address, relationship, scope, indexed `by_clientOrgId`. (These also appear per-policy; the passport-level list is the *reusable* set the client has ongoing relationships with — e.g., the bank that holds the mortgage on every building. Per-policy additions still live on policies.)

Each side-table row gets its own provenance entries keyed by field path that includes the row id.

### Fan-out to `orgIntelligence`

Every `confirmed` passport value writes/updates a corresponding `orgIntelligence` row with:

- `source: "application"` (reusing the existing source; the `sourceLabel` disambiguates)
- `sourceLabel: "Client Passport"`
- `sourceRef: clientPassportId:fieldPath`
- `category` derived from field group (`company_info`, `operations`, `financial`, `risk`, etc.)
- `confidence: "confirmed"`
- `content` = a one-line humanized fact ("Annual revenue is $12M as of 2026-04-21")
- `asOfDate` = `lastEditedAt` at the time of write

A small helper `convex/lib/passportIntelligence.ts` owns this mapping. Writes happen inside the passport mutation transaction (so the two stay consistent). Dream consolidation continues to dedup across sources.

## Requirement Configuration

### Broker-org default

Add to `organizations` (broker rows only):

```ts
defaultRequiredPassportSections: v.optional(v.array(v.union(
  v.literal("prior_carrier"),
  v.literal("loss_history"),
  v.literal("additional_interests"),
  v.literal("transaction_info"),
))),
```

Core 4 sections are always required — not listed here. Only the extended 4 are configurable.

### Per-client override

Add to `organizations` (client rows only):

```ts
passportRequirementOverrides: v.optional(v.array(/* same union as above */)),
```

When present, this replaces the broker default for this client. Broker UI in the client detail page's settings area can toggle per-section overrides.

### Resolution helper

`getRequiredSections(clientOrg, brokerOrg)` returns the effective union: always the core 4, plus override if set, else broker default, else empty.

## Onboarding Wizard

### Route

`/onboarding/passport` — replaces the current `/onboarding` for client users (broker onboarding has its own route per foundation spec).

### Structure

**Phase 1 — Linear core:**

1. Applicant info
2. Nature of business
3. Premises / locations (loop — at least one location required; add more as needed)
4. General info

Single-column form per step, progress bar showing 1/4 → 4/4, prev/next buttons. Auto-save on blur.

**Phase 2 — Extended picker:**

After phase 1 submits, client lands on a picker grid with a card per extended section. Required cards are visually distinct and gate the "Finish" button; optional cards show "skip for now."

Extended sections:
- **Prior carrier info** — repeatable list form. Add carrier per line of business.
- **Loss history** — two entry modes: *upload loss run* (triggers extraction, auto-fills rows with `suggested` confidence, client reviews and accepts) or *manual entry*. Prompt for years (3 or 5) and cutoff date.
- **Additional interests** — repeatable list with role dropdown.
- **Transaction info / desired coverage** — effective date target, term, lines of business multi-select.

**Finish:**

- All required (core 4 + broker-required extras) done → `organizations.onboardingComplete = true`, emit `brokerActivity.onboarding_completed`, redirect to client dashboard.
- Core 4 done but broker-required extras pending → `clientPassport.coreCompletedAt = now`, redirect to client dashboard with a persistent "complete your profile" banner. `onboardingComplete` stays false until all broker-required sections are done.
- Core 4 incomplete → stay on wizard.

### Gating

- Core 4 (phase 1) gate the rest of the app — route guard in the client shell redirects to `/onboarding/passport` if `coreCompletedAt` is unset.
- Broker-required extras show as a banner in the client app, non-blocking. Clicking the banner deep-links into the relevant section of the Passport tab (not back into the wizard).

## Auto-Fill Sources

### Source → fields mapping (v1)

| Source | Trigger | Fields populated | Confidence |
|---|---|---|---|
| `invite` | Client invite creation | `primaryContactName`, `primaryContactEmail`, `legalName` (from invite "company name") | `confirmed` |
| `website` | `extractCompanyInfo` action after org creation | `legalName`, `website`, `businessDescription`, `naicsCode`, `industry`-related fields, `yearsInBusiness` (if inferrable), rough `numberOfEmployees` | `suggested` |
| `document` | Org context document uploaded and extracted | Maps extracted facts to fields via `extractFromDocument` classifier tags (financial → revenue/employees; loss run → `passportLosses` rows) | `suggested` |
| `manual` | Client types/edits | Whatever the user changes | `confirmed` |
| `broker` | Broker flag-resolved / future edit-on-behalf | — (flag-only in v1; `broker` source reserved) | `confirmed` (when applied) |
| `integration` | Reserved for subsystem 5 | — | `confirmed` (live-sourced) |

### Suggestion acceptance UI

Each field in the wizard / Passport tab renders with a subtle badge when a `suggested` provenance row exists:

- If the field currently has no value: badge shows "Suggested: {value}" with an **Accept** button that sets the value and promotes provenance to `confirmed`.
- If the field has a conflicting value: badge shows "Different value detected: {suggestedValue} (source: {sourceLabel})" with **Replace** / **Keep current** buttons.
- **Dismiss** removes the suggestion without changing the value.

### Document-derived fill flow

1. Client uploads a doc (existing `orgDocuments` upload).
2. Existing `extractFromDocument` action runs.
3. New step at the end: passport-mapping helper looks at the extracted KV facts and the document classification, writes `passportFieldProvenance` rows with `source: "document"`, `confidence: "suggested"`, `sourceRef: orgDocumentId`.
4. Client sees badges next visit to the Passport tab. Loss run uploads special-case: loss rows are created directly in `passportLosses` with `suggested` confidence; client reviews inline and clicks "accept all" or edits.

## Broker View

### Read access

Broker users with `accessType = "broker_of_client"` can read the client's passport fields and side tables via new queries:

- `clientPassport.getForBroker(clientOrgId)` — full passport + side tables + provenance.
- Wrapped by `assertCanReadPassport` (defined in foundation).

### Flags / annotations

New table `passportFieldFlags`:

```ts
{
  clientOrgId: v.id("organizations"),
  brokerOrgId: v.id("organizations"),
  fieldPath: v.string(),
  authorUserId: v.id("users"),        // broker user who raised the flag
  message: v.string(),
  status: v.union(v.literal("open"), v.literal("resolved"), v.literal("dismissed")),
  resolvedByUserId: v.optional(v.id("users")),
  resolvedAt: v.optional(v.number()),
  createdAt: v.number(),
}
```

Indexes: `by_clientOrgId`, `by_clientOrgId_status`, `by_brokerOrgId`.

**Mutations** (broker-only):

- `passportFieldFlags.create({ clientOrgId, fieldPath, message })` — requires `accessType = "broker_of_client"`.
- `passportFieldFlags.updateStatus({ flagId, status })` — broker or client (either side can resolve/dismiss).

**UI:**

- Broker side: inline "flag" icon next to every passport field in the read-only view. Clicking opens a small popover to write the note. Open flags list at the top of the Passport tab (broker view) with field deep-links.
- Client side: red-dot badge on the field; clicking opens the broker's note inline with a "mark resolved" button. A "broker comments (N)" summary strip appears at the top of the client's Passport tab.

## Access Patterns

All passport reads/writes route through capability asserts from the foundation permission layer:

- `clientPassport.getForClient` — requires `assertCanReadPassport`, `accessType = "member"`.
- `clientPassport.getForBroker` — requires `assertCanReadPassport`, `accessType = "broker_of_client"`.
- `clientPassport.update*` — requires `assertCanEditPassport`, `accessType = "member"` only. Broker edits are NOT allowed in v1 (flag-only model).
- `passportFieldFlags.create` — broker only.

## New Convex Functions

### Queries

- `clientPassport.getFull(clientOrgId)` — dispatches to `getForClient` or `getForBroker` based on `getOrgAccess`.
- `clientPassport.getRequiredSections(clientOrgId)` — resolves effective requirements.
- `passportFieldFlags.listForClient(clientOrgId)` — open + resolved.
- `clientPassport.getCompletionStatus(clientOrgId)` — returns `{ core: boolean, requiredExtras: boolean, missingSections: string[] }`.

### Mutations

- `clientPassport.upsertCore({ clientOrgId, patch })` — applicant info + nature of business + general info.
- `clientPassport.upsertTransactionInfo({ clientOrgId, patch })`
- `passportLocations.{add,update,remove}`
- `passportSubsidiaries.{add,update,remove}`
- `passportPriorCarriers.{add,update,remove}`
- `passportLosses.{add,update,remove,bulkFromExtraction}`
- `passportAdditionalInterests.{add,update,remove}`
- `passportFieldProvenance.acceptSuggestion({ clientOrgId, fieldPath })`
- `passportFieldProvenance.dismissSuggestion({ clientOrgId, fieldPath })`
- `passportFieldFlags.create`, `passportFieldFlags.updateStatus`
- `organizations.setDefaultRequiredPassportSections({ brokerOrgId, sections })`
- `organizations.setPassportRequirementOverrides({ clientOrgId, sections })`

### Actions

- `actions/passportExtraction.ts::mapDocumentToPassport(docId, clientOrgId)` — invoked at end of `extractFromDocument`.
- `actions/passportExtraction.ts::mapWebsiteToPassport(clientOrgId)` — invoked at end of `extractCompanyInfo`.
- `actions/passportExtraction.ts::mapLossRunToPassportLosses(docId, clientOrgId)` — loss run → `passportLosses` rows.

## Frontend Additions

### New routes

- `app/onboarding/passport/page.tsx` — wizard shell.
- `app/onboarding/passport/[section]/page.tsx` — one per core section, plus `/extended` for the picker.
- `app/passport/page.tsx` — client-side Passport tab (post-onboarding edit view).

Broker-side passport view lives inside the existing `/clients/[clientOrgId]/passport` route defined in the broker shell spec; this subsystem fills in the content.

### New components

- `components/passport/wizard-shell.tsx` — progress bar + nav.
- `components/passport/section-applicant-info.tsx`
- `components/passport/section-nature-of-business.tsx`
- `components/passport/section-locations.tsx`
- `components/passport/section-general-info.tsx`
- `components/passport/extended-picker.tsx`
- `components/passport/section-prior-carriers.tsx`
- `components/passport/section-loss-history.tsx`
- `components/passport/section-additional-interests.tsx`
- `components/passport/section-transaction-info.tsx`
- `components/passport/field-with-provenance.tsx` — wraps every input with suggestion badge + flag badge.
- `components/passport/broker-flag-popover.tsx`
- `components/passport/completion-banner.tsx` — nudge banner for broker-required extras.
- `components/passport/broker-readonly-view.tsx` — broker-side full passport view.

### Reused primitives

- `entity-preview-panel` for drawer-based editing (e.g., adding a single location).
- Existing form primitives / Tailwind patterns from current onboarding.

## Testing Strategy (outline)

- Unit: `getRequiredSections` resolution across broker default / override combinations.
- Unit: provenance merge logic (manual overwrites suggested; suggested from different source doesn't overwrite confirmed).
- Integration: invite → core wizard → completion flips `coreCompletedAt`; broker requirement toggle flips banner.
- Integration: website enrichment → provenance rows appear as suggestions; accept promotes + fans out to `orgIntelligence`.
- Integration: loss run upload creates `passportLosses` rows with `suggested` confidence; bulk accept flow.
- Access: broker write attempt rejected; flag create rejected for client user.

## Out of Scope

- Integration-sourced auto-fill (subsystem 5 — schema supports it; implementation deferred).
- Broker write-on-behalf / suggested-edit diff UX — deferred; extend from flags model when brokers ask.
- Passport-level version history beyond `lastEditedAt` (add if audit needs arise).
- Multi-language passport fields.
- Per-policy additional interests (those live on policies; passport's list is the reusable set).
- Automated ACORD 125 PDF regeneration from the passport (belongs in applications subsystem if needed at all — brokers generally want the data, not the form).
