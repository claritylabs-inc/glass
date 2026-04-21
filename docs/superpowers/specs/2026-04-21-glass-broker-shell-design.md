# Glass — Broker Experience Shell Design

**Date:** 2026-04-21
**Status:** Draft — awaiting review
**Subsystem:** Broker experience shell (subsystem 2 of the Glass platform)
**Depends on:** [2026-04-21-glass-dual-org-foundation-design.md](./2026-04-21-glass-dual-org-foundation-design.md)

## Context

The foundation subsystem introduced broker orgs, client orgs, and the permission layer. This subsystem builds the **broker-facing UI shell** — the surfaces a broker uses to navigate their book of clients and manage their own org. Deep client-facing features (passport, applications, integrations) are rendered here as lightweight placeholders or read-only views; they're filled in by later subsystems.

This shell is mostly net-new frontend (Next.js routes and React components) plus a small amount of backend: activity events, client list queries, broker-scoped mutations.

## Decisions

| # | Decision |
|---|---|
| 1 | **Dashboard:** Client list first. No stats strip in v1. |
| 2 | **Client list columns:** Operational — name, primary contact, onboarding status, created date, last-activity timestamp, # open applications, # active policies, # docs uploaded, assigned producer (from `brokerClientAssignments`, informational only in v1). |
| 3 | **Broker navigation:** `Clients`, `Activity`, `Settings`. No top-level cross-client Applications or Policies tabs. |
| 4 | **Client detail page:** Header + tabs (Overview, Passport, Applications, Policies, Intelligence, Activity). Dense secondary content uses the existing `entity-preview-panel` sliding drawer pattern, not new dialogs or modals. |
| 5 | **Invite client UX:** Right-side drawer launched from the client list. No passport prefill in v1. Supports both email and shareable-link modes (defined in foundation spec). |
| 6 | **Settings:** One `/settings` route. Tab set driven by `orgType` from `getOrgAccess`. Broker gets Organization, Branding, Team, Agent, Billing (v1 placeholder). Client keeps its existing tabs. |
| 7 | **Activity:** Portfolio-wide feed at `/activity`; per-client feed on the client detail page's Activity tab. Both read from a single `brokerActivity` events table. |

## App Shell & Routing

### Shell selection

The existing `app-shell.tsx` and `app-sidebar.tsx` are reused. The active org's `orgType` (from `useCurrentOrg`, which wraps `getOrgAccess`) drives which nav items render:

- **Broker org active:** Clients, Activity, Settings.
- **Client org active:** existing client-side nav (unchanged in this subsystem).
- **Broker viewing a client (`accessType = "broker_of_client"`):** broker nav is primary, plus a "viewing as broker" breadcrumb/chip inside the client detail page.

Org switcher (already needed for the multi-org user case from foundation Q4) lives in `app-sidebar.tsx` — one entry per membership, grouped by type.

### Routes

| Route | Purpose |
|---|---|
| `/` | Redirects to `/clients` for broker orgs. |
| `/clients` | Client list. |
| `/clients/[clientOrgId]` | Client detail — Overview tab default. |
| `/clients/[clientOrgId]/passport` | Passport tab (placeholder in v1; filled by subsystem 3). |
| `/clients/[clientOrgId]/applications` | Applications tab (placeholder; filled by subsystem 4). |
| `/clients/[clientOrgId]/policies` | Policies tab (read-only list; filled by subsystem 6). |
| `/clients/[clientOrgId]/intelligence` | Intelligence tab (filtered read of `orgIntelligence` per foundation rules). |
| `/clients/[clientOrgId]/activity` | Per-client activity feed. |
| `/activity` | Portfolio-wide activity feed. |
| `/settings` | Settings; tab set by `orgType`. |

All `/clients/*` routes server-side check `getOrgAccess(ctx, clientOrgId)` and require `accessType = "broker_of_client"` or reject with 404 (avoid leaking existence of clients not owned by the broker).

## Client List

### Query

New Convex query `clients.listForBroker(brokerOrgId)` returns rows with:

```ts
{
  clientOrgId: Id<"organizations">,
  name: string,
  primaryContactName: string | undefined,
  primaryContactEmail: string | undefined,
  onboardingStatus: "invited" | "onboarding" | "active",
  createdAt: number,
  lastActivityAt: number | undefined,
  openApplicationsCount: number,
  activePoliciesCount: number,
  documentsCount: number,
  assignedProducerIds: Id<"users">[],   // from brokerClientAssignments; empty in v1
}
```

Implementation: index lookup on `organizations.by_brokerOrgId`, then a per-row aggregation step. Counts are cheap enough via existing indexes (`policies.by_orgId`, `applicationSessions.by_orgId`, `orgDocuments.by_orgId`) for midmarket-scale broker books (≤ a few hundred clients). If this becomes a hotspot, cache counts on the client org record and update them from the event pipeline.

