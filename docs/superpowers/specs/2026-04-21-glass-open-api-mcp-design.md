# Glass — Open API + MCP Design

**Date:** 2026-04-21
**Status:** Draft — awaiting review
**Subsystem:** Open API + MCP over OAuth (subsystem 8)
**Depends on:** [foundation](./2026-04-21-glass-dual-org-foundation-design.md), all prior subsystems.

## Context

Glass exposes its platform to external integrations and AI agents via two surfaces on the same OAuth:

- A **REST API** (`/api/v1/...`) for programmatic integrations — broker back-office, client ERP syncs, analytics tools.
- An **MCP interface** for AI tools (Claude Desktop, other agents). Extends prism's existing MCP tool set to cover broker operations and the dual-org access model.

Both surfaces share the underlying Convex query/mutation layer — all business logic and permission checks live there; the API layers are thin adapters. Existing prism OAuth infra (`oauthClients`, `oauthAuthCodes`, `oauthTokens`, `mcpAuth.ts`) is extended rather than replaced.

## Decisions

| # | Decision |
|---|---|
| 1 | **Two surfaces:** REST API under `/api/v1/*` + MCP interface. Same OAuth, different endpoints, different shapes. |
| 2 | **Token binding:** user-scoped. Token represents a user with all their orgs/access. Every request picks an org (header `X-Org-Id`). `getOrgAccess` handles the dual-org case (member vs broker_of_client) identically to the app. |
| 3 | **Scopes (v1):** coarse — `read` and `write`. No fine-grained per-resource scopes in v1. |
| 4 | **Operation coverage:** read + safe writes. No deletes, no integration disconnects, no invitation revocation via API. |

## OAuth Flow

Existing prism OAuth implementation (authorization code + PKCE) is kept. Changes:

### `oauthTokens` — extend

```ts
scopes: v.optional(v.array(v.union(v.literal("read"), v.literal("write")))),
```

Absence of the field (legacy tokens) is treated as `["read"]` — defensively narrow.

### `oauthAuthCodes` — extend

Same `scopes` field; captured at consent time.

### `oauthClients` — extend

```ts
name: v.string(),
description: v.optional(v.string()),
redirectUris: v.array(v.string()),
tokenEndpointAuthMethod: v.string(),
allowedScopes: v.optional(v.array(v.string())),  // cap per-client
createdAt: v.number(),
```

Client registration remains manual / invite-only in v1 (prism already works this way) — we do not ship a public "developer portal" yet.

### Authorization endpoint

`/oauth/authorize` — existing, extended:
- New `scope` param (`read` or `read write`).
- Consent screen shows the requested scopes and the user's current orgs (informational — token applies to all orgs the user has access to; the app using the token picks which org to act on per request).

### Token endpoint

`/oauth/token` — existing, extended to issue tokens with the granted scopes.

### Token introspection / revocation

- `/oauth/revoke` — new; per RFC 7009. Calls `oauthTokens.revoke` which sets `revokedAt`.
- `/oauth/introspect` — existing; extended response includes `scope` and `active`.

## Shared Auth Middleware

New `convex/lib/apiAuth.ts`:

```ts
async function authenticateRequest({
  bearer: string,
  orgIdHeader: string | undefined,
  requiredScope: "read" | "write",
}): Promise<{
  userId: Id<"users">,
  orgId: Id<"organizations">,
  access: OrgAccess,   // from foundation access.ts
  scopes: ("read" | "write")[],
}>
```

Steps:
1. Hash bearer token, look up `oauthTokens`, verify `!revokedAt` and `expiresAt > now`.
2. Verify `requiredScope` is in `scopes`.
3. Require `X-Org-Id` header on every request (reject 400 if missing).
4. Call `getOrgAccess(ctx, orgId)` with the token's `userId`.
5. Return the resolved identity.

Applied to every REST route and every MCP tool invocation.

## REST API

### Versioning

- `/api/v1/*`. Additive changes are non-breaking. Breaking changes bump to `/api/v2`.
- Version lives in the path, not a header.

### Error shape

```json
{
  "error": {
    "code": "forbidden",
    "message": "Broker users cannot edit client passport fields",
    "request_id": "req_01H..."
  }
}
```

Error codes mirror HTTP semantics: `unauthorized` (401), `forbidden` (403), `not_found` (404), `bad_request` (400), `rate_limited` (429), `server_error` (500).

### DTO shape

Response shapes are **external DTOs**, not raw Convex docs. A thin `convex/lib/apiDto.ts` provides per-resource serializers so internal schema changes don't leak to API consumers. Keys are snake_case (ecosystem convention for REST); MCP tool shapes keep camelCase (ecosystem convention for tools / JSON Schema).

