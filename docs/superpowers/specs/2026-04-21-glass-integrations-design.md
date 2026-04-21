# Glass — Integrations Layer Design (Merge reference)

**Date:** 2026-04-21
**Status:** Draft — awaiting review
**Subsystem:** Integrations layer (subsystem 5)
**Depends on:** [foundation](./2026-04-21-glass-dual-org-foundation-design.md), [broker shell](./2026-04-21-glass-broker-shell-design.md), [passport](./2026-04-21-glass-client-passport-design.md), [applications](./2026-04-21-glass-applications-v2-design.md)

## Context

Integrations let a client connect their business SaaS tools (accounting, HRIS, payroll) so applications and the passport can auto-fill from live data instead of manual entry. We use **[Merge.dev](https://www.merge.dev)** as the unified API for these connectors — Merge handles OAuth, provider adapters, sync cadence, and normalization into "Common Models." Glass consumes Merge's API and Merge's webhooks; we do not write provider-specific code.

This spec covers:
- Merge account + environment setup.
- Connection lifecycle (client-initiated via Merge Link, mid-application inline prompts, broker nudge).
- Local cache (`integrationConnections`, `integrationData`) populated from Merge sync + webhooks.
- Intent-to-CommonModel mapping for pre-fill.
- Broker visibility of connections (list + health; no raw data outside applications/passport).

The "integration" source slot already exists in both the passport (`passportFieldProvenance.source = "integration"`) and applications (`applicationAnswers.source = "integration"`); this spec wires it up.

## Decisions

| # | Decision |
|---|---|
| 1 | **Vendor:** Merge.dev unified API. No direct provider SDKs in v1. |
| 2 | **Categories (v1):** Accounting, HRIS, Payroll. Defer File Storage, CRM, Ticketing, ATS. Plaid dropped. |
| 3 | **Read strategy:** scheduled sync + Merge webhooks. Convex `integrationData` cache is the read path for the rest of the app; Merge is the sync source. |
| 4 | **Connection entry points:** both — Settings → Integrations (management) and mid-application inline "Connect to auto-fill" prompts. Broker can send a "please connect X" nudge that surfaces as a banner in the client app. |
| 5 | **Broker visibility:** broker sees the list of the client's connected integrations, last-synced timestamps, and sync health. Raw integration values flow to brokers only through the passport (accepted suggestions) and applications (read during review). No generic "view raw QB data" surface. |

## Merge Setup

### Accounts & environments

- One Merge production organization owned by Clarity Labs.
- Separate production and sandbox environments. Convex env vars: `MERGE_API_KEY_PROD`, `MERGE_API_KEY_SANDBOX`, `MERGE_WEBHOOK_SECRET`.
- Merge's Link token endpoint and Common Models endpoints are called from Convex actions only (server-side). Merge API key is never exposed to the client.

### Per-client-org account tokens

Each client org that links an integration gets a Merge **Account Token** per Linked Account (one per provider per category). Stored encrypted on our side in `integrationConnections` and used to fetch Common Models scoped to that client.

## Data Model

### `integrationConnections` — new table

One row per Merge Linked Account.

```ts
{
  clientOrgId: v.id("organizations"),
  category: v.union(
    v.literal("accounting"),
    v.literal("hris"),
    v.literal("payroll"),
  ),
  mergeAccountTokenEncrypted: v.string(),  // encrypted at rest
  mergeLinkedAccountId: v.string(),
  providerSlug: v.string(),                // "quickbooks_online", "xero", "rippling", ...
  providerDisplayName: v.string(),         // Merge-provided display name
  status: v.union(
    v.literal("connecting"),               // Link in progress
    v.literal("active"),
    v.literal("reauth_required"),
    v.literal("disconnected"),
    v.literal("error"),
  ),
  lastSyncAt: v.optional(v.number()),
  lastSyncStatus: v.optional(v.union(
    v.literal("success"),
    v.literal("partial"),
    v.literal("error"),
  )),
  lastSyncError: v.optional(v.string()),
  connectedByUserId: v.optional(v.id("users")),
  connectedAt: v.number(),
  disconnectedAt: v.optional(v.number()),
}
```

Indexes: `by_clientOrgId`, `by_clientOrgId_category`, `by_mergeLinkedAccountId`.

Uniqueness guardrail (enforced in mutation): one active connection per `(clientOrgId, category, providerSlug)`. If a client tries to connect the same provider twice, we replace / reconnect the existing record rather than creating a duplicate.

### `integrationData` — new table

Normalized cache of Common Model records that matter for insurance. Stored as flat rows per logical metric rather than full Merge object trees (keeps reads cheap and the schema stable if Merge evolves their Common Models).

```ts
{
  connectionId: v.id("integrationConnections"),
  clientOrgId: v.id("organizations"),
  metricKey: v.string(),                   // "accounting.annual_revenue", "hris.headcount", "payroll.total_payroll_ytd"
  value: v.any(),                          // shape per metricKey (number, string, structured)
  unit: v.optional(v.string()),            // "USD", "count", etc.
  asOfDate: v.optional(v.string()),        // "2026-04-21" — what the metric is dated
  period: v.optional(v.object({            // for time-scoped metrics
    start: v.string(),
    end: v.string(),
    kind: v.union(
      v.literal("ytd"),
      v.literal("trailing_12"),
      v.literal("fiscal_year"),
      v.literal("calendar_year"),
      v.literal("quarter"),
      v.literal("month"),
    ),
  })),
  syncedAt: v.number(),
  mergeSourceRef: v.optional(v.string()),  // Merge object id(s) for traceability
}
```

Indexes: `by_clientOrgId_metricKey`, `by_connectionId`.

Writes are upserts keyed by `(clientOrgId, metricKey, period?.kind, period?.end)` — one row per metric per period bucket. Sync replaces the row if present.

### `integrationSyncLogs` — new table

Streaming sync history for broker-visible health diagnostics.

```ts
{
  connectionId: v.id("integrationConnections"),
  clientOrgId: v.id("organizations"),
  trigger: v.union(
    v.literal("initial"),
    v.literal("webhook"),
    v.literal("scheduled"),
    v.literal("manual"),
  ),
  status: v.union(v.literal("running"), v.literal("success"), v.literal("error")),
  metricsWritten: v.number(),
  error: v.optional(v.string()),
  startedAt: v.number(),
  durationMs: v.optional(v.number()),
}
```

Indexes: `by_connectionId`, `by_clientOrgId`.

### `integrationRequests` — new table (broker nudges)

```ts
{
  brokerOrgId: v.id("organizations"),
  clientOrgId: v.id("organizations"),
  category: v.union(
    v.literal("accounting"),
    v.literal("hris"),
    v.literal("payroll"),
  ),
  requestedByUserId: v.id("users"),
  message: v.optional(v.string()),
  status: v.union(
    v.literal("pending"),
    v.literal("fulfilled"),          // connection created
    v.literal("dismissed"),
  ),
  createdAt: v.number(),
  resolvedAt: v.optional(v.number()),
}
```

Indexes: `by_clientOrgId_status`, `by_brokerOrgId`.

## Connection Flows

### Settings-initiated connect (client)

1. Client opens `/settings` → **Integrations** tab (new; client-only).
2. Page lists available categories (Accounting, HRIS, Payroll) + currently-connected rows.
3. "Connect" button → Convex action `integrations.createLinkToken({ category })`:
   - Auth: member of the client org.
   - Server calls Merge `/integrations/create-link-token` with org metadata (`clientOrgId` as `end_user_origin_id`, `category`).
   - Returns the short-lived link token.
4. Client opens Merge Link widget with that token; completes OAuth.
5. Merge fires a webhook (`linked_account.created`) back to our HTTP endpoint with the Linked Account details.
6. Webhook handler:
   - Creates `integrationConnections` row with `status: "connecting"` (or updates if reconnecting).
   - Schedules initial sync action.
   - Returns 200.
7. Initial sync completes → `status: "active"`, `lastSyncAt` set, `brokerActivity` emits `integration_connected` event.

### Mid-application inline connect

1. When rendering a question whose intent has `integrationCandidates` and no active connection in that category exists, the UI renders a "Connect {category} to auto-fill" card instead of (or above) the input.
2. Clicking the card calls the same `integrations.createLinkToken({ category, originatingApplicationId })`.
3. After successful link + initial sync, the card replaces itself with the pre-filled value and source chip.
4. `originatingApplicationId` is recorded on `integrationConnections.connectedAt` metadata for activity traceability.

### Broker nudge

1. Broker opens the client detail page → Integrations tab (broker-visible, read-only list) → "Request integration" button.
2. Form: category + optional message ("we need payroll data for the WC app").
3. Creates `integrationRequests` row → emits a client-side notification (subsystem 7).
4. Client app renders a banner in Settings → Integrations: "{Broker name} asked you to connect payroll." Clicking opens the standard flow with `integrationRequests.id` passed through.
5. On successful connection, `integrationRequests.status → "fulfilled"` and `brokerActivity` emits `integration_request_fulfilled`.

### Disconnect / reauth

- Client can click **Disconnect** on any row in Settings → Integrations. Calls `integrations.disconnect(connectionId)`, which calls Merge's delete endpoint, flips `status → "disconnected"`, stops future syncs.
- When Merge reports `reauth_required` via webhook, `status` flips and the connection card renders a "Reconnect" button that runs the same link-token flow with the existing connection id so re-auth replaces the token in place.

## Sync Pipeline

### Initial sync

- Runs immediately after `linked_account.created` webhook.
- Fetches Common Models relevant to the category:
  - **Accounting:** `Company`, `IncomeStatement` (trailing 12 + current FY), `BalanceSheet`.
  - **HRIS:** `Company`, `Employee` (active count), optional location aggregation.
  - **Payroll:** `Payroll` (YTD + trailing 12), per-classification aggregates if the provider supports it.
- Maps to `integrationData` rows per the mapping table below.
- Writes `integrationSyncLogs` row.

### Scheduled sync

- Daily cron per connection (jittered to spread load).
- Same fetch logic as initial sync, upserting rows.
- Skipped if connection is `disconnected` or `reauth_required`.

### Webhook-driven sync

- Merge webhook endpoint at `/api/merge/webhook` (Next.js route → Convex HTTP action).
- Verifies Merge signature using `MERGE_WEBHOOK_SECRET`.
- Events handled:
  - `linked_account.created` → create connection + schedule initial sync.
  - `sync.completed` (per Common Model) → schedule a targeted resync for that model.
  - `linked_account.deleted` → mark `disconnected`.
  - `linked_account.reauth_required` → mark `reauth_required`.

### Fetch client

A thin wrapper `convex/lib/mergeClient.ts` handles:
- Auth header construction with per-connection Account Token.
- Pagination over Merge cursors.
- Normalization of currency strings (Merge returns decimals) into the shape our `integrationData.value` expects.
- Error envelope (rate-limit, auth, server) → throws typed errors the sync action catches.

## Intent → Common Model Mapping

Reuses the `questionIntents.integrationCandidates: string[]` field introduced in the applications spec, with the convention:

```
merge:{category}:{metricKey}
```

e.g., `merge:accounting:annual_revenue`, `merge:hris:headcount`, `merge:payroll:total_payroll_ytd`.

### v1 metric catalog

| metricKey | Source Common Model | Derivation | Passport field path |
|---|---|---|---|
| `accounting.annual_revenue` | `IncomeStatement` (FY) | sum of revenue accounts | `annualRevenue` |
| `accounting.prior_year_revenue` | `IncomeStatement` (prior FY) | sum of revenue accounts | — |
| `accounting.company_legal_name` | `Company` | `name` | `legalName` |
| `accounting.company_ein` | `Company` | `tax_number` / `ein` | `fein` |
| `hris.headcount` | `Employee` (status=active) | count | `numberOfEmployees` |
| `hris.company_address` | `Company` | primary address | `mailingAddress` |
| `payroll.total_payroll_ytd` | `Payroll` | sum `net_pay` YTD | — |
| `payroll.total_payroll_trailing_12` | `Payroll` | sum `net_pay` trailing 12 | — |

This table is the seed for `questionIntents.integrationCandidates` values (applications subsystem owns the intent catalog; this spec contributes the integration side).

### Prefill resolver

Extended `convex/lib/applicationPrefill.ts::resolvePrefill` from the applications spec:

1. Explicit binding wins.
2. Else, for each `integrationCandidates` entry, parse `merge:{category}:{metricKey}`:
   - Check for an active `integrationConnections` row in that category for the client.
   - If active, read `integrationData` by `metricKey` (most recent period for trailing/YTD metrics, matching fiscal year for annual metrics).
   - Return `{ value, source: "integration", sourceRef: connectionId, syncedAt }`.
3. Else fall back to passport path.
4. Else blank.

Passport auto-fill uses the same resolver with passport-relevant metric keys.

### Override tracking

When the client edits an integration-sourced application answer, the override-tracking behavior defined in the applications spec applies as-is (Merge values populate the `overrideOfIntegration.syncedValue`). On next sync, `integrationData` updates but the answer's override is preserved.

## Broker Visibility

### Broker-side Integrations panel

Inside the client detail page, add an "Integrations" tab (or a section in the Overview — small enough to live there). For each `integrationConnections` row:

- Provider icon + display name (category underneath).
- Status chip (active / reauth required / error / disconnected).
- `lastSyncAt` relative timestamp.
- "Request reconnect" button when `status !== "active"`.

No raw data rendered on this panel. Broker sees the *presence* of integrations; values reach broker eyes only through the passport (accepted suggestions) or applications (during review).

### Permission asserts

New capability checks in `convex/lib/access.ts`:

- `assertCanReadIntegrationsList(access)` — member OR broker_of_client.
- `assertCanConnectIntegration(access)` — member only.
- `assertCanDisconnectIntegration(access)` — member only.
- `assertCanRequestIntegration(access)` — broker_of_client only.
- `assertCanReadRawIntegrationData(access)` — member only. (Used by `integrationData.get*`; brokers don't see raw values directly.)

## Convex Functions (Summary)

### Queries

- `integrations.listForClient(clientOrgId)` — full connection list + status + last sync (member or broker_of_client).
- `integrations.getSyncLogs(connectionId, limit?)` — broker-visible for diagnostics.
- `integrationData.getMetricForClient(clientOrgId, metricKey, { period? })` — internal, used by prefill resolver. Requires `assertCanReadRawIntegrationData`.
- `integrationRequests.listForClient(clientOrgId)` — banner source.

### Mutations

- `integrations.createLinkToken({ category, originatingApplicationId? })` — returns a short-lived Merge link token (client-scoped).
- `integrations.recordLinkedAccount` — internal, called from webhook handler.
- `integrations.disconnect(connectionId)`
- `integrationRequests.create({ clientOrgId, category, message? })` — broker only.
- `integrationRequests.dismiss(requestId)` — client only.

### Actions

- `actions/mergeSync.ts::runInitialSync(connectionId)`
- `actions/mergeSync.ts::runScheduledSync(connectionId)`
- `actions/mergeSync.ts::runWebhookDrivenSync(connectionId, modelName)`
- `actions/mergeSync.ts::syncMetric(connectionId, metricKey)` — per-metric helper.

### HTTP route

- `POST /api/merge/webhook` — Next.js handler that verifies signature and dispatches to internal Convex actions.

### Crons

- `integrations.scheduledSyncAll` — daily, jittered; enumerates active connections and schedules per-connection sync actions.

## Frontend Additions

### Client-side

- `app/settings/integrations/page.tsx` — the Integrations settings tab (registers with the tab framework from broker-shell spec; rendered only when `orgType = "client"`).
- `components/integrations/connection-card.tsx` — per-connection row with status + actions.
- `components/integrations/connect-prompt.tsx` — inline in applications.
- `components/integrations/merge-link-button.tsx` — thin wrapper around Merge's Link widget.
- `components/integrations/broker-request-banner.tsx` — surfaces `integrationRequests` pending for the client.

### Broker-side

- `components/integrations/broker-integrations-panel.tsx` — renders inside the client detail page.
- `components/integrations/request-integration-button.tsx` — emits an `integrationRequests` row.

## Env & Secrets

| Name | Scope | Purpose |
|---|---|---|
| `MERGE_API_KEY_PROD` | Convex | Server-side Merge API auth |
| `MERGE_API_KEY_SANDBOX` | Convex (dev) | Sandbox auth |
| `MERGE_WEBHOOK_SECRET` | Convex | Webhook signature verification |
| `INTEGRATION_TOKEN_ENC_KEY` | Convex | AES key for encrypting `mergeAccountTokenEncrypted` at rest |

Token encryption uses the existing Convex env + a `convex/lib/secrets.ts` helper (add if not present).

## Testing Strategy (outline)

- Unit: `mergeClient` pagination + error classification.
- Unit: `resolvePrefill` integration branch returns the right metric for a connected category; falls through when disconnected.
- Unit: `syncMetric` upsert semantics (re-sync replaces, doesn't duplicate).
- Integration: fake Merge webhook replay → sync writes `integrationData` rows with correct periods.
- Integration: client connects QB in sandbox → `Accounting.IncomeStatement` → `accounting.annual_revenue` populated → application prefill chip renders → override flow.
- Integration: broker requests connection → client banner → client connects → request marked fulfilled.

## Cost & Operational Considerations

- Merge charges per active Linked Account. This is a real per-client cost — surface it in internal metrics (number of active connections per broker) and consider tiering when we move past the experiment phase.
- Merge rate limits per Linked Account. Daily sync + webhook-triggered syncs should stay well under, but `mergeSync.runScheduledSync` jitters and respects Retry-After on 429s.
- Merge sandbox is limited; end-to-end testing in production-shape environments requires real OAuth flows with broker sandbox tenants for providers that support them (QuickBooks does).

## Out of Scope

- File Storage, CRM, Ticketing, ATS Merge categories.
- Direct provider SDKs (bypassing Merge for any reason).
- Plaid / bank-level data.
- Rich drill-down into raw Merge Common Model responses in the UI.
- Per-provider custom fields beyond the v1 metric catalog (add metrics incrementally as applications demand them).
- Historical time-series charts from integration data.
- Automatic disconnect when sync errors repeat (manual for now; add policy later).
- Cost-aware connection limits or billing integration.
- Sync of client-side changes back *to* the provider (write-back). All syncs are read-only.
