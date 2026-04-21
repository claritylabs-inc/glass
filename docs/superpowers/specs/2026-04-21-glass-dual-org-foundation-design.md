# Glass — Dual-Org Foundation Design

**Date:** 2026-04-21
**Status:** Draft — awaiting review
**Subsystem:** Foundation (first of several planned subsystems for Glass)

## Context

Glass is a new product experiment — an insurance broker client onboarding platform. This repo is currently a clone of Prism (an insurance intelligence platform for policyholders). This spec covers the **foundation** subsystem: the dual-org network model (brokers + clients), viewer roles, permission layer, invite/signup flows, and branding fields. All other product features (ACORD 125 passport, applications v2, integrations, open API/MCP, rebrand, etc.) are out of scope and will be tackled in subsequent specs.

## Decisions

| # | Decision |
|---|---|
| 1 | **Broker ↔ client cardinality:** 1 broker → N clients in v1. Schema designed to extend to M:N later without painful migration. Clients **must** have a broker. |
| 2 | **Data migration:** Clean slate. Glass is a new product; no migration from existing Prism data. Existing dev/prod data is wiped. |
| 3 | **Org type representation:** Single `organizations` table with a `type: "broker" \| "client"` discriminator. Type-specific fields are optional on the same row. Runtime guards enforce correctness at function boundaries. |
| 4 | **Cross-org user membership:** A user can belong to any number of orgs of any type (multi-org). Broker → client access is handled by a separate mechanism (the `brokerOrgId` link + permission layer), not by an additional `orgMemberships` row. |
| 5 | **Broker access scope into client orgs:** Scoped read + scoped write. Brokers see the client passport, applications they've sent, policies/quotes they've delivered, and a filtered intelligence view. They do NOT see raw emails, client-internal threads, or uploaded org context docs. Visibility split baked into the schema via a `visibility` field on internal tables. |
| 6 | **Role model:** `admin` / `member` on both org types, with a `brokerClientAssignments` table in the schema from day one. In v1 every broker user can access every client (permissive default); assignments become enforced later without schema change. |
| 7 | **White-label scope (v1):** Branding only — broker name, logo, accent color, agent display name, slug. No custom domains, no per-broker email sending identity (deferred). |
| 8 | **Client invite flow:** Both email invites (default, with optional passport prefill) and shareable broker links. Clients can invite teammates into their own org via existing `orgInvitations`. |
| 9 | **Broker signup:** Open signup. Minimal wizard + automatic website enrichment (same pattern as current Prism client enrichment) to populate broker context for agent prompts. |

## Schema Changes

### `organizations` — additions

```ts
type: v.union(v.literal("broker"), v.literal("client")),          // required
brokerOrgId: v.optional(v.id("organizations")),                   // set on client orgs only
slug: v.optional(v.string()),                                     // unique, [a-z0-9-]
brandingColor: v.optional(v.string()),                            // hex, broker orgs
agentDisplayName: v.optional(v.string()),                         // broker orgs
// logoStorageId reuses existing iconStorageId
```

Indexes: `by_type`, `by_brokerOrgId`, `by_slug`.

No other existing fields are removed; fields that are irrelevant to broker orgs (e.g. `primaryInsuranceContactId`, `coiHandling`) simply remain `undefined` on broker orgs.

### `brokerClientAssignments` — new

```ts
{
  orgId: v.id("organizations"),           // broker org
  clientOrgId: v.id("organizations"),     // client org
  producerId: v.id("users"),              // broker user
  role: v.union(v.literal("primary"), v.literal("secondary")),
  createdAt: v.number(),
}
```

Indexes: `by_orgId_clientOrgId`, `by_orgId_producerId`, `by_clientOrgId`.

**v1 behavior:** the permission layer does not consult this table for access decisions. Every broker-org member can access every client of that broker. The table is writable for preparatory UX but unenforced until a future subsystem turns it on.

### `clientInvitations` — new

```ts
{
  brokerOrgId: v.id("organizations"),
  clientOrgName: v.optional(v.string()),
  primaryContactEmail: v.optional(v.string()),
  primaryContactName: v.optional(v.string()),
  prefillPassport: v.optional(v.any()),
  invitedBy: v.id("users"),
  inviteTokenHash: v.string(),
  linkType: v.union(v.literal("email"), v.literal("shareable")),
  status: v.union(
    v.literal("pending"),
    v.literal("accepted"),
    v.literal("expired"),
    v.literal("revoked"),
  ),
  clientOrgId: v.optional(v.id("organizations")),   // set on acceptance (email) or most-recent (shareable)
  acceptedCount: v.optional(v.number()),            // shareable links may be accepted N times
  maxUses: v.optional(v.number()),                  // null = unlimited for shareable
  expiresAt: v.optional(v.number()),
  createdAt: v.number(),
}
```

Indexes: `by_tokenHash`, `by_brokerOrgId`, `by_status`.

