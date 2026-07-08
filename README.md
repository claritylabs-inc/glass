# Glass

Glass is Clarity Labs' insurance intelligence platform. It combines document extraction, conversational AI, org memory, broker/client workspaces, connected vendor/client access, and API/MCP surfaces in one system.

For contributor-facing implementation detail, see [AGENTS.md](AGENTS.md).

## What Glass Does

- Ingests insurance-related documents from email and uploads
- Extracts structured bound-policy, renewal, and supporting business data
- Builds a continuously-updated `orgMemory` layer
- Supports agent workflows for Q&A, policy-change requests, COI generation, and follow-up analysis
- Exposes capabilities through UI, REST API (`/api/v1/*`), and MCP (`/mcp` + local server)
- Lets client/customer orgs request read-only access to vendor org policies after vendor approval

## Stack

- Next.js 16 + React 19 + Tailwind 4
- Convex (DB, actions, scheduler, storage, vector search, HTTP)
- Vercel AI SDK (`ai`) for model execution + tool-enabled chat
- `@claritylabs/cl-sdk@3.x` for source-tree extraction and insurance-focused primitives
- Resend for email ingest and messaging workflows

## Getting Started

```bash
npm install
npm run dev
npx convex dev
```

Then open `http://localhost:3000`.

## Useful Commands

- `npm run build` - production build
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
