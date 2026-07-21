# Glass

Glass is Clarity Labs' insurance intelligence platform. It combines document extraction, conversational AI, org memory, broker/client workspaces, connected vendor/client access, and API/MCP surfaces in one system.

For contributor-facing implementation detail, see [AGENTS.md](AGENTS.md).

## What Glass Does

- Ingests insurance-related documents from email and uploads
- Extracts structured bound-policy, renewal, and supporting business data
- Builds a continuously-updated `orgMemory` layer
- Supports agent workflows for Q&A, policy-change requests, COI generation, and follow-up analysis
- Exposes capabilities through UI, REST API (`/api/v1/*`), and OAuth-authenticated MCP (`/mcp`)
- Lets client/customer orgs request read-only access to vendor org policies after vendor approval

## Stack

- Next.js 16 + React 19 + Tailwind 4
- Convex (DB, actions, scheduler, storage, vector search, HTTP)
- Vercel AI SDK (`ai`) for model execution + tool-enabled chat
- `@claritylabs/cl-sdk@4.4.0` for source-tree extraction and insurance-focused primitives
- Resend for email ingest and messaging workflows

## Getting Started

Glass standardizes on Node 24.x for the app, Convex Node actions, CLIs, and all
workers. `.nvmrc`, `.node-version`, package `engines`, and `convex.json` encode
that contract. On a Mac, the Conductor setup installs Homebrew `node@24` when it
is missing and always runs the workspace under that toolchain.

For a non-Conductor checkout:

```bash
nvm use
npm install
CONVEX_AGENT_MODE=anonymous npx convex dev
npm run dev
```

Then open `http://localhost:8080`.

### Conductor workspaces

New Conductor worktrees use `.conductor/settings.toml` and get a native Convex
deployment and database that belong only to that worktree. Workspace setup:

1. Installs Node 24 and the root and worker dependencies.
2. Reads the copied cloud-dev selection from `.env.local`, imports that
   deployment's environment variables into a new native local deployment, and
   replaces the worktree's Convex URLs with loopback URLs.
3. Forces local safety settings (`GLASS_ENV=local`, captured email, terminal
   iMessage, dev clear enabled), maps the copied `NEXT_PUBLIC_MAPBOX_TOKEN` to
   Convex `MAPBOX_ACCESS_TOKEN` for agent address validation, creates
   worktree-local worker secrets, and points Convex at the worktree's worker
   ports.
4. Pushes the schema/functions and seeds the new database once with a curated,
   minimal shared-dev fixture: `terry@claritylabs.inc` as an operator,
   Montgomery Risk with `terry@montgomeryrisk.com` as its admin, Cove with
   `adyan@cove.dev` as its admin, unique phone identities for both customer
   accounts, their broker/client relationship, and one final Cove policy.
   Montgomery Risk starts with broker white-labeling explicitly disabled, and
   setup fetches and saves the Montgomery Risk and Cove website favicons in the
   worktree's Convex file storage. The configured
   `IMESSAGE_TERMINAL_FROM_PHONE` is assigned to the Montgomery Risk admin so
   Spectrum starts in an org-scoped broker context. Setup then compiles the
   workers, starts Apple `container`, and builds worktree-tagged Linux/amd64
   worker images.

The imported environment includes provider/auth configuration but never cloud
database rows or files. Local database state and secrets persist under
gitignored `.convex/local/default/` and `.context/`. Rerunning setup preserves
the existing local database and does not reseed it. The fixture copies only a
small allowlist of identity, organization, relationship, and policy-summary
fields; it never copies shared-dev auth sessions, email content, documents,
storage objects, or operational history.

Conductor's archive hook deletes `.convex/local/default/`, including local data
and auth state, before the worktree is removed. Closing a Conductor tab or the
app does not archive the workspace and intentionally preserves its database for
the next run.

The default **Local dev** run template starts these foreground processes together:

- Glass on `http://localhost:$CONDUCTOR_PORT`
- `convex dev` with the worktree's native local database, including local
  email/OTP capture logs, on `$CONDUCTOR_PORT + 3` (client) and `+ 4` (HTTP actions)
- the Linux/amd64 extraction-worker container on `$CONDUCTOR_PORT + 1`
- the Spectrum terminal iMessage worker on `$CONDUCTOR_PORT + 2`

