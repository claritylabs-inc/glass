# Deployment environments

`config/deployments.json` is the machine-readable environment map. `main` is
production, shared cloud dev is the deployed integration lane, and each
Conductor worktree uses native local Convex plus local workers.

## Coordinated release readiness

`.github/workflows/deploy-convex.yml` owns readiness for every commit pushed to
`main`; it is not path-filtered. After validation, the workflow:

1. deploys the commit's Convex functions to production;
2. waits for the exact commit's four established Railway contexts
   (`spot-extraction-worker`, `imessage-worker`, `slack-worker`, and
   `spot-mailbox-scan-worker`) plus `operator-imessage-worker` after its
   production health URL variable is configured, to report
   success, including explicit `No deployment needed` watch-path results;
3. runs the deployed Convex, extraction, iMessage, Slack, and cl-router
   compatibility audit; and
4. verifies the commit is still the branch head before emitting
   `release-ready-production`.

Vercel may build the production candidate in parallel, but the Spot Vercel
project must keep automatic production domain assignment enabled and configure
the GitHub `release-ready-production` check as a required Deployment Check. The
project check targets only `production`, uses the Git provider source with
external check name `release-ready-production`, requires no deployment URL,
blocks `deployment-alias`, and allows 1,800 seconds for the full release
workflow. Vercel then assigns every production alias, including
`app.spot.insure`, only after the release job succeeds. Changing the job name
requires updating the Vercel project check in the same rollout. A failed or
timed-out Convex deploy, Railway status, compatibility audit, or stale-head
check leaves the candidate unpromoted; use Vercel's explicit force-promotion
control only for an incident-approved bypass.

Railway Git autodeploy and every provisioned service-local watch path must remain
enabled. Unchanged workers satisfy the barrier with Railway's no-op status, and
the mailbox cron's Railway deployment status is its release signal because it
has no persistent HTTP process. Do not enable Railway **Wait for CI** for these
services: the release job itself waits for Railway and that setting would create
a cycle. Push-time health checks do not prove release readiness because they can
observe the previous healthy processes; the compatibility audit therefore runs
only after Convex and Railway are ready.
`agent-safeguards.yml` exposes the same production audit only as a manual
diagnostic; it has no recurring, push, or pull-request trigger.

Promotion-last removes the new-frontend/old-backend window, but distributed
runtimes are not atomic. Keep expand/contract compatibility for destructive
query-shape changes and version worker protocol changes so the old frontend and
workers remain compatible while the new backend rolls out.

The iMessage number follows the same expand-first rule. Browser surfaces prefer
`NEXT_PUBLIC_SPOT_IMESSAGE_NUMBER` and its `_DISPLAY` companion, and the worker
prefers `SPOT_IMESSAGE_CONTACT_PHONE` before the public Spot value. Both paths
temporarily fall back to the corresponding legacy `GLASS_*` variables until the
Spot values have been verified on every production target.

Internal operator iMessage uses a separate Photon project and isolated route on the
`operator-imessage-worker` Railway service
(`21ab337b-1f74-4cac-8654-fba5187c35a3`). Its production base URL is
`https://operator-imessage-worker-production.up.railway.app`. It reuses the
`imessage-worker` image with `IMESSAGE_CHANNEL_ROLE=operator`, but requires distinct
`OPERATOR_PHOTON_PROJECT_ID`, `OPERATOR_PHOTON_PROJECT_SECRET`, and
`OPERATOR_IMESSAGE_WORKER_SECRET` values. Its Convex callbacks are
`/operator-imessage-inbound` and `/operator-imessage-delivery-events`; do not
point the internal number at the customer routes or copy customer Photon
credentials into the operator service.

The authenticated Photon dashboard owns a Pro `Spot Operator` project separate
from the customer project. Pro supplies an unlimited shared iMessage route for
up to 100 explicitly registered users; it does not allocate a dedicated public
line. The current registered roster is intentionally limited to Terry Wang and
Adyan Tanver. Record the project ID, one-time project secret, assigned shared
line, and registered sender numbers in the team secret manager; never commit
them or place them in a shared `.env` file. Each registered sender number must
also belong to the matching active production operator user. The inbound route
normalizes that number and accepts it only when both Photon registration and the
Spot operator identity match; unknown and customer numbers fail closed.