Distinct from existing `orgInvitations` (which invites users into an *existing* org). `clientInvitations` creates a *new* client org on acceptance.

### Visibility markers on existing tables

Bake the broker-facing vs client-internal split into the schema by adding an optional `visibility` field to:

- `threads.visibility: v.optional(v.union(v.literal("broker_visible"), v.literal("client_internal")))` — default `client_internal` at write time; v1 always writes `client_internal`. Future sharing features can flip it.
- `orgDocuments.visibility` — same shape, same default.

Tables that are broker-facing by nature (`policies`, `applicationSessions`, future passport table, intelligence summary view) do not need the marker — their existence implies broker-visible.

Tables that are always client-internal by rule do not need the marker — the permission layer enforces the rule:
- `emailConnections`, `emails`, `agentConversations` (raw inbound/outbound), `webChats`, `webChatMessages`, `threadMessages` on `client_internal` threads.

### Intelligence read filter

`orgIntelligence` remains a single source of truth. Broker-of-client queries pass through a filter that drops entries whose `source` is `email` or `chat`. Client-member queries are unfiltered. No schema change.

## Permission Layer

New module: `convex/lib/access.ts`. Supersedes `convex/lib/orgAuth.ts` (kept temporarily as a thin wrapper, removed once all call sites are migrated).

### API

```ts
type OrgAccess = {
  userId: Id<"users">;
  org: Doc<"organizations">;
  orgType: "broker" | "client";
  accessType: "member" | "broker_of_client";
  role: "admin" | "member" | undefined;       // set when accessType = "member"
  brokerOrgId: Id<"organizations"> | undefined; // set when accessType = "broker_of_client"
};

requireAuth(ctx): { userId: Id<"users"> }
getOrgAccess(ctx, orgId): Promise<OrgAccess>   // throws "none" as unauthorized
```

### Resolution rules

1. If the authenticated user has an `orgMemberships` row for `orgId` → `accessType = "member"`.
2. Else if `orgId` is a client org AND the user is a member of that client's `brokerOrgId` → `accessType = "broker_of_client"`.
3. Else → throw `Unauthorized`.

### Capability helpers

Every public Convex function that takes an `orgId` calls `getOrgAccess` then one or more of:

```
assertCanReadPassport(access)               // member OR broker_of_client
assertCanEditPassport(access)               // member only
assertCanReadEmails(access)                 // member only
assertCanReadInternalThreads(access)        // member only
assertCanReadBrokerVisibleThreads(access)   // member OR broker_of_client
assertCanReadPolicies(access)               // member OR broker_of_client
assertCanUploadPolicy(access)               // member OR broker_of_client
assertCanSendApplication(access)            // broker_of_client only
assertCanCompleteApplication(access)        // member only
assertCanReadIntelligence(access): { sourceFilter?: (entry) => boolean }
assertCanManageBroker(access)               // member of broker org, role=admin
assertCanInviteClient(access)               // member of broker org
assertCanInviteTeammate(access)             // member, role=admin
assertBrokerOrg(access)                     // throws if orgType !== "broker"
assertClientOrg(access)                     // throws if orgType !== "client"
```

`assertCanReadIntelligence` returns an optional `sourceFilter` callback that excludes `source: "email" | "chat"` for `broker_of_client`.

### Thread visibility at read time

List queries for `threads` add `visibility = "broker_visible"` as a filter when `accessType = "broker_of_client"`. `threadMessages` queries inherit the parent thread's visibility.

### Guardrails

- `broker_of_client` is read-biased. Mutation helpers reject it by default; capabilities explicitly whitelist broker writes (upload policy, send application, revoke invitation).
- `assertBrokerOrg` / `assertClientOrg` are called at the top of type-specific functions to fail loud on mis-typed org IDs.

## Flows

### Broker signup (open)

1. Email + password sign-up (existing `@convex-dev/auth`).
2. Onboarding wizard:
   1. Broker org name
   2. Website (optional)
   3. Slug (validated: unique, lowercase, `[a-z0-9-]{3,40}`)
   4. Logo upload
   5. Agent display name
   6. Agent handle claim
3. On submit:
   - Create `organizations` row with `type: "broker"`, slug, branding fields.
   - Create `orgMemberships` row with `role: "admin"`.
   - Schedule `extractCompanyInfo` for website enrichment (writes into `organizations.context` and `orgIntelligence` keyed to the broker org).
4. Redirect to broker dashboard with "invite your first client" CTA.

### Client invite — email (default)

1. Broker opens "Invite client" form: client company name, primary contact name + email, optional passport prefill.
2. Server creates `clientInvitations` row with `linkType: "email"`, 32-byte random token, stored as `inviteTokenHash` (sha256 hex). `expiresAt` = now + 14 days.
3. Send branded Resend email to `primaryContactEmail` with `https://glass.app/invite/{token}` — uses broker logo, color, and `agentDisplayName` as the "from" name.
4. Client lands on `/invite/[token]`:
   - Page calls `clientInvitations.getByToken` (public, unauth) which returns broker name/logo and the prefilled company name.
   - Client creates user (password or OAuth), then confirms/edits company name.