The Run terminal opens Spectrum's interactive TUI. Web, Convex, and extraction
output is written to `.context/logs/{web,convex,extraction}.log` so it does not
corrupt the TUI; local OTP/email capture remains available in `convex.log`.
Spectrum starts as the Montgomery Risk admin. Use `/whoami` to inspect the
current sender, `/as broker` for Montgomery Risk, `/as client` for Cove, and
`/as public` for the unlinked public-demo path. `/as +<E.164 phone>` can test an
explicit local identity; the following message uses the newly selected sender.
Conductor runs are concurrent: each worktree reserves one five-port namespace
from its unique `CONDUCTOR_PORT` (`+0` web, `+1` extraction, `+2` Spectrum,
`+3/+4` Convex), and the app/workers wait for that exact local instance before
starting. Explicit Convex ports avoid a Convex CLI collision edge case where
automatic fallback can select the same port for its client and HTTP services.
The extraction container uses a worktree-tagged image and a narrow bridge from
Apple's container network to that loopback-only Convex port.

The checked-in `.worktreeinclude` copies `.env.local` and worker-local env files
from the repository root. The copied root `.env.local` must initially select a
cloud dev deployment so setup can import its environment. Keep
`imessage-worker/.env.local` configured with a local test user's E.164
`IMESSAGE_TERMINAL_FROM_PHONE`; setup assigns that number to the seeded broker
admin and generates distinct client/public terminal aliases. Generated runtime
files and unique local worker secrets stay under gitignored `.context/` and
`.convex/`.

Native local Convex has no public URL. Real Resend inbound webhooks and real
Photon/iMessage callbacks cannot reach it directly. The default local workflow
therefore uses Convex email capture and Spectrum's terminal transport. Use the
shared cloud dev or staging lane when testing an integration that requires a
stable public callback URL. The mailbox cron image is built for parity but is
not started by default, because running it would scan connected mailboxes.
Automatic Convex AI-file refresh is also disabled so initial provisioning does
not rewrite committed agent skills and guidance; refresh those explicitly with
`npx convex ai-files install` when upgrading the repo's Convex guidance.

## Useful Commands

- `npm run build` - production build
- `npm run conductor:setup` - prepare a fresh Conductor worktree end to end
- `npm run conductor:dev` - start Glass, Convex, extraction, and Spectrum terminal
- `npm run lint` - ESLint
- `npm test` - run tests
- `npx tsc --noEmit` - Next.js TypeScript check
- `npx convex typecheck` - Convex type check
- `npx convex deploy --yes` - deploy Convex functions to prod
- `npm run container:doctor` - verify local Apple `container` prerequisites and installation
- `npm run container:system:start` - start or initialize Apple's local container service
- `npm run container:build:workers` - build all Railway worker images locally with Apple's `container` CLI for `linux/amd64`
- `npm run container:run:extraction-worker` / `npm run container:run:imessage-worker` / `npm run container:run:mailbox-scan-worker` - run a locally built worker image with the worker's `.env`

## Local Worker Containers

Production Railway worker services are Dockerfile-backed. Local worker image tests should use the same Dockerfiles through Apple's `container` CLI on Apple silicon Macs so local builds exercise the production container path.

Deployment environment policy is documented in [docs/deployment/environments.md](docs/deployment/environments.md). `main` is production, `staging` is shared deployed integration, and local worktrees use local containers instead of shared Railway workers.

Prerequisites:

- Apple silicon Mac
- macOS 26 or newer
- Apple `container` installed from the signed package at <https://github.com/apple/container/releases/latest>

Install or verify the CLI:

```bash
curl -fL -o /tmp/container-installer-signed.pkg \
  https://github.com/apple/container/releases/download/1.0.0/container-1.0.0-installer-signed.pkg
spctl --assess --type install -vv /tmp/container-installer-signed.pkg
pkgutil --check-signature /tmp/container-installer-signed.pkg
sudo installer -pkg /tmp/container-installer-signed.pkg -target /
npm run container:doctor
npm run container:system:start
```

The first `container system start` may prompt to install Apple's recommended Kata Linux kernel. In a non-interactive shell, run `yes | container system start`.

Build all worker images:

```bash
npm run container:build:workers
```

Run one worker image locally:

```bash
cp extraction-worker/.env.template extraction-worker/.env
npm run container:run:extraction-worker
```

Repeat with `imessage-worker/.env` or `mailbox-scan-worker/.env` for those services. The build scripts target `linux/amd64` and the run scripts use `--arch amd64`; this is intentional because production Railway runs Linux containers and the extraction worker currently validates the Linux x64 LiteParse native package.

## Environment

Common variables used across major workflows:

- `CONVEX_DEPLOYMENT`
- `PARALLEL_API_KEY` — default public web search and known-URL extraction provider
- `EXA_API_KEY` — optional Exa web retrieval override and compatibility fallback
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `DEEPSEEK_API_KEY`
- `AUTH_RESEND_KEY` — Resend API key (shared by all outbound email; not required for local capture with `GLASS_ENV=local` and `EMAIL_DELIVERY_MODE=capture`)
- `RESEND_WEBHOOK_SECRET`
- `GLASS_ENV` — runtime lane: `production`, `staging`, or `local`
- `EMAIL_DELIVERY_MODE` — outbound email policy: `live`, `restricted`, or `capture`. Use `capture` with `GLASS_ENV=local` to print full local email text/HTML and six-digit code candidates in the Convex terminal while skipping Resend. Non-local `capture` logs metadata only.
- `EMAIL_ALLOWED_RECIPIENT_DOMAINS` / `EMAIL_ALLOWED_RECIPIENTS` — allowlist for restricted staging delivery
- `EMAIL_REDIRECT_TO` — internal capture address for restricted staging delivery; local capture does not use a redirect address
- `EMAIL_SUBJECT_PREFIX` — optional prefix for restricted delivery subjects; staging defaults to `[STAGING]`
- `AGENT_DOMAIN` — verified Resend sending domain for agent mail. Defaults to `glass.insure`. Legacy inbound addresses at `glass.claritylabs.inc` and `dev.claritylabs.inc` remain recognized.
- `NOTIFICATION_EMAIL_DOMAIN` — verified Resend sending domain for system notifications. Defaults to `notifications.glass.insure`.
- `AUTH_EMAIL_DOMAIN` — verified Resend sending domain for OTP, auth, and invite mail. Defaults to `auth.glass.insure`.
- `CLIENT_PORTAL_URL` / `APP_SITE_URL` — client portal URL. Defaults to `https://app.glass.insure`.
- `glass.claritylabs.inc` is the legacy browser host and redirects to `app.glass.insure`.
- `AUTH_LINK_SITE_URL` — optional override for auth, login, signup, and invite links. Defaults to `https://app.glass.insure`; `auth.glass.insure` is only the default email sender domain.
- `AUTH_EMAIL_FROM` — optional `From:` override for OTP sign-in emails. Defaults to `Glass from Clarity Labs <noreply@auth.glass.insure>`.
- `SITE_URL` — legacy fallback for client-facing links when the newer portal URL variables are not set.

Not every flow requires every variable; requirements depend on which features you are running.

## Core Flows

### 1) Ingest + Extract

1. Scan inboxes or accept uploads.
2. Store raw files in Convex storage.
3. Extract structured insurance/business data via `cl-sdk`.
4. Persist policy data and chunk + embed content for retrieval.
5. Write key facts into `orgMemory`.

### 2) Retrieval + Agent Chat

Agent responses are grounded in:

- `documentChunks` (bound-policy/supporting docs)
- `orgMemory` (organization facts)
- `conversationTurns` (cross-thread memory)

### 3) Connected vendor/client accounts

Client/customer orgs can request a one-way vendor relationship from Connected orgs in the main app menu by entering a vendor contact email. If the email belongs to an existing Glass user, Glass resolves that user's org and emails an approval link; otherwise Glass sends an invite link so the vendor can sign in, create/select their org, and approve access. Active relationships grant the client org read-only access to the vendor's public org profile and bound policy records; they do not grant uploads, deletes, email/thread access, broker-portal capabilities, or onward access to third-party orgs.

Connected vendor data is exposed in the same channels as first-party insurance data:

- Web app: Connected orgs in the main app menu for request/approval/revocation, and policy screens can read approved vendor org policies via the shared Convex access helper.
- REST API: `GET /api/v1/vendors`, `GET /api/v1/vendors/:id`, and `GET /api/v1/vendors/:id/policies`.
- MCP/CLI: `list_connected_vendors`, `get_connected_vendor`, and `list_connected_vendor_policies`.
- Agent: MCP chat receives connected-vendor roster context and directs callers to vendor tools for exact policy lists.

### 4) APIs

- REST API exposes broker/client/vendor resources under `/api/v1/*`
- MCP enables remote and local AI tool access

## Model Routing

Model routing is defined in `convex/lib/models.ts`:

- Defaults are broker-configurable in `/settings?section=models`; see `AGENTS.md` for the current opaque Glass defaults and fallback behavior.

Fallback logic retries supported calls on the configured fallback route. The static default is Fireworks DeepSeek V4 Pro.

## Convex Rule Of Thumb

Internal Convex functions do not have user auth context. Do not call public auth-dependent functions from internal actions.

## Key Files

- `convex/lib/models.ts` - model routing
- `convex/lib/sdkCallbacks.ts` - `cl-sdk` callback adapter
- `convex/lib/agentPrompts.ts` - retrieval context builders
- `convex/actions/extractPolicy.ts` - policy extraction entrypoint
- `convex/connectedOrgs.ts` - connected vendor/client relationship mutations and queries
- `convex/http.ts` - HTTP, REST, and MCP routes
