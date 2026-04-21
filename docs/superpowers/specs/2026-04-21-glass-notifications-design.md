# Glass — Notifications Design

**Date:** 2026-04-21
**Status:** Draft — awaiting review
**Subsystem:** Notifications (subsystem 7)
**Depends on:** [foundation](./2026-04-21-glass-dual-org-foundation-design.md), [broker shell](./2026-04-21-glass-broker-shell-design.md), [passport](./2026-04-21-glass-client-passport-design.md), [applications](./2026-04-21-glass-applications-v2-design.md), [integrations](./2026-04-21-glass-integrations-design.md), [policy ingestion](./2026-04-21-glass-policy-ingestion-design.md)

## Context

Prism has a notifications table and an in-app bell UI. Glass keeps the same primitive and extends it across the broker↔client network: new event types for cross-org actions, email delivery for high-severity items, per-user preferences, and light rollup to prevent burst-noise. Email sending is broker-branded when a notification targets a client, generic-Clarity-Labs when it targets a broker.

## Decisions

| # | Decision |
|---|---|
| 1 | **Channels (v1):** in-app + email. Schema ready for digest mode (subsystem-level deferred). |
| 2 | **Shape:** keep existing `notifications` table shape. Add `relatedOrgId` for cross-org context. `orgId` is the recipient org. No `targetSide` discriminator — the `type` enum implicitly identifies the audience. |
| 3 | **Preferences:** per-user. `notificationPreferences` table keyed on `(userId, type, channel)`. |
| 4 | **Rollup:** targeted coalesce (merge-if-unread) for a small set of high-frequency types. No aggressive digesting in v1. |

## Event Catalog

### Broker-targeted (`orgId` = broker org)

| type | severity | coalesce window |
|---|---|---|
| `client_invitation_accepted` | info | — |
| `client_onboarding_completed` | info | — |
| `application_submitted_by_client` | info | 10 min per `(brokerOrgId, clientOrgId)` |
| `application_completed_by_client` | info | — |
| `client_document_uploaded` | info | 10 min per `(brokerOrgId, clientOrgId)` |
| `integration_disconnected_for_client` | warning | — |
| `integration_request_fulfilled` | info | — |
| `passport_flag_resolved_by_client` | info | — |

### Client-targeted (`orgId` = client org)

| type | severity | coalesce window |
|---|---|---|
| `application_sent_by_broker` | info | — |
| `application_section_returned_by_broker` | warning | — |
| `application_accepted_by_broker` | info | — |
| `passport_flag_raised_by_broker` | warning | 10 min per `brokerOrgId` |
| `integration_requested_by_broker` | info | — |
| `policy_delivered_by_broker` | info | — |
| `quote_delivered_by_broker` | info | — |

### Existing prism types (retained as-is)

`merge_suggestion`, `coverage_gap`, `renewal_reminder`, `policy_lapsed`, `coverage_limit_concern`, `missing_coverage`, `carrier_rating_change`, `broker_action`, `extraction_complete`, `extraction_error`, `incomplete_extraction`, `stale_data`, `premium_anomaly`, `dream_insight` — target the client org as they always have. Re-routing any of these to broker targets happens in later iterations, not this spec.

Severity is used for default email routing: `critical` and `warning` events deliver by email by default (subject to user preference); `info` events stay in-app by default.

## Schema Changes

### `notifications` — extend existing table

Add fields:

```ts
relatedOrgId: v.optional(v.id("organizations")),   // the "other side" org for cross-org context
coalesceKey: v.optional(v.string()),               // stable key used for merge-if-unread
coalescedCount: v.optional(v.number()),            // >=2 when multiple events collapsed into one notification
lastEventAt: v.optional(v.number()),               // latest coalesced event timestamp
emailStatus: v.optional(v.union(
  v.literal("not_scheduled"),
  v.literal("scheduled"),
  v.literal("sent"),
  v.literal("suppressed_by_preference"),
  v.literal("failed"),
)),
emailSentAt: v.optional(v.number()),
```