### Resources

All routes require `Authorization: Bearer <token>` and `X-Org-Id: <id>`. All routes respect `getOrgAccess` capability asserts.

#### Organizations (self)

- `GET /api/v1/me` — current user + accessible orgs summary.
- `GET /api/v1/org` — current org (scoped by `X-Org-Id`).

#### Clients (broker-scoped)

- `GET /api/v1/clients` — list the broker's clients (requires broker org in `X-Org-Id`).
- `GET /api/v1/clients/{clientOrgId}` — detail.
- `POST /api/v1/clients/invitations` — create an email or shareable invite (write scope).

#### Passport

- `GET /api/v1/passport` — full passport for the scoped org (client orgs read own; broker orgs reading-as-broker must include the client in `X-Org-Id`).
- `PATCH /api/v1/passport` — edit (client members only; write scope).
- `GET /api/v1/passport/locations` / `POST` / `PATCH /{id}` — side table.
- Same pattern for `subsidiaries`, `prior-carriers`, `losses`, `additional-interests`.
- `GET /api/v1/passport/flags` — list broker flags.
- `POST /api/v1/passport/flags` — broker raises a flag (broker role; write scope).
- `PATCH /api/v1/passport/flags/{id}` — resolve / dismiss.

#### Applications

- `GET /api/v1/applications` — list applications visible to the scoped org.
- `GET /api/v1/applications/{id}` — full application (groups + questions + answers + flags).
- `POST /api/v1/applications` — create draft (broker; write).
- `POST /api/v1/applications/{id}/questions` — add question to draft (broker; write).
- `POST /api/v1/applications/{id}/send` — send to client (broker; write).
- `POST /api/v1/applications/{id}/answers` — upsert answers (client; write).
- `POST /api/v1/applications/{id}/groups/{groupId}/submit` — submit section (client; write).
- `POST /api/v1/applications/{id}/groups/{groupId}/accept` — broker accept section (broker; write).
- `POST /api/v1/applications/{id}/groups/{groupId}/return` — broker return section (broker; write).
- `POST /api/v1/applications/{id}/flags` — raise question flag (broker; write).
- `GET /api/v1/application-templates` — list templates available to the broker.

#### Policies & quotes

- `GET /api/v1/policies` — list (filter by `documentType=policy|quote`).
- `GET /api/v1/policies/{id}` — detail including extracted document.
- `POST /api/v1/policies` — upload (multipart; write). Body includes `document_type` and the file.

Destructive endpoints (DELETE) are not exposed in v1.

#### Intelligence

- `GET /api/v1/intelligence` — list (broker-of-client reads are filtered per foundation rules; `source=email|chat` excluded automatically).
- `GET /api/v1/intelligence/search?q=...` — vector search passthrough.

#### Integrations

- `GET /api/v1/integrations` — list connections visible to the caller (broker sees client connections in health-only form; client sees their own).
- `POST /api/v1/integrations/link-tokens` — request a Merge link token (client; write).
- Request / disconnect endpoints NOT exposed in v1 (broker request-to-connect lives in-app only; disconnect is destructive).

#### Notifications

- `GET /api/v1/notifications` — inbox.
- `POST /api/v1/notifications/{id}/read` — mark read (write).
- `POST /api/v1/notifications/read-all` — (write).

#### Activity

- `GET /api/v1/activity` — portfolio feed (broker) or per-client (when `X-Org-Id` is a client org and caller is the broker).

### Pagination

Cursor-based. Standard shape:

```json
{
  "data": [...],
  "next_cursor": "opaque_string_or_null"
}
```

`limit` query param capped at 100.

### Rate limiting

- Per-token: 600 requests / minute burst, 20 requests / second sustained.
- Exceed returns 429 with `Retry-After`.
- Implemented via an in-memory counter in the auth middleware (Convex scheduled cleanup). Persistent limits move to a durable store when traffic warrants.

### Audit logging

Every write request logs to a new `apiAuditLog` table:

```ts
{
  tokenId: v.id("oauthTokens"),
  userId: v.id("users"),
  orgId: v.id("organizations"),
  method: v.string(),
  path: v.string(),
  status: v.number(),
  requestId: v.string(),
  errorCode: v.optional(v.string()),
  createdAt: v.number(),
}
```

Reads are not logged individually (too noisy); rate-limit counters provide enough observability.

## MCP

### Keep the existing MCP scaffold

Existing prism tools (`get_org_info`, `get_business_context`, `update_business_context`, `ask_prism`, `list_policies`, `get_policy`, `search_policies`, `list_quotes`, `get_quote`, `list_applications`, `get_application`, `list_threads`, `get_thread_messages`, `get_policy_stats`) remain. Renames:

- `ask_prism` → `ask_glass` (rebrand; alias keeps working).
- `get_business_context` / `update_business_context` — kept name, behavior unchanged, but data now routes through `orgIntelligence` + passport fan-out.

### New broker-side MCP tools

- `list_clients(brokerOrgId?)` — enumerate the broker's clients. `brokerOrgId` optional; defaults to `X-Org-Id`.
- `get_client(clientOrgId)` — passport summary + policy counts + activity summary.
- `list_applications_for_client(clientOrgId, status?)`
- `get_application(applicationId)` — same as existing but available to both broker and client roles.
- `create_application_draft({ clientOrgId, creationPath, title, lineOfBusiness? })` — write.
- `add_application_question({ applicationId, intentKey?, customPrompt?, answerType?, required })` — write.
- `send_application({ applicationId })` — write.
- `raise_passport_flag({ clientOrgId, fieldPath, message })` — broker only; write.
- `list_broker_activity({ clientOrgId?, since?, types? })`

### New client-side MCP tools

- `get_passport()` — full passport for the caller's client org.
- `update_passport({ patch })` — write; capability-gated.
- `answer_application_question({ applicationId, questionId, rowKey?, value })` — write.
- `submit_application_section({ applicationId, groupId })` — write.
- `list_my_policies()`, `get_policy(policyId)` — same as existing but explicitly scoped.
- `list_integrations()` — connection health only.
- `request_integration_link_token({ category })` — client-authed write; returns the Merge link token for use in a Link widget the agent UI opens.

### Tool scoping & auth

- Every MCP tool invocation runs through `apiAuth.authenticateRequest` with the tool's required scope and `X-Org-Id` from the MCP session metadata.
- Tool descriptions explicitly state which role they require ("broker only", "client only"); invocation from the wrong role returns a structured error the agent can reason about rather than silently succeeding.

### MCP server surface

- Remote MCP over the existing Convex HTTP handlers — extended to handle the new tools.
- Local MCP under `mcp-server/` extended the same way.
- Tool catalog metadata updated to reflect renames and additions.

## Shared Convex Layer

Both REST and MCP call into the same **typed, permission-checked** Convex queries and mutations defined across subsystems 1–7. Neither interface implements its own business logic.

A thin adapter layer per-resource translates between external DTO and internal args:

```
convex/api/
  ├─ adapters/
  │   ├─ passport.ts        // REST/MCP ↔ Convex passport mutations
  │   ├─ applications.ts
  │   ├─ policies.ts
  │   ├─ integrations.ts
  │   ├─ notifications.ts
  │   └─ activity.ts
  ├─ rest/                  // Next.js route handlers that use adapters
  └─ mcp/                   // MCP tool handlers that use adapters
```

This structure is new to the repo. Existing mixed files (`convex/actions/mcpChat.ts`, `convex/lib/mcpAuth.ts`) are gradually migrated here; nothing is renamed in this spec other than what `ask_prism` → `ask_glass` demands.

## Developer Experience

### Discovery

- `/api/v1/openapi.json` — machine-readable schema for REST endpoints.
- `/.well-known/mcp.json` — standard MCP discovery doc pointing at the MCP endpoint + server metadata.
- Internal docs live in `docs/api/` (new directory).

### Onboarding (v1 — invite-only)

- Clarity Labs staff manually creates `oauthClients` rows for partners via a seed / admin script.
- Future work: a developer portal (create/manage clients from the Glass UI). Out of scope.

## Testing Strategy (outline)

- Auth: `read`-scope token attempting a write returns 403 with `insufficient_scope`.
- Dual-org: broker-user token acting on a client org (via `X-Org-Id`) gets `broker_of_client` access; attempts to hit client-internal endpoints (e.g., raw emails) return 403.
- Snapshot tests for DTO shapes — prevent accidental schema leakage.
- Rate limit: burst over 20/s returns 429 with `Retry-After`.
- MCP: every broker tool rejected when the token-resolved `orgType` is `client`, and vice versa.
- Audit log rows written for every successful write.

## Out of Scope

- Fine-grained scopes (`read:policies`, `write:applications`, etc.).
- DELETE endpoints; destructive operations in general.
- Developer portal for self-service client registration.
- Webhook *outbound* deliveries (Glass pushing events to consumers) — inbound webhooks (like Merge's) are in subsystem 5; outbound is its own project.
- SDKs / client libraries — consumers use the OpenAPI spec to generate their own until there's demand.
- Per-organization rate limit overrides / enterprise tiers.
- API keys (non-OAuth static secrets for server-to-server). OAuth client-credentials flow could come later; for now all API access is user-bound.
