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
| Convex | `CL_ROUTER_URL`, `CL_ROUTER_SECRET`, `CL_ROUTER_TASKS`, optional `CL_ROUTER_TIMEOUT_MS` |
| Extraction worker | `CL_ROUTER_URL`, `CL_ROUTER_SECRET`, `CL_ROUTER_TASKS`, `CL_ROUTER_TENANT_ID=glass`, optional `CL_ROUTER_TIMEOUT_MS` |
| cl-router | `GLASS_ENV`, `DATABASE_URL`, `CL_ROUTER_SECRET`, `CL_ROUTER_ADMIN_SECRET`, `CL_ROUTER_SESSION_HMAC_SECRET`, `CL_ROUTER_FROZEN`, `CL_ROUTER_SHADOW`, optional `CL_ROUTER_POLICY_REFRESH_MS`, `CL_ROUTER_SCORING_INTERVAL_MS`, and provider keys |

The inference, admin, and session-HMAC secrets must be distinct within each
lane as well as different between staging and production. Never give the admin
secret to Convex or a worker caller. Provider keys live
only in the router environment unless a broker route is selected; broker keys
then transit in the per-request resolved settings snapshot and must never be
logged.

Rollout is task-scoped through `CL_ROUTER_TASKS`. An empty value keeps the
existing direct-provider path. Enable classification, embeddings, and voice
transcription first; enable extraction only after the worker and cl-sdk prompt
versions match.

Do not enable a task whose generic callsites still pass AI SDK tools,
`stopWhen`, or other non-streaming options. Those enabled calls fail closed
rather than silently bypassing cl-router; move each callsite to the Glass-owned
cl-router language-model adapter first. Keep `chat`, `chat_vision`,
`query_reason`, and `*` disabled: web chat has an adapter, but iMessage, MCP,
and public-demo tool loops currently share those gates without compatible
adapters, so there is no channel-safe chat flag yet.

During the guarded rollout, Glass retries the direct path only for router
connection failures, timeouts, and HTTP 5xx. Authentication, validation, other
4xx responses, and malformed successful responses fail closed. Chat retains a
permanent direct break-glass path and never retries after visible streamed
output.

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
   and cost telemetry with the direct baseline.
6. Set both `CL_ROUTER_FROZEN=1` and `CL_ROUTER_SHADOW=1` throughout the
   two-week shadow period. Freeze prevents policy changes; shadow mode is the
   separate control that records the autonomous choice without executing it.
   Unfreeze one calibrated task family at a time only after three reproducible
   benchmark replicates and the onboarding gate pass. Change that lane's
   `clRouter.expectedFrozen` deployment expectation in the same PR as the
   approved unfreeze so the scheduled health audit keeps enforcing the intended
   state.
7. For rollback, clear `CL_ROUTER_TASKS`. Use `CL_ROUTER_FROZEN=1` or the admin
   freeze endpoint when routing must stop changing without disabling traffic.