Extend the `type` union with the new event types in the catalog above.

Additional indexes: `by_orgId_coalesceKey_status` (used by the coalesce lookup).

### `notificationPreferences` — new table

```ts
{
  userId: v.id("users"),
  orgId: v.id("organizations"),       // scope prefs to a user's role in a specific org
  type: v.string(),                   // matches notifications.type, or "__all__"
  channel: v.union(v.literal("in_app"), v.literal("email")),
  enabled: v.boolean(),
  updatedAt: v.number(),
}
```

Indexes: `by_userId_orgId`, `by_userId_orgId_type_channel`.

Semantics:
- Absence of a row = use severity default.
- A `type = "__all__"` row is a catch-all override (e.g., "mute all email for me").
- Per-type rows win over the catch-all.

### Cross-subsystem emission

Every notification create goes through a single helper `convex/lib/notify.ts::notify({ ctx, orgId, type, userId?, relatedOrgId?, title, body, payload?, coalesceKeyParts? })`. The helper:

1. Builds a `coalesceKey` from `coalesceKeyParts` (e.g., `["application_submitted_by_client", brokerOrgId, clientOrgId]`) and the current 10-minute bucket, when the type has a coalesce window.
2. If a matching unread notification exists, updates its `coalescedCount`, `lastEventAt`, and body (e.g., "3 sections submitted by Acme"), returns its id.
3. Else inserts a new row with `emailStatus = "not_scheduled"`.
4. Determines effective email delivery: severity default → user pref → final decision. If email is on, schedules `sendNotificationEmail` action; sets `emailStatus = "scheduled"`.
5. Returns the notification id.

This helper replaces ad-hoc `db.insert("notifications", …)` calls across the codebase. Migrations happen per-caller.

## Email Delivery

### From addresses and branding

- **Client-targeted emails** — use the **broker's branding**:
  - From name: `{agentDisplayName ?? brokerOrgName} via Glass`
  - From address: current shared Resend domain (e.g. `notifications@glass.app`); per-broker sending identity is deferred.
  - Template includes broker logo + accent color + "powered by Glass from Clarity Labs" footer.
- **Broker-targeted emails** — generic Glass sender:
  - From name: `Glass`
  - From address: same shared domain.
  - Template uses Clarity Labs / Glass branding (broker org has no "upstream" to brand from).

### Template