`onboardingStatus` derivation:
- `invited` — a pending `clientInvitations` row exists for this broker but `clientOrgId` is not yet set. (Shown in list as a "pending invite" row; does not have a detail page.)
- `onboarding` — `clientOrgId` exists but `organizations.onboardingComplete !== true`.
- `active` — `onboardingComplete === true`.

`lastActivityAt` = max of relevant event timestamps from `brokerActivity` for that client.

### UI

- Full-width list/grid. Columns listed above. Default sort: `lastActivityAt` desc, then `createdAt` desc.
- Status filter chip row: All / Invited / Onboarding / Active.
- Quick filter input (client-side name/contact match).
- Primary action button top-right: **Invite client** → opens drawer.
- Pending invitations render inline as a distinct row style (muted, no detail link, with Resend / Revoke actions).

## Invite Client Drawer

Launched from `/clients` via the primary action button. Uses `entity-preview-panel`.

Fields:

- Mode toggle: **Email invite** (default) vs **Shareable link**.
- **Email mode:** Client company name, primary contact name, primary contact email, optional message.
- **Shareable link mode:** Optional `maxUses` input, optional label (broker-facing only).

Submit:

- Email mode → calls `clientInvitations.createEmail`. Drawer flips to a success state showing "Email sent to {addr}." Close returns to the list with the pending invite row appearing.
- Shareable link mode → calls `clientInvitations.createShareable`. Drawer flips to a success state showing the URL with a copy button, the `maxUses` remaining, and a revoke button.

No passport prefill in v1. Form validation inline: slug of client company name is auto-generated, email must be valid.

## Client Detail Page

Layout: `app-shell` left nav + main pane. Main pane:

### Header

- Client name (bold, large), primary contact, onboarding status chip.
- Breadcrumb chip: "Viewing as broker for {brokerOrgName}" (when `accessType = "broker_of_client"`).
- Quick actions (right): **Send application** (→ subsystem 4), **Upload policy** (→ subsystem 6), **Impersonate-free secondary actions menu**.

### Tabs

Horizontal tab bar under the header. All tabs use `assertCanRead*` capabilities from the foundation permission layer.

- **Overview** — passport summary snapshot (read-only), most-recent activity strip, open applications count, policy count, quick links into other tabs. Composed of existing widgets where possible.
- **Passport** — v1 placeholder: a read-only preview of whatever passport-style fields already exist on the client org (name, website, industry, context). The real passport editor comes in subsystem 3.
- **Applications** — v1 placeholder: a list of `applicationSessions` for the client, read-only. Row click opens the session in an `entity-preview-panel` drawer (reuses existing application viewer if one exists; otherwise renders the raw `extractedFields` JSON in a minimal view). Subsystem 4 replaces this with the real applications UI.
- **Policies** — list of `policies` for the client. Row click opens the existing policy preview drawer. Broker can upload a new policy via the header action; extraction pipeline reuses the existing flow.
- **Intelligence** — vector-searchable read over `orgIntelligence` filtered per `assertCanReadIntelligence` (no `source: "email" | "chat"` entries). Reuses existing intelligence UI components; wraps them with the filtered query.
- **Activity** — per-client feed (see below).

Each tab is its own route segment to preserve deep-linkability and allow independent loading states.

### Drawer pattern for detail work

Dense secondary interactions live in `entity-preview-panel`:

- Viewing a single application's fields.
- Policy preview / metadata / chunks.
- Single intelligence entry edit (read-only for broker; but write for subsystem 4 when sending an application draft, etc.).

No modals / dialogs for long-form interactions. Destructive confirmations (revoke invite, archive client) use the existing confirm-dialog pattern.

## Activity Feed

### `brokerActivity` — new table

```ts
{
  brokerOrgId: v.id("organizations"),
  clientOrgId: v.id("organizations"),
  type: v.union(
    v.literal("invitation_accepted"),
    v.literal("onboarding_completed"),
    v.literal("document_uploaded"),
    v.literal("application_sent"),
    v.literal("application_batch_submitted"),
    v.literal("application_completed"),
    v.literal("policy_uploaded"),
    v.literal("policy_extraction_completed"),
    v.literal("notification_fired"),
  ),
  actorUserId: v.optional(v.id("users")),
  actorSide: v.union(v.literal("broker"), v.literal("client"), v.literal("system")),
  payload: v.optional(v.any()),             // { applicationSessionId, policyId, documentId, etc. }
  summary: v.string(),                      // pre-rendered one-liner for display
  createdAt: v.number(),
}
```

Indexes: `by_brokerOrgId_createdAt`, `by_brokerOrgId_clientOrgId_createdAt`, `by_clientOrgId_createdAt`.

### Event emission

Writes happen inline from the mutations/actions that produce the event, via a `recordBrokerActivity(ctx, { … })` helper in `convex/lib/brokerActivity.ts`. The helper is called from:

- `clientInvitations.accept` → `invitation_accepted`, then `onboarding_completed` when the client finishes onboarding.
- `orgDocuments` upload mutation → `document_uploaded` (client-side uploads only; broker-side uploads attribute to `actorSide: "broker"`).
- Application pipeline (subsystem 4 emits `application_sent`, `application_batch_submitted`, `application_completed`).
- Policy extraction completion → `policy_extraction_completed`; broker policy upload → `policy_uploaded`.
- Notifications (subsystem 7) fan into `notification_fired` when broker-visible.

