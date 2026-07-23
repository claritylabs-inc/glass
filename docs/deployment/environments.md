# Deployment environments

`config/deployments.json` is the machine-readable environment map. `main` is
production, `staging` is the shared integration lane, and each Conductor
worktree uses native local Convex plus local workers.

## cl-router

`cl-router` is a separate Node 24/Fastify service with its own Railway
Postgres database. Glass and the extraction worker call it over authenticated
TLS; the router never calls Convex.

Every deployed lane needs matching values:

| Runtime | Required values |
| --- | --- |
| Convex | `CL_ROUTER_URL`, `CL_ROUTER_SECRET`, `CL_ROUTER_TASKS`, optional `CL_ROUTER_TIMEOUT_MS`; `CL_ROUTER_ADMIN_SECRET` only when the authenticated `/operator/routing` read surface is enabled |
| Extraction worker | `CL_ROUTER_URL`, `CL_ROUTER_SECRET`, `CL_ROUTER_TASKS`, `CL_ROUTER_TENANT_ID=glass`, optional `CL_ROUTER_TIMEOUT_MS` |
| cl-router | `GLASS_ENV`, `DATABASE_URL`, `CL_ROUTER_SECRET`, `CL_ROUTER_ADMIN_SECRET`, `CL_ROUTER_SESSION_HMAC_SECRET`, `CL_ROUTER_FROZEN`, `CL_ROUTER_SHADOW`, optional `CL_ROUTER_POLICY_REFRESH_MS`, `CL_ROUTER_SCORING_INTERVAL_MS`, and provider keys |

The inference, admin, and session-HMAC secrets must be distinct within each
lane as well as different between staging and production. The admin secret may
be copied only to Convex for the operator-authenticated, server-side
`clRouterOperations.getDashboard` action, which calls the read-only
`/admin/policy` and `/admin/rollups` endpoints. Never expose it to browsers or
configure it on extraction, iMessage, or mailbox workers. Provider keys live
only in the router environment unless a broker route is selected; broker keys
then transit in the per-request resolved settings snapshot and must never be
logged.

Rollout is task-scoped through `CL_ROUTER_TASKS`. An empty value keeps the
existing direct-provider path. Enable classification, embeddings, and voice
transcription first; enable extraction only after the worker and cl-sdk prompt
versions match.

Tool-bearing agent loops use `getAgentLanguageModelForOrg`,
`getAgentLanguageModelForPublicTask`, `generateAgentTextForOrg`, or
`generateAgentTextForPublicTask`. These helpers preserve AI SDK tools and
`stopWhen`, require stable run and surface metadata, select through cl-router
once, pin the chosen route for the remaining steps, and disable router fallback
after the first successful model step. A pre-response connection, timeout, or
5xx failure switches the entire run to its direct break-glass model. Generic
text/object helpers still fail closed when passed tool-loop-only options.

Staging and production may append `chat`, `chat_vision`, `email_draft`,
`email_reply`, and `mailbox_coordinator` to `CL_ROUTER_TASKS` while both
`CL_ROUTER_FROZEN=1` and `CL_ROUTER_SHADOW=1` remain set. This routes web,
iMessage, MCP, public-demo, inbound-email, email-draft, and mailbox-coordinator
steps through the pinned adapter without permitting autonomous execution-route
changes. Do not enable `*`: task gates remain an explicit rollback boundary.

The exact-pinned `@claritylabs/cl-router-policy` 0.1.0 contract does not yet
declare function-tool or structured-output capability flags. Glass validates
function-tool schemas and fails closed on unsupported adapter inputs, but
candidate elimination must be added in the shared policy and cl-router service
before any tool-bearing task is unfrozen. Do not duplicate a model capability
allowlist in Glass.

During the guarded rollout, Glass uses the direct path only for router
connection failures, timeouts, and HTTP 5xx before the first successful model
step. Authentication, validation, other 4xx responses, malformed successful
responses, and every failure after a successful step fail closed. Chat retains
a permanent direct break-glass path and never switches routes after visible
streamed output or a tool result.

`/operator/routing` combines router health, policy and hourly rollups with
30-day Glass routing events. It shows actual versus shadow routes, request IDs,
cost and failure aggregates, and agent workflow outcomes. Workflow feedback is
submitted only when tool results contain concrete workflow outcomes; an HTTP
200 by itself is never scored as success.

Health URLs are configured through
`GLASS_STAGING_CL_ROUTER_HEALTH_URL` and
`GLASS_PRODUCTION_CL_ROUTER_HEALTH_URL`. The normal deployment audit includes
the router:

```bash
AGENT_HEALTH_ATTEMPTS=1 npm run check:agent-health -- --env=staging
```

The router must report the matching environment, a live database, and an
active or bootstrap-ready policy store. Before increasing traffic, exercise
`POST /admin/freeze`, clear the freeze, inspect `/admin/policy` and
`/admin/rollups`, then run `/admin/score` in the staging lane.

Local health checks skip cl-router unless `GLASS_CL_ROUTER_HEALTH_URL` is set,
because the default Conductor template does not start the separate repository.
Conductor setup also removes any imported shared-dev router flags, URL, secret,
and timeout from native-local Convex. Configure those values explicitly only
when deliberately running a local router.

## Promotion checklist

1. Run root CI, worker builds, Convex typecheck, and the cl-router OpenAPI and
   full checks.
2. Deploy cl-router and migrate its Postgres database before enabling any task
   flag in a caller.
3. Configure the same bearer secret in the caller and router for that lane.
4. Confirm `GET /health` and the Glass deployment health audit.
5. Enable one task family in staging and compare route, error, latency, token,
   cost, tool completion, and workflow-failure telemetry with the direct
   baseline in `/operator/routing`.
6. Set both `CL_ROUTER_FROZEN=1` and `CL_ROUTER_SHADOW=1` throughout the
   two-week shadow period. Freeze prevents policy changes; shadow mode is the
   separate control that records the autonomous choice without executing it.
   Unfreeze one calibrated task family at a time only after three reproducible
   benchmark replicates and the onboarding gate pass. Change that lane's
   `clRouter.expectedFrozen` deployment expectation in the same PR as the
   approved unfreeze so the scheduled health audit keeps enforcing the intended
   state.
7. Keep tool-bearing tasks frozen until the shared policy version explicitly
   filters candidates for function-tool support and the route has calibrated
   workflow-quality cases. Unfreeze read-only `chat`/`chat_vision` before
   side-effectful `email_reply` or `mailbox_coordinator`.
8. For rollback, clear `CL_ROUTER_TASKS`. Use `CL_ROUTER_FROZEN=1` or the admin
   freeze endpoint when routing must stop changing without disabling traffic.