One shared transactional template with slots for title, body, primary CTA button (deep link to the notification's contextual route), and a footer. Dark/light-mode safe, email-client compatible (similar to existing prism notification email template if present).

### Action

`actions/sendNotificationEmail.ts::send(notificationId)`:

1. Load notification + recipient org + recipient user(s).
2. If `notifications.userId` is set, send to that user. Else send to every member of the recipient org (subject to each user's preference).
3. Resolve branding:
   - If recipient is a client org → read `clientOrg.brokerOrgId` → use that broker's branding fields.
   - If recipient is a broker org → generic Glass branding.
4. Call Resend; on success set `emailStatus = "sent"` and `emailSentAt`. On failure, retry up to 3× with backoff, then `emailStatus = "failed"` and log.

User-preference suppression at send time (double-check after the coalesce/insert step in case prefs changed between scheduling and sending): if every would-be recipient has email disabled for this type, set `emailStatus = "suppressed_by_preference"` and skip sending.

## In-App UI

### Notifications bell / inbox

- Existing bell component (broker shell + client shell) now reads the extended catalog.
- Grouping: notifications grouped by date, then by `relatedOrgId` when present (e.g., a broker's inbox groups by client).
- Each item: icon by type, title, body, relative timestamp, chip for `coalescedCount > 1` ("×3"), unread indicator.
- Clicking navigates to the `payload`-derived deep link (application route, passport flag, integration reconnect, etc.).
- Actions: mark read, mark all read, dismiss.

### Preferences UI

In Settings → **Notifications** tab (per-user, shown when any org membership exists):

- Grid: rows = notification types, columns = `In-app`, `Email`. Toggles set `notificationPreferences` rows.
- Separate "Email — all notifications" master toggle at the top (writes `type = "__all__"`, `channel = "email"`).
- Rows are grouped (Applications, Policies & Quotes, Passport, Integrations, Account).
- Broker users see broker-targeted types; client users see client-targeted types. Users with memberships in both see both groups, keyed by org.

## Emission Wiring (per subsystem)

The helper `notify(...)` is called from:

- **Foundation (invitations):** `client_invitation_accepted`, `client_onboarding_completed`.
- **Applications:** `application_sent_by_broker` (on send), `application_section_returned_by_broker` (on return), `application_accepted_by_broker` (on accept), `application_submitted_by_client` (on group submit), `application_completed_by_client` (on final accept).
- **Passport:** `passport_flag_raised_by_broker` (on flag create), `passport_flag_resolved_by_client` (on resolve).
- **Integrations:** `integration_requested_by_broker` (on `integrationRequests.create`), `integration_request_fulfilled` (on successful connection with a pending request), `integration_disconnected_for_client` (on webhook-reported disconnect/reauth).
- **Policy ingestion:** `policy_delivered_by_broker` (on broker upload), `quote_delivered_by_broker` (on broker quote upload), `client_document_uploaded` (on client upload into `orgDocuments`). Existing extraction-complete / error / stale-data notifications stay wired as-is.

Every callsite passes a `payload` with the ids needed for deep linking (`applicationId`, `groupId`, `policyId`, `connectionId`, etc.) and a `relatedOrgId` when cross-org.

## Convex Functions

### Mutations

- `notifications.markRead({ ids })`
- `notifications.markAllRead({ orgId })`
- `notifications.dismiss({ id })`
- `notificationPreferences.set({ orgId, type, channel, enabled })`
- `notificationPreferences.setAllEmail({ orgId, enabled })` — convenience for the master toggle.

### Queries

- `notifications.listInbox({ orgId, status?, cursor?, limit? })` — reverse-chron, enriched with `relatedOrg` name when set.
- `notifications.unreadCount({ orgId })`
- `notificationPreferences.getForUser({ orgId })`

### Internal helper

- `convex/lib/notify.ts::notify(...)` — the single creation/coalesce path.

### Actions

- `actions/sendNotificationEmail.ts::send(notificationId)`
- Cron `notifications.sweepStale` (optional, weekly) to expire info-level notifications older than 30 days.

## Access

- All notification queries / mutations call `getOrgAccess`. Only members of the recipient org can see their notifications. Broker users do NOT see client-targeted notifications for their clients (the *event* is visible via the broker's own broker-targeted notification — e.g., broker gets `application_submitted_by_client`; the client gets `application_sent_by_broker`). One event, two notifications, one per side.
- Users can read/update only their own `notificationPreferences` rows.

## Testing Strategy (outline)

- Unit: coalesce logic — two events within the window collapse; outside the window don't; unread-only merges; resetting read status of the coalesced notification leaves future coalesces intact.
- Unit: preference resolution — per-type row beats `__all__`; absence falls back to severity default.
- Integration: broker-side event fires → broker gets notification → client-side "mirror" event fires → client gets notification → both are independent and scoped to their respective orgs.
- Integration: email send picks broker branding for client recipients; generic branding for broker recipients.
- Failure path: Resend failure retries 3×, sets `emailStatus = "failed"`, user sees in-app notification regardless.

## Out of Scope

- Digest email mode (schema supports it; implementation deferred).
- SMS / push channels.
- Real-time in-app toasts (consider later; existing prism UI already reactively updates via Convex subscriptions).
- Per-broker-org default preferences pushed to producers (A2 option deferred).
- Custom user-defined rollup rules.
- Notification → Slack / Teams integrations.
- Per-event audit trail (who received, who read, when) beyond `notifications` row state.