5. Acceptance mutation `clientInvitations.accept` (public, unauth):
   - Creates `organizations` row with `type: "client"`, `brokerOrgId` set.
   - Creates `orgMemberships` row (client user → client org, role=admin).
   - Marks invitation `accepted` with `clientOrgId`.
   - Redirects into client onboarding (passport wizard — next subsystem).

### Client invite — shareable

1. Broker creates a `clientInvitations` row with `linkType: "shareable"`, `maxUses` optional, no expiry by default.
2. Broker copies `https://glass.app/invite/{token}` and distributes via their own channels.
3. Acceptance page additionally prompts for company name (no prefill). Each acceptance creates a new client org; `acceptedCount` increments. Revocation (`status = "revoked"`) or reaching `maxUses` causes subsequent acceptances to fail.

### Teammate invites

Unchanged — existing `orgInvitations` table and flows are reused on both broker and client orgs. Broker admins invite broker teammates; client admins invite client teammates. Role = admin or member.

### Revocation / expiry

- Email invites default 14-day expiry.
- Shareable links no expiry by default; revocable any time.
- Any pending invitation revocable by broker admins.
- Expired tokens render a clear error with "ask your broker to resend."

### New Convex functions

- `clientInvitations.createEmail` (broker, authenticated)
- `clientInvitations.createShareable` (broker, authenticated)
- `clientInvitations.revoke` (broker, authenticated)
- `clientInvitations.list` (broker, authenticated)
- `clientInvitations.getByToken` (public, unauth; returns broker branding fields and any prefill)
- `clientInvitations.accept` (public, unauth; creates user + client org in a transaction)

Acceptance endpoint is rate-limited by IP.

## Affected Code Surface

### Replaced / absorbed

- `convex/lib/auth.ts`, `convex/lib/orgAuth.ts` → wrapped by `convex/lib/access.ts`, then removed once callers migrate.

### Migrated to use `getOrgAccess` + capability asserts

Every Convex public function that takes an `orgId`. Inventory:

`orgs.ts`, `orgDocuments.ts`, `orgMemory.ts`, `intelligence.ts`, `businessContext.ts`, `policies.ts`, `policyFiles.ts`, `applicationSessions.ts`, `threads.ts`, `webChats.ts`, `agentConversations.ts`, `emails.ts`, `emailScanLogs.ts`, `connections.ts`, `notifications.ts`, `apiKeys.ts`, `oauth.ts`, `presence.ts`, `dreamLogs.ts`, plus actions that call into them (`convex/actions/*`).

Migration is per-file, not atomic — the compatibility wrapper allows old and new call sites to coexist during the move.

### Schema file

Additions above. No field removals.

### Next.js

- `/onboarding` splits into broker onboarding (new) and client onboarding (existing, reads `organizations.brokerOrgId` to apply white-label chrome).
- `/invite/[token]` new, broker-branded, unauth.
- Current "which org am I viewing" context extended to handle multi-org users and `broker_of_client` access. Single `useCurrentOrg` hook returns `{ orgId, orgType, accessType, role }`; active org stored in user session.

### MCP / API key auth

No foundation-layer change. Tokens are already org-scoped; broker-org tokens only reach broker-org data until the API subsystem is built out.

### Seed data

`convex/seed.ts` rewritten to create a demo broker org + 2 client orgs linked to it.

## Testing Strategy (outline)

- Unit tests on `getOrgAccess` covering: member, broker_of_client, cross-broker (fail), wrong-type (fail), no access (fail), permissive-assignment fallback.
- Integration test from seed: broker user reads client A policies (pass), reads client A raw emails (fail), reads client B anything after being removed from broker (fail).
- Invite flow end-to-end: create email invite → GET by token → accept → verify client org + membership + invitation status.
- Shareable link: accept twice, verify two distinct client orgs created, both linked to the broker.

## Out of Scope (Tracked for Later Subsystems)

- ACORD 125 passport fields and client onboarding wizard content (separate subsystem).
- Applications v2 (separate subsystem).
- Integrations (QuickBooks / Xero / Deel / Rippling / Plaid).
- Policy / quote ingestion rebrand beyond access control.
- Notifications cross-cutting to broker side.
- Open API / MCP redesign (OAuth scopes across broker/client access).
- White-label beyond branding: custom domains, per-broker email sending identity.
- Rebrand strings ("Prism" → "Glass") in UI, agent prompts, and email templates.
- Billing.
- Per-producer client assignment enforcement (schema exists; enforcement deferred).
- Merging Glass with Prism.
- Cryptographic / immutable data storage.
