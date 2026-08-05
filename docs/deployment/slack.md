# Slack privileged service channel

Slack is Glass's privileged client service channel. Email and iMessage remain
AI-only. A Slack-enabled client has one customer-owned workspace connection and
one private `#glass-<client-slug>` Slack Connect channel hosted by
`claritylabsinc.slack.com`. Glass operators answer in that channel with their
normal Slack identities; the canonical conversation, agent actions, delivery
evidence, and failures are stored in Convex.

Staging and production must use separate distributed Slack apps and separate
Photon projects. The committed deployment map keeps both environments disabled
until their app, worker, secrets, and staging validation have been approved.
Do not reuse production credentials in staging or create a production app as
part of an ordinary code deployment.

Before customer OAuth, configure the environment's Slack app in its Photon
project. Either use Photon's manifest setup flow (`POST
/projects/{projectId}/slack/setup`) or upsert the credentials returned by Slack
to `PUT /projects/{projectId}/slack/`, then verify `GET
/projects/{projectId}/slack/` returns one active app config. The installation
endpoint returns `409` when this prerequisite is missing. A Slack workspace
admin config token is accepted only by the one-time manifest setup flow; never
send or persist it through the app-config endpoint or Convex.

## Slack and Photon configuration

Configure the customer-installed app with OAuth v2 and these bot token scopes:

- `app_mentions:read`
- `chat:write`
- `channels:read`, `channels:history`
- `groups:read`, `groups:history`
- `files:read`, `files:write`
- `users:read`

Subscribe Photon to messages that cover `app_mention`, public/private channel
messages, and message edits. Keep app uninstall, token revocation, and channel
lifecycle subscriptions enabled when Photon exposes those event types. Glass
currently treats edits as recorded revisions and does not regenerate an answer;
reactions and deletions do not affect agent behavior. Slack DMs are unsupported.
The bot must be installed in the customer workspace and invited to a channel
before Slack sends channel mentions to it.

Photon's serialized Slack message identifies the installation workspace but
does not guarantee the sender's native workspace. Before authorizing a message,
the Slack worker resolves the sender with Slack `users.info` using the existing
`users:read` scope. Convex retries when that lookup is unavailable and treats an
unresolved sender as unauthorized; it never assumes the sender belongs to the
customer workspace. This lookup is what distinguishes customer members, Glass
operators, and third-party Slack Connect participants.

Slack Connect events can be delivered through either installation. Convex maps
Clarity-side events through the binding's host team/channel pair and sends the
reply with the host installation; customer-side and other-channel traffic uses
the customer's installation. Do not collapse the two channel IDs or force all
outbound sends through the customer token.

Use these environment-specific HTTPS endpoints:

| Purpose | Endpoint |
| --- | --- |
| Slack OAuth redirect | `<CONVEX_SITE_URL>/slack/oauth/callback` |
| Photon signed webhook | `<CONVEX_SITE_URL>/spectrum-slack-inbound` |

Photon must sign the raw webhook body with the environment's signing secret.
Glass verifies the `v0:{timestamp}:{rawBody}` HMAC, rejects timestamps outside
the five-minute replay window, durably claims Photon and provider event IDs, and
acknowledges before processing. Do not put a JSON-rewriting proxy in front of
this route.

Install the same environment's app in the Clarity workspace as well. That
installation needs the customer scopes above plus `groups:write` and
`conversations.connect:write` so the operator onboarding action can create a
private channel and call `conversations.inviteShared`. If Slack reports a paid
plan, organization policy, or external-invitation restriction, the operator UI
returns a manual-setup instruction instead of pretending the invitation worked.

## Environment contract

Convex requires:

| Variable | Purpose |
| --- | --- |
| `SLACK_ENABLED` | `true` only after the lane passes the rollout gates |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Environment-specific Slack OAuth app |
| `SLACK_OAUTH_REDIRECT_URI` | Optional explicit callback; otherwise the Convex site callback above |
| `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET` | Register OAuth tokens with Photon and remove installations |
| `PHOTON_WEBHOOK_SIGNING_SECRET` | Verify the raw Photon webhook |
| `SLACK_CLARITY_TEAM_ID` | Clarity workspace installation used for Connect provisioning |
| `SLACK_WORKER_URL`, `SLACK_WORKER_SECRET` | Private outbound/attachment worker endpoint and bearer secret |
| `NEXT_PUBLIC_APP_URL` or `APP_URL` | Post-OAuth settings redirect |

The isolated Railway `slack-worker` requires `GLASS_ENV`,
`SLACK_WORKER_MODE=slack`, `SLACK_WORKER_SECRET`, `PHOTON_PROJECT_ID`,
`PHOTON_PROJECT_SECRET`, `SLACK_CLARITY_TEAM_ID`, and Railway's `PORT`. Its
`/health` response must report the expected environment and live mode before
`SLACK_ENABLED` is changed. Configure its public health URL through
`GLASS_STAGING_SLACK_WORKER_HEALTH_URL` or
`GLASS_PRODUCTION_SLACK_WORKER_HEALTH_URL`; set the matching deployment
configuration's Slack `required` flag only when the worker is part of that
lane's release contract.

Convex stores no Slack token. The OAuth action exchanges the code server-side,
validates the exact granted scope set, sends the bot token directly to Photon,
forwards Slack token-rotation refresh/expiry fields when Slack returns them,
and persists only workspace/app metadata. OAuth state is single-use,
organization-bound, hashed at rest, and expires after ten minutes. Reinstalling
the same workspace refreshes the connection; a second active customer workspace
for the client is rejected. Disconnect removes the Photon installation before
marking the Glass connection disconnected.

## Onboarding and operating model

1. A Glass operator records their Clarity `{teamId,userId}` identity in the
   operator client setup surface.
2. The operator creates `#glass-<client-slug>` and sends the Slack Connect
   invitation. If automated creation is unavailable, create the private Connect
   channel manually and bind its IDs through the audited setup action.