In v1, only event types whose source code exists in the current repo are wired up: `invitation_accepted`, `onboarding_completed`, `document_uploaded`, `policy_uploaded`, `policy_extraction_completed`. The others are declared in the union so subsystem 4/7 can emit without a schema change.

### Queries

- `brokerActivity.listPortfolio(brokerOrgId, { limit, cursor, typeFilter? })` — portfolio-wide paginated feed.
- `brokerActivity.listForClient(brokerOrgId, clientOrgId, { limit, cursor, typeFilter? })` — per-client.

Both run `getOrgAccess` on the appropriate org and `assertBrokerOrg` on the broker org.

### UI

Reverse-chronological list of event cards, grouped by day. Each card: icon by type, one-line summary (from `event.summary`), relative timestamp, client name (portfolio view only — link to the client), optional click target (e.g. clicking an `application_sent` event opens the application drawer inside the client detail page).

Filter strip: event type multi-select, client filter (portfolio view only).

## Settings

Single route `/settings`. Tab set conditional on `orgType` from `getOrgAccess`.

**Broker org tabs:**

1. **Organization** — name, website, slug (editable with uniqueness validation), industry (optional).
2. **Branding** — logo upload (reuses existing `iconStorageId`), accent color (hex, preview swatch), agent display name. Live preview card on the right.
3. **Team** — list of broker-org members from `orgMemberships`, invite form (reuses existing `orgInvitations`), role management (admin/member).
4. **Agent** — agent handle, email settings (reuses existing settings: `chatEmailNotifications`, `autoSendEmails`, `emailSendDelay`).
5. **Billing** — v1 placeholder card: "Billing is handled directly with your Clarity Labs contact." No UI.

**Client org tabs:** existing settings preserved unchanged.

Both share the same page chrome and tab framework. The branching happens inside `app/settings/page.tsx` via a tab-set factory keyed on `orgType`.

## Backend Additions (Summary)

### New tables

- `brokerActivity` (defined above).

### New queries

- `clients.listForBroker(brokerOrgId)`
- `brokerActivity.listPortfolio(brokerOrgId, opts)`
- `brokerActivity.listForClient(brokerOrgId, clientOrgId, opts)`

### New mutations

- `organizations.updateBrokerBranding(brokerOrgId, { brandingColor, agentDisplayName, logoStorageId })`
- `organizations.updateSlug(brokerOrgId, slug)` — with uniqueness check.

### New library

- `convex/lib/brokerActivity.ts` — `recordBrokerActivity(ctx, event)` helper.

### Access

Every new query/mutation calls `getOrgAccess` and the appropriate capability assert (`assertCanManageBroker` for settings, `assertBrokerOrg` for broker-scoped queries).

## Frontend Additions (Summary)

### New pages

- `app/clients/page.tsx` — client list.
- `app/clients/[clientOrgId]/layout.tsx` — header + tabs.
- `app/clients/[clientOrgId]/page.tsx` — Overview tab.
- `app/clients/[clientOrgId]/{passport,applications,policies,intelligence,activity}/page.tsx`.
- `app/activity/page.tsx` — portfolio activity feed.

### New components

- `components/client-list.tsx`
- `components/client-list-row.tsx`
- `components/invite-client-drawer.tsx`
- `components/client-detail-header.tsx`
- `components/activity-feed.tsx` — shared between portfolio and per-client views.
- `components/settings/broker-branding-tab.tsx`
- `components/settings/broker-team-tab.tsx`
- `components/settings/broker-billing-placeholder.tsx`

### Reused primitives

- `app-shell`, `app-sidebar` (org switcher gets broker/client grouping).
- `entity-preview-panel` for all drawer interactions.
- Existing settings page shell and tab framework.
- Existing `useCurrentOrg` hook (extended if needed to expose `orgType` and `accessType`).

## Out of Scope (Deferred to Later Subsystems)

- Passport editor and ACORD 125 fields (subsystem 3).
- Applications v2 builder (subsystem 4) — this shell renders existing `applicationSessions` as a placeholder.
- Integrations (subsystem 5) — no integrations tab for brokers in v1.
- Policy/quote ingestion UX improvements (subsystem 6) — reuses existing extraction/preview.
- Notifications (subsystem 7) — `notification_fired` event type is declared but unused in v1.
- Open API / MCP (subsystem 8).
- Prism → Glass rebrand strings — handled as a cross-cutting thread.
- Custom domains, per-broker email sending identity — deferred from foundation spec.
- Per-producer client assignment enforcement — `brokerClientAssignments` is informational in this subsystem (assigned producer renders but doesn't restrict access).
- Stats strip / portfolio overview on dashboard — deferred; revisit when brokers ask for it.
- Cross-client Applications / Policies top-level tabs — deferred; same.