Configure that Railway service with root directory `/imessage-worker` and
`imessage-worker/railway.operator.json`. Set `SPOT_ENV=production`,
`SPECTRUM_PROVIDER=imessage`, `OPERATOR_IMESSAGE_ENABLED=true`, and
`CONVEX_SITE_URL` alongside the operator-only credentials. Convex receives the
same operator worker secret plus `OPERATOR_IMESSAGE_ENABLED=true` and the
service's `OPERATOR_IMESSAGE_WORKER_URL`. Production must keep
`OPERATOR_IMESSAGE_TERMINAL_ENABLED` unset or false. Publish the service health
URL through the GitHub Actions variable
`SPOT_PRODUCTION_OPERATOR_IMESSAGE_WORKER_HEALTH_URL`.
Until the separate Photon project and Railway service have been provisioned,
leave that variable unset. The release barrier and compatibility audit then
remain merge-safe and continue enforcing the four established workers. Setting
the variable is the explicit enforcement flip: it adds the exact-commit
`Spot - operator-imessage-worker` status and requires both the operator worker
health contract and matching fail-closed Convex operator iMessage wiring.

Slack environment/app setup and the client-owned policy-delivery migration are
documented in [Slack privileged service channel](./slack.md). Production owns
the native Slack app and live worker; shared dev and local development use the
mock path. Photon is not part of the Slack deployment path.

## cl-router

`cl-router` is a separate Node 24/Fastify service with its own Railway
Postgres database. Spot and the extraction worker call it over authenticated
TLS; the router never calls Convex.

Every deployed lane needs matching values:

| Runtime           | Required values                                                                                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Convex            | `CL_ROUTER_URL`, `CL_ROUTER_SECRET`, `CL_ROUTER_TASKS`, optional `CL_ROUTER_TIMEOUT_MS`; `CL_ROUTER_ADMIN_SECRET` only when the authenticated `/operator/routing` control surface is enabled                                                                                         |
| Extraction worker | `CL_ROUTER_URL`, `CL_ROUTER_SECRET`, `CL_ROUTER_TASKS`, `CL_ROUTER_TENANT_ID=glass` (the stable opaque compatibility key for existing router state), optional `CL_ROUTER_TIMEOUT_MS`                                                                                                 |
| cl-router         | `SPOT_ENV`, `DATABASE_URL`, `CL_ROUTER_SECRET`, `CL_ROUTER_ADMIN_SECRET`, `CL_ROUTER_SESSION_HMAC_SECRET`, optional emergency `CL_ROUTER_FROZEN`, optional diagnostic `CL_ROUTER_SHADOW`, optional `CL_ROUTER_POLICY_REFRESH_MS`, `CL_ROUTER_SCORING_INTERVAL_MS`, and provider keys |

The inference, admin, and session-HMAC secrets must be distinct within each
lane and different between shared dev and production. The admin secret may
be copied only to Convex for the operator-authenticated, server-side
`clRouterOperations.getDashboard` and `setGlobalFreeze` actions. They call the
read-only policy and rollup endpoints and the versioned `/admin/freeze`
control. Never expose the secret to browsers or configure it on extraction,
iMessage, or mailbox workers. Provider keys live only in the router environment
unless a broker route is selected; broker keys then transit in the per-request
resolved settings snapshot and must never be logged.

Rollout is task-scoped through `CL_ROUTER_TASKS`, except authenticated
`query_reason`, which uses cl-router whenever `CL_ROUTER_URL` and
`CL_ROUTER_SECRET` are configured. An empty task list keeps other calls on the
existing direct-provider path. Enable classification, embeddings, and voice
transcription first; enable extraction only after the worker and cl-sdk prompt
versions match.

Tool-bearing agent loops use `getAgentLanguageModelForOrg`,
`getAgentLanguageModelForPublicTask`, `generateAgentTextForOrg`, or
`generateAgentTextForPublicTask`. These helpers preserve AI SDK tools and
`stopWhen`, require stable run and surface metadata, select through cl-router
once, pin the chosen route for the remaining steps, and disable router fallback
after the first successful model step. Routed generation carries one total
execution budget. Production may switch a no-tool call to the configured
fallback for typed pre-execution unavailability, a proven pre-connection
refusal/DNS failure, initial candidate exhaustion before visible output or tool
execution, or a blank/output-limited completion. `query_reason` always retains
a cross-provider router candidate even when a stale static settings snapshot
contains a same-provider fallback. A blank or truncated
turn that already completed tools instead receives one tool-free continuation
over the existing results, so imports and other actions are not replayed.
Generic text/object helpers still fail closed when passed tool-loop-only options.