3. A client admin accepts the invitation, acknowledges that every participant
   in any invited channel can see Glass's responses, and installs the app with
   OAuth. If Slack assigns a different customer-side channel ID, the first
   `@Glass` mention in the new primary channel records that ID and completes the
   binding; make that first mention in the Connect channel, not another channel.
4. Confirm the workspace and primary channel health in Agent channels. Safe
   customer compliance/policy-change alerts and policy delivery default on;
   vendor alerts default off. Personal-mailbox, extraction, broker-internal,
   onboarding, and other operational notifications are never Slack-routed.
5. Invite `@Glass` only to approved customer or third-party channels. Connected
   customer workspace members have client-admin-equivalent agent authority;
   recognized Glass operators can pause service by replying. External
   participants cannot invoke Glass, although they can see responses in the
   shared channel.

The primary channel is recorded from connection onward. A mention starts or
resumes AI, unmentioned customer replies continue an active thread, an operator
reply pauses AI, and `@Glass resolve` closes the thread. Outside the primary
channel, only mentions and active-thread replies are retained. A human request
there posts only a link and content-free notice into the primary channel.

## Policy-delivery migration

Policy delivery is now client-owned. `deliveryOwnerOrgId` is intentionally
optional during the widening release so old broker-owned rows remain readable.
Run each backfill as a dry run, inspect its counts, then run the migration runner
on the approved lane:

```bash
npx convex run migrations:backfillPolicyDeliverySettingOwners '{"dryRun":true}'
npx convex run migrations:backfillPolicyDeliveryRuleOwners '{"dryRun":true}'
npx convex run migrations:backfillPolicyDeliveryJobOwners '{"dryRun":true}'
npx convex run migrations:backfillPolicyDeliveryAttemptOwners '{"dryRun":true}'
npx convex run migrations:runPolicyDeliveryOwnerBackfill
npx convex run policyDelivery:verifyDeliveryOwnerBackfill
```

The verifier must return zero missing owners before a later narrow release makes
`deliveryOwnerOrgId` required. Do not narrow in the same deployment that first
introduces the fields. `brokerOrgId` and `broker_review` remain optional legacy
context during and after the backfill.

## Rollout and rollback

Roll out one client at a time: local signed fixture and mock worker, internal
staging fixture, a real staging workspace, production shadow ingestion,
mentions, then proactive alerts and policy delivery. Before each progression,
run the Slack-focused tests, worker build/tests, root/Convex typechecks, lint,
build, worker checks, deployment health audit, and `git diff --check`.

For rollback, disable Slack for the client in Agent channels. For a lane-wide
stop, set `SLACK_ENABLED=false` and leave the durable records intact. Disconnect
only when the customer requests removal or the installation has been revoked;
disconnecting removes the Photon installation and prevents outbound retries.

Live OAuth, Slack Connect, Photon delivery, uninstall/revocation, and real file
round trips require usable staging credentials. Local fixture results do not
substitute for that gate.

After `npm run conductor:setup` and while `npm run conductor:dev` is running,
exercise the seeded Cove channel with:

```bash
npm run conductor:slack-fixture -- --text "<@U-GLASS> summarize my policy"
```

The command reads the worktree-only signing secret, signs the exact raw body,
and posts to native local Convex. The response is delivered through the local
mock worker and recorded in the same durable Slack tables as deployed traffic.