Production may append `chat_vision`, `email_draft`,
`email_reply`, and `mailbox_coordinator` to `CL_ROUTER_TASKS`. Authenticated
web, iMessage, Slack, and MCP `query_reason` traffic is already router-owned;
these flags add image chat, public-demo base-chat calls, inbound email,
email-draft, and mailbox-coordinator steps. Do not enable `*`: task gates remain
an explicit rollback boundary for every family other than `query_reason`.

The exact-pinned `@claritylabs/cl-router-policy` contract owns model and task
capability metadata. Spot validates function-tool schemas and fails closed on
unsupported adapter inputs; do not duplicate a model capability allowlist in
Spot. Review the active candidates for tool and structured-output compatibility
before enabling autonomous selection for those task families.

Normal deployed operation leaves `CL_ROUTER_FROZEN=0` and
`CL_ROUTER_SHADOW=0` (or omits both variables). Authenticated operators use the
global freeze toggle on `/operator/routing`, which writes an immutable router
control version with the Spot operator ID in its reason. `CL_ROUTER_FROZEN=1`
is an environment-level panic switch for incidents where the operator surface
or admin API is unavailable; it deliberately cannot be overridden by the UI.
`CL_ROUTER_SHADOW=1` is a separate diagnostic override and is not controlled by
the freeze toggle.

During the guarded rollout, Spot uses direct break-glass only in production
before it has observed output or tool execution. Proven pre-connection outages,
the bounded initial interactive timeout, and typed candidate exhaustion are
eligible; authentication/validation failures, other 4xx responses, malformed
responses, and every failure after a successful step fail closed. Enabled tasks in local
and shared development also fail closed so analytics cannot be
silently bypassed. Chat never switches routes after visible streamed output or
a tool result.

`/operator/routing` combines router health, policy and hourly rollups with
30-day Spot routing events. It shows actual versus shadow routes, router-owned
request IDs, sanitized failed provider attempts, cost and failure aggregates,
and agent workflow outcomes, and owns the
authenticated global freeze toggle. An active operator can control the healthy
router configured by `CL_ROUTER_URL` from any Spot environment; the admin
secret remains server-side. Workflow feedback is submitted only when tool
results contain concrete workflow outcomes; an HTTP 200 by itself is never
scored as success.

The production router health URL is configured through
`SPOT_PRODUCTION_CL_ROUTER_HEALTH_URL`. The normal deployment audit includes
the router:

```bash
AGENT_HEALTH_ATTEMPTS=1 npm run check:agent-health -- --env=production
```

The router must report the matching environment, a live database, and an
active or bootstrap-ready policy store. Before increasing production traffic,
exercise the operator global freeze toggle in both directions, inspect
`/admin/policy` and `/admin/rollups`, then run `/admin/score` against shared dev
or during an explicitly controlled production rollout.

Local health checks skip cl-router unless `SPOT_CL_ROUTER_HEALTH_URL` is set,
because the default Conductor template does not start the separate repository.
Conductor setup keeps any imported router URL, admin secret, and timeout so
the operator routing dashboard can observe shared-dev routing, but removes the
imported task flags and caller secret so an isolated worktree cannot send
traffic through the shared router. Configure those values explicitly only when
deliberately running a local router.

## Promotion checklist

1. Run root CI, worker builds, Convex typecheck, and the cl-router OpenAPI and
   full checks.
2. Deploy cl-router and migrate its Postgres database before enabling any task
   flag in a caller.
3. Configure the same bearer secret in the caller and router for that lane.
4. Confirm `GET /health` and the Spot deployment health audit.
5. Validate the task family in shared dev, then enable it through an explicitly
   controlled production rollout. Compare route, error, latency, token, cost,
   tool completion, and workflow-failure telemetry with the direct baseline in
   `/operator/routing`.
6. Keep the router environment panic and diagnostic overrides off. Use the
   `/operator/routing` global freeze toggle when autonomous route changes should
   pause or resume, then verify the new posture in the same dashboard.
7. Review tool and structured-output compatibility plus calibrated workflow
   quality before enabling autonomous selection for a task family. Introduce
   read-only `chat`/`chat_vision` traffic before side-effectful `email_reply` or
   `mailbox_coordinator`.
8. For rollback, clear `CL_ROUTER_TASKS` for staged task families. Authenticated
   `query_reason` remains router-owned while router credentials are configured;
   use an operator model override for a targeted route, the operator global
   freeze for autonomous-routing incidents, or remove the router inference
   configuration for full direct-path break glass. Reserve
   `CL_ROUTER_FROZEN=1` for incidents where the control surface is unavailable.
