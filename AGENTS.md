# AGENTS.md

Guidance for any coding agent working in this repository: Codex, Claude Code, Cursor, or similar tools.

## Workflow

- After major architecture or data-flow changes, update `AGENTS.md`.
- Prefer documenting current behavior over planned behavior.
- Treat the Convex worktree as potentially dirty. Do not revert unrelated user changes.
- Use Node 22.x everywhere in this repository. `.nvmrc`, `.node-version`, package `engines`, Node-based Dockerfiles, and `convex.json` are the runtime contract; Conductor bootstraps Homebrew `node@22` and prepends it to `PATH`.
- Use `dayjs` for date parsing, formatting, comparisons, and timestamps in new or touched code instead of raw `Date.now()`, `Date.parse()`, or `new Date(...)`.
- Use the shared `PillButton` primitive for pill-shaped action buttons across app surfaces, including primary, secondary, destructive, footer, and app-shell actions. When an action needs native link or download behavior, render `PillButton` with `href`, `target`, `rel`, or `download` instead of hand-rolling rounded anchor/button classes. Raw `<button>` elements are for non-pill structural controls such as row targets, tabs, menu triggers, and icon/navigation controls.

## Commands

- `npm install` — install dependencies
- `npm run dev` — start the Next.js app
- `npm run conductor:setup` — install Node 22 and dependencies, provision/import/seed a worktree-native Convex deployment, prepare local worker env, start Apple `container`, and build worktree-tagged worker images
- `npm run conductor:dev` — start the Conductor-port Next app, `convex dev`, local extraction container, and Spectrum terminal iMessage worker as one foreground process group
- `npx convex dev` — start the deployment selected by this checkout; Conductor worktrees select their own native local backend
- `npx convex dev --once` — push schema/functions to the selected deployment once without keeping a watcher open
- `npx convex deploy --yes` — push Convex functions to production
- `npm run build` — production build
- `npm run lint` — repo-wide ESLint
- `npx tsc --noEmit` — TypeScript validation (Next.js)
- `npx convex typecheck` — TypeScript validation (Convex functions)
- `npm run check:cl-sdk-version` — verify the root app and extraction worker consume the same `@claritylabs/cl-sdk` package spec
- `npm run check:agent-workers` — build/syntax-check mission-critical Railway agent workers before deployment
- `npm run check:agent-health` — smoke-check production Convex agent config plus iMessage and extraction worker health
- `npm run container:doctor` — verify local Apple `container` prerequisites and installation
- `npm run container:system:start` — start or initialize Apple's local container service
- `npm run container:build:workers` — build all Railway worker Dockerfiles locally with Apple's `container` CLI for `linux/amd64` production parity
- `npm run container:run:extraction-worker`, `npm run container:run:imessage-worker`, `npm run container:run:mailbox-scan-worker` — run locally built worker images with each worker's `.env`
- `npm run operator:provision-broker -- --name "Broker Name" --admin-email "admin@example.com"` — repo wrapper around the private installable operator CLI for provisioning broker orgs/accounts without using the web app
- `npx convex run seed:seed` — seed demo data
- `npx convex run actions/backfillChunks:backfill --args '{"orgId":"..."}'` — embed existing documents for vector search

## DevOps Environment Map

Source control:

- GitHub repo: `claritylabs-inc/glass`, default branch `main`.
- Deployment environments are defined in `config/deployments.json`; operational runbook details live in `docs/deployment/environments.md`.
- `.github/workflows/deploy-convex.yml` deploys Convex on `main` and `staging` pushes that touch `convex/**`, `cli/**`, `operator-cli/**`, deployment config, root package files, or the workflow itself. `main` uses `CONVEX_DEPLOY_KEY` and can publish CLI packages after deploy; `staging` uses `CONVEX_DEPLOY_KEY_STAGING` and never publishes CLI packages.
- Vercel owns the Next.js frontend. Local Vercel project metadata is `.vercel/project.json` with project `glass` (`prj_ZegCP8JSt7ePV0qpG7I43l5XydCZ`). Vercel envs must include `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`, and `CONVEX_DEPLOYMENT` for Development/Preview/Production.

Convex:

- Dev deployment: `acoustic-caiman-755` (`https://acoustic-caiman-755.convex.cloud`, site `https://acoustic-caiman-755.convex.site`).
- Staging deployment: `flexible-greyhound-425` (`https://flexible-greyhound-425.convex.cloud`, site `https://flexible-greyhound-425.convex.site`) configured by `CONVEX_DEPLOY_KEY_STAGING`; staging URLs are supplied to GitHub health checks through `GLASS_STAGING_CONVEX_AGENT_HEALTH_URL`, `GLASS_STAGING_EXTRACTION_WORKER_HEALTH_URL`, and `GLASS_STAGING_IMESSAGE_WORKER_HEALTH_URL`.
- Production deployment: `merry-platypus-82` (`https://merry-platypus-82.convex.cloud`, site `https://merry-platypus-82.convex.site`).
- Production and staging use `EXTRACTION_WORKER_MODE=external`, `EXTRACTION_WORKER_SECRET`, `EXTRACTION_WORKER_URL`, `EXTRACTION_WORKER_EXPECTED_PROTOCOL_VERSION=source-tree-v1`, and `EXTRACTION_WORKER_EXPECTED_CL_SDK_VERSION` matching the deployed `extraction-worker` `@claritylabs/cl-sdk` package spec. When bumping `@claritylabs/cl-sdk`, update the Convex expected-version env for each environment as that environment's extraction worker rolls; a mismatch makes Convex reject worker claims before leasing jobs and can leave uploads sitting at "Extraction starts shortly."
- Each Conductor worktree owns a native local Convex deployment under `.convex/local/default/`; it does not use `acoustic-caiman-755` for ordinary local testing. Setup imports cloud-dev environment variables but not cloud data, seeds a fresh local database once, and then overrides `GLASS_ENV=local`, `ALLOW_DEV_CLEAR=true`, email capture, terminal iMessage, local worker URLs, and unique worker secrets. The shared dev deployment remains an integration lane. Production must not set dev-clear or terminal-iMessage flags.
- Set `GLASS_ENV=production`, `GLASS_ENV=staging`, or `GLASS_ENV=local` on every runtime. Health checks fail when a worker reports the wrong environment.

Railway project `Glass` (`21798fb8-c164-4eed-800c-c964978a9639`):

- Environment `dev` (`e71ed18f-c387-4b34-a9ca-4f900a4ed25f`) is wired to Convex dev.
- Environment `staging` (`2b25c797-7103-445c-ad1f-bebb412b82c5`) is wired to Convex staging and tracks the `staging` branch.
- Environment `production` (`b661c376-3de6-4b4e-a7ec-62ca7a9ffacf`) is wired to Convex production.
- `glass-extraction-worker` (`e8a4f55a-ae25-4d5e-ba0d-e18ea11271ac`) is rooted at `/extraction-worker`, uses `extraction-worker/railway.json`, deploys with `extraction-worker/Dockerfile`, serves HTTP on port `8080`, and starts with `node dist/index.js`. Public worker health URLs are `https://glass-extraction-worker-dev.up.railway.app/health`, `https://glass-extraction-worker-staging.up.railway.app/health`, and `https://glass-extraction-worker-production.up.railway.app/health`.
- `glass-mailbox-scan-worker` (`b368a536-816b-43f8-8aed-89d2e5163ace`) is rooted at `/mailbox-scan-worker`, uses `mailbox-scan-worker/railway.json`, deploys with `mailbox-scan-worker/Dockerfile`, and runs the `0 15 * * *` UTC cron against the matching Convex site URL with `node src/index.js`.
- `imessage-worker` (`e2f0798e-f97e-48a7-9f35-145b75e93e09`) is rooted at `imessage-worker`, uses `imessage-worker/railway.json`, deploys with `imessage-worker/Dockerfile`, serves the Railway-provided `PORT` with local fallback `3001`, runs terminal mode in dev/staging, and real Photon/iMessage mode only in production.
- Every Railway worker service should have a service-local `Dockerfile` and `railway.json` with `build.watchPatterns` scoped to its repo-root path (for example `/extraction-worker/**`). Without watch paths, docs-only and unrelated app pushes trigger unnecessary worker rebuilds.
- Local worker-image testing should use Apple's official `container` CLI installed from the signed package at `apple/container` releases. Do not manually extract the package payload as a substitute for installation; the package is non-relocatable, root-authenticated, and installs under `/usr/local`.
- First-time `container system start` may prompt to install the recommended Kata Linux kernel; use `yes | container system start` only in non-interactive agent shells.
- The local Apple `container` build scripts intentionally target `linux/amd64` and run with `--arch amd64` so the extraction worker validates the same Linux x64 LiteParse native package used by production containers.

Railway worker env wiring:

- Extraction worker requires `CONVEX_URL`, `EXTRACTION_WORKER_SECRET`, provider keys, and `EXTRACTION_WORKER_ID` (`railway-dev-extraction-worker`, `railway-staging-extraction-worker`, or `railway-production-extraction-worker`).
- `EXTRACTION_JOB_CONCURRENCY` controls how many full policy extraction jobs a single worker process leases at once. Keep the default conservative for PDF/model memory pressure, and raise it only after live worker health and extraction latency prove the container size can handle the load.
- Mailbox scan worker requires `CONVEX_SITE_URL` and `EMAIL_SCAN_CRON_SECRET`.
- iMessage worker requires `CONVEX_SITE_URL` and `IMESSAGE_WORKER_SECRET`; production also requires Photon credentials, `SPECTRUM_PROVIDER=imessage`, and `IMESSAGE_ENABLED=true`, while staging/local should use `SPECTRUM_PROVIDER=terminal`, `IMESSAGE_ENABLED=false`, and `IMESSAGE_TERMINAL_ENABLED=true`.
- Email sending defaults to live behavior unless `EMAIL_DELIVERY_MODE` is set. Production uses `EMAIL_DELIVERY_MODE=live`; staging uses `EMAIL_DELIVERY_MODE=restricted` plus `EMAIL_REDIRECT_TO=staging@claritylabs.inc` and allowlisted internal recipient domains. Local development uses `GLASS_ENV=local` plus `EMAIL_DELIVERY_MODE=capture`; Convex logs full local email text/HTML, six-digit OTP candidates, and attachment metadata, skips Resend entirely, and does not require `AUTH_RESEND_KEY`. Non-local `capture` remains metadata-only so staging/production logs do not expose message bodies.

Local email capture and OTP testing:

- For local sign-in, invite, and auth testing, get OTP codes from the `npx convex dev` terminal log, not Gmail, Resend, or redirected staging mail. The local capture block starts with `[glass:local-email-capture]` and includes `codeCandidates: ...`.
- For invite-link flows where the generic OTP email is suppressed because the invite token proves ownership, Glass logs a local capture block with `kind: suppressed-invite-otp`; use its `codeCandidates` value for automated or manual acceptance testing.
- For local email-content QA, keep the dev Convex deployment and shell env on `GLASS_ENV=local` and `EMAIL_DELIVERY_MODE=capture`, trigger the email path normally, and inspect the same capture block for `from`, `to`, `cc`, `bcc`, `subject`, `text`, `html`, and attachment metadata. Attachment bodies/base64 are intentionally not logged.
- If local OTP/content logs do not appear, verify `npx convex env get GLASS_ENV` returns `local`, `npx convex env get EMAIL_DELIVERY_MODE` returns `capture`, and restart the worktree's `npx convex dev` process. Do not add `--deployment dev`, which would inspect the shared cloud lane.

Conductor local development:

- Shared new-worktree defaults live in `.conductor/settings.toml`; `.worktreeinclude` copies root and worker `.env.local` files before setup runs.
- The default Local dev template reserves a five-port worktree namespace: `CONDUCTOR_PORT` for Next, `+1` for extraction, `+2` for Spectrum terminal, and `+3/+4` for Convex client/HTTP services.
- Conductor run mode is concurrent. Setup and runtime pass the worktree's explicit Convex ports because Convex 1.41 automatic collision fallback can select the same port for both local services. The frontend, extraction container, and Spectrum worker wait until the current worktree's watcher has written and started that exact backend before connecting.
- Generated worker runtime env files live under gitignored `.context/`. Setup forces terminal-mode iMessage locally, creates matching worktree-local secrets, and keeps real Photon credentials disabled. Worker images use `:conductor-<workspace>` tags so builds cannot overwrite another worktree's default image.
- Convex binds its native backend to macOS loopback. The extraction wrapper discovers Apple's default container-network gateway and opens a TCP bridge only on that gateway/Convex port, then overrides the container's `CONVEX_URL`; do not replace this with a shared cloud URL or a LAN-wide proxy.
- The full-stack Run terminal is reserved for Spectrum's interactive TUI. Next, Convex, and extraction logs are written to `.context/logs/`; local email and OTP capture is in `.context/logs/convex.log`.
- Native local Convex has no public URL. Resend inbound webhooks and real Photon callbacks require shared dev/staging or an explicit tunnel; local defaults are email capture and Spectrum terminal. The mailbox-scan worker image is built but its cron is intentionally not started by the default template.
- `convex.json` disables automatic Convex AI-file refresh so first-time local provisioning does not rewrite committed skills, guidelines, or `AGENTS.md`. Refresh those intentionally with `npx convex ai-files install` when upgrading the repo's Convex guidance.

Audit commands:

- `gh run list --branch main --limit 5` — latest GitHub deploy workflow status.
- `npx convex env list | sed -E 's/=.*$//' | sort` — current worktree-local Convex env keys only.
- `npx convex env list --deployment dev | sed -E 's/=.*$//' | sort` — shared cloud dev Convex env keys only.
- `npx convex env list --prod | sed -E 's/=.*$//' | sort` — production Convex env keys only.
- `railway status --json | jq '{project:{id,name}, environments:[.environments.edges[].node | {name, services:[.serviceInstances.edges[].node | {serviceName, source, latestDeployment:(.latestDeployment | {status, meta:{repo:.meta.repo, rootDirectory:.meta.rootDirectory, branch:.meta.branch, commitHash:.meta.commitHash, configFile:.meta.configFile}})}]}]}'` — Railway source/root/deployment audit.
- `curl -fsS https://glass-extraction-worker-dev.up.railway.app/health | jq .`, `curl -fsS https://glass-extraction-worker-staging.up.railway.app/health | jq .`, and `curl -fsS https://glass-extraction-worker-production.up.railway.app/health | jq .` — extraction worker health, protocol, SDK spec, and Convex target.
- `curl -fsS https://imessage-worker-staging.up.railway.app/health | jq .` and `curl -fsS https://glass-production-4618.up.railway.app/health | jq .` — iMessage worker health, transport, Photon/secret/Convex config, and Railway listener ports.
- `railway variable list --json -e dev -s glass-extraction-worker | jq -r 'keys[]' | sort` — Railway env key audit without printing values; change environment/service as needed.

## High-Level Architecture (v0.2.0)

Glass is an insurance intelligence platform built on Next.js + Convex. v0.2.0 is a deliberate simplification: the product is now focused on post-binding policies, renewals, an agentic chat assistant, an agentic inbound email agent, connected-mailbox automation, lightweight per-org knowledge store (`orgMemory`), and compliance workflows. Sales, application intake, unbound quote storage, the old Applications v2, Client Passport / ACORD 125, the old persisted inbox product, org context documents, and Merge.dev sync backend have all been removed from Glass.

Core layers:

- Frontend: Next.js 16 App Router, React 19, Tailwind 4
- Backend: Convex queries, mutations, actions, scheduler, file storage, vector search
- Browser sync: `@claritylabs/cl-sync` provides reusable IndexedDB-backed local-first sync primitives. The package is maintained as the sibling public package `../cl-sync`; Glass owns only its app-specific collections and cache policies under `lib/sync/`.
- AI runtime: Vercel AI SDK (`ai`)
- Extraction, query agent, and prompts: `@claritylabs/cl-sdk` v3 source-tree contract. Until every runtime dependency has the published v3 package, Glass normalizes v2-style `sourceSpans` into the same v3 `sourceNodes` / `operationalProfile` storage shape locally.
- Providers: Fireworks for default language routes, OpenAI for the current 1536-dimensional embedding route, plus broker/operator override providers where configured.
- PDF parsing: bound policy and renewal extraction use LiteParse/PDF.js source spans as the parser-neutral input. Glass builds/stores `sourceSpans` as the smallest PDF evidence layer, `sourceNodes` as the canonical hierarchy/search layer, and `operationalProfile` as a source-backed policy fact projection for policy lists, COIs, compliance, and comparisons. When the Railway extraction worker is available, Glass first preprocesses PDFs with LiteParse, building page/row/cell spans from positioned text, preserving bounding boxes for exact source citation highlights, and capturing bounded page screenshots for multimodal page-scoped model calls. If LiteParse fails or times out, Glass falls back to local PDF.js source spans. LiteParse is hosted inside `extraction-worker/`, not as a separate service, feature flag, or callback interception layer.
- Provisional extraction: new policy uploads enqueue a lightweight `policyExtractionPreviewQueue` job alongside the full extraction run. The worker uses LiteParse/PDF.js text and the `extraction_preview` model route to populate a bounded allowlist of policy fields on the existing policy row with `extractionDataStage: "preview"`, then the full extraction overwrites those fields and sets `extractionDataStage: "final"`. Agents, MCP policy summaries, and live compliance views can read preview policies. Duplicate detection, COI generation, policy delivery, source-backed fact confirmation, policy changes, endorsements, scheduled compliance notifications, and policy-delivery automation remain final-only.
- Email: outbound + inbound via Resend, plus user-connected generic IMAP mailboxes for live agent search/read and opt-in proactive policy, requirement, and company-context automation. The proactive scanner persists only cursor/outcome metadata and imports selected first-class artifacts; raw mailbox bodies remain remote. All outbound Resend calls go through `convex/lib/resend.ts` (`sendResendEmail`). The primary signed-in web app is `app.glass.insure` for both broker and client users; broker/client landing is role-based after sign-in. `glass.claritylabs.inc` is the legacy browser host and redirects to `app.glass.insure`. `auth.glass.insure` is an auth/invite email sender domain rather than a separate web app host. Agent mail defaults to `glass.insure`, notification mail defaults to `notifications.glass.insure`, and auth/invite mail defaults to `auth.glass.insure`; legacy inbound agent addresses at `glass.claritylabs.inc` and `dev.claritylabs.inc` remain recognized. Inbound webhook at `POST /resend-inbound`. Unrecognized senders to `agent@glass.insure` enter the constrained public demo agent instead of tenant-scoped email routing; public demo transcripts and raw logs are stored separately from org `threads`.
- Sales, applications, and unbound quotes: Glass does not own application intake, quote intake, quote storage, carrier submissions, or pre-bind sales workflows. Do not add `/applications` routes, application tables, application agent tools, stored quote listing tools, or quote upload modes back into Glass. Requests for applications, submissions, or unbound quotes should be routed to the separate sales/application product, while Glass continues to handle already-bound policies, renewals, endorsements, COIs, compliance, and broker follow-ups.
- Broker workspaces own client setup, certificates, policy delivery, and broker follow-ups. Glass no longer has a separate MGA/program-administrator tenant model, partner approval queues, partner programs, standing authorizations, or certified COI template overlays. Treat former MGA/program-admin workflows as broker-owned workflows. After deploying this removal, an operator can run `operator.cleanupRemovedProgramAdminData` once to delete legacy program-admin org rows and dropped program-admin tables.
- Broker contact identity for client orgs comes from `brokerClientAssignments`. Do not add static broker contact fields back to `organizations`; assignment rows carry the canonical producer/contact name, email, and phone used for broker follow-ups.
- UI forms should use the shared React select/dropdown primitives from `components/ui/select.tsx` or `components/ui/dropdown-menu.tsx` instead of native `<select>` elements. Multi-value business fields such as aliases, labels, categories, or tags should be stored and edited as lists, not comma-delimited text.
- Auth/loading: the app shell uses `GlassSyncProvider`, an inline minimal boot hint, and safe scoped cached shell records to avoid full-page skeletons on repeat visits after Convex verifies auth. Cached data must remain scoped by user/org and must be cleared on confirmed sign-out or auth failure. The production service worker in `public/sw.js` is limited to same-origin static assets and must not cache app HTML, API routes, OAuth, MCP, Convex, or other dynamic/authenticated responses.
- iMessage / Spectrum: Photon-backed iMessage is production-only. Set `IMESSAGE_ENABLED=true`, `IMESSAGE_WORKER_URL`, `IMESSAGE_WORKER_SECRET`, and `NEXT_PUBLIC_GLASS_IMESSAGE_NUMBER` only in production with the production Photon account. For dev/preview testing, keep `IMESSAGE_ENABLED` false and use the Spectrum Terminal provider in `imessage-worker` (`SPECTRUM_PROVIDER=terminal`, `IMESSAGE_TERMINAL_FROM_PHONE=<test user phone>`). Convex accepts terminal-driven inbound messages only when `IMESSAGE_TERMINAL_ENABLED=true`; do not set `NEXT_PUBLIC_GLASS_IMESSAGE_NUMBER` in dev/preview unless intentionally advertising a test line. iMessage direct chats and groups both enter through `/imessage-inbound`; group chats are keyed by Photon chat GUID and mirrored into `imessageChats` / `imessageParticipants` so Glass can distinguish linked users from anonymous participants. If no participant maps to a Glass user/org, the message enters the constrained public demo agent with simulated examples and sales transcript logging rather than org-scoped data access. If a thread originated on iMessage and a user later adds messages from web chat, Convex mirrors the web user message and Glass reply back through `imessage-worker` with explicit web-chat context; generated PDFs and other stored thread attachments should be sent through the same outbound worker path when resolvable. These web-to-iMessage sync sends must use stable `clientMessageId` idempotency keys and the `imessageOutboundSends` ledger so scheduler retries do not duplicate iMessage messages; the worker also treats duplicate `/send` requests with the same `clientMessageId` as already handled. The iMessage worker reports attachment delivery failures to Convex through `POST /imessage-delivery-events`; Convex appends a delivery-failure artifact and status note to the agent thread message so future turns know whether a PDF actually attached.

## Primitive Catalog And Reuse Rules

Before adding a new shared component, backend helper, schema field, workflow, agent tool, or cross-cutting abstraction, search this catalog and the named owner files with `rg`. Extend the existing primitive when the semantics match. Add a new primitive only when the existing one would become unclear or misleading. When creating, deleting, or materially changing a primitive, update this section and the reusable local skill at `.agents/skills/glass-primitives/SKILL.md` in the same change.

Use these owners as the first place to look:

- App shell and navigation: `components/app-shell.tsx`, `components/app-sidebar/*`, and `components/app-sidebar/nav-config.tsx` own sidebar layout, menu item styling, shortcuts, connect-feature menu visibility, and settings sidebar insertion. Route and action rows use `SidebarMenuItem`, and every sidebar tree uses `SidebarTooltipProvider` so tooltip timing, styling, keyboard hints, and cursor behavior stay consistent. Settings section identity and derived settings-section variants belong in `lib/settings-sections.ts`; do not create page-local settings nav arrays.
- Operational UI: use `components/ui/operational-panel.tsx` for dense panels, label/value rows, repeated operational sections, and operator-friendly information display. Use `components/ui/operational-toast.tsx` for compact Sonner custom status/progress toasts that need icons, descriptions, hover/focus reveal, or pill-button actions. Use `components/ui/auto-save-status.tsx` for the stable Saved/Saving/Unsaved/Not saved indicator on every save-on-change surface. Use `components/ui/message-meta-tag.tsx` for collapsed icon-first message metadata toggles such as sources, reasoning, confidence, tools, and attachments. Use `components/ui/pill-button.tsx` for pill-shaped actions, including anchors and download links. Use `components/ui/select.tsx`, `components/ui/dropdown-menu.tsx`, or `components/ui/searchable-select.tsx` instead of native selects. Use `components/settings/settings-switch.tsx` for settings toggles and `components/settings/feature-flag-toggle-row.tsx` for feature-flag rows.
- Brand and identity UI: `components/ui/brand-icon.tsx`, `components/ui/org-brand-icon.tsx`, and `components/ui/logo-icon.tsx` own rendered app/org marks. `lib/branding.ts` owns browser theme tokens, swatches, contrast helpers, and client-side logo color sampling. `lib/viewer-branding.ts` is a Next.js server-only bridge for app-shell metadata/Open Graph. `convex/lib/branding.ts` owns Convex-safe branding context and white-label gates, while `convex/lib/orgBranding.ts` attaches storage-backed org logo URLs to Convex query rows. `convex/lib/emailTemplate.ts` owns the shared email HTML shell and auth/invite bodies; `convex/lib/notificationEmailTemplate.ts` owns notification-specific email composition. Broker white-labeling takes priority over client branding; client logos are still visible when no broker override applies.
- Feature flags and beta features: `convex/lib/featureFlags.ts` is the only catalog for org-scoped feature flags. Store org overrides in `organizations.featureFlags`; do not add bespoke boolean feature fields to `organizations`. Client/org writes go through `orgs.setFeatureFlag`; operator writes go through `operator.setClientFeatureFlag`; UI checks use `isFeatureEnabled`. `/settings?section=beta` is the client-facing beta-feature surface.
- Current org context and cached app data: `lib/sync/use-cached-query.ts`, `lib/sync/glass-cached-queries.ts`, `lib/sync/operator-cached-queries.ts`, `lib/sync/use-local-first-auto-save.ts`, and `lib/sync/auto-save-sequencer.ts` own local-first query caching and optimistic updates. `useLocalFirstAutoSave` is the sole save-on-change primitive: use its `enabled`, `canSave`, and `delayMs` gates for validation-aware auto-save, pause `autoSave` while a long-form field is focused and call `saveNow` on blur, use `applyLocal` to synchronize shared cache only after the current backend intent succeeds, and await `saveNow` before dependent actions. The hook serializes backend flushes in intent order and suppresses callbacks for stale value/reset intents; `canSave` is a permission/validation gate rather than a dirty-state check, and identity or availability inputs must use current raw input as `valueKey`, not debounced validation input. Auto-save writes do not enter the durable sync outbox because stale form intents must not replay after reload; failed writes stay visible and require an explicit retry. Render `AutoSaveStatus` anywhere auto-save is active; completion is communicated inline, while the hook owns the deduplicated error toast, so do not add per-field success toasts. Reserve `saveNow({ force: true })` for derived legacy state that must be persisted even though its value key began as the local baseline. Do not add page-local debounced save effects. `hooks/use-current-org.tsx` exports the canonical lightweight viewer-org `useCurrentOrg` hook for app-shell and settings surfaces. `lib/hooks/use-active-org-context.ts` exports the URL-aware `useActiveOrgContext` hook for surfaces that can operate on a selected client org or need operator impersonation loading semantics. Do not add page-local viewer/org queries when one of these contracts fits.
- Auth, authorization, and operator access: `convex/lib/access.ts` owns customer org access, broker-of-client access, connected-client read access, and `assertCan*` guards. `convex/lib/operatorIdentity.ts` owns operator profiles, bootstrap, impersonation, and operator audit. API and MCP auth live in `convex/lib/apiAuth.ts`, `convex/lib/mcpAuth.ts`, and `convex/lib/threadAccess.ts`. Do not add ad hoc auth checks inside feature modules when an access primitive exists.
- Model routing and provider selection: `extraction-worker/src/modelRoutingPolicy.ts` owns static model route policy and budgets. `convex/lib/modelCatalog.ts` mirrors it for catalog labels/capabilities, and `convex/lib/models.ts` executes the chosen route with org/broker/operator overrides. Normal org-scoped text/object calls should use `generateTextForOrg` or `generateObjectForOrg`; public/default calls should use `generateTextForPublicTask` or `generateObjectForPublicTask`; streaming and SDK adapters may use the lower-level route primitives when they need custom execution. UI provider/model labels and logos should come from the centralized model catalog and logo primitives, not hardcoded page lists. Do not hardcode a model in extraction or agent code when a route exists or should exist.
- Policy extraction and source evidence: `extraction-worker/` owns external LiteParse/PDF.js preprocessing and policy extraction execution. Convex orchestration lives in `convex/actions/policyExtraction.ts`, `convex/lib/extraction.ts`, `convex/lib/pipelineMutations.ts`, `convex/lib/sourceTree.ts`, `convex/lib/policyDocumentStructure.ts`, `convex/lib/extractionPostProcess.ts`, `convex/lib/declarationFacts.ts`, `convex/lib/coverageBreakdown.ts`, `convex/lib/coverageNames.ts`, `convex/lib/coverageScoping.ts`, and `convex/lib/sdkCallbacks.ts`. Use source spans/source nodes/operational profile as the evidence path; do not reintroduce legacy PDF map or raw-PDF model paths. Operational coverage units carry optional ACORD `lineOfBusiness` metadata from `cl-sdk`; `convex/lib/coverageBreakdown.ts` owns grouping those units by LOB while preserving the flat `all` order and leaving ambiguous package rows unassigned.
- Policies, endorsements, and broker follow-ups: policy rows, ACORD lines of business, versions, and source-backed changes live behind `convex/policies.ts`, `convex/lib/linesOfBusiness.ts`, `convex/lib/policyVersioning.ts`, `convex/lib/policyLookup.ts`, and `convex/lib/policyTypes.ts`. Policy-update requests should draft broker emails through the generic email path rather than rebuilding policy-case UI.
- Certificates: `convex/certificates.ts`, `convex/certificateLifecycle.ts`, `convex/lib/workflows/certificateRequest.ts`, `convex/lib/certificateRequestGate.ts`, `convex/lib/certificateHolderPopulation.ts`, `convex/lib/certificateIdentity.ts`, `convex/lib/certificateHolderResolution.ts`, `convex/lib/certificateDescription.ts`, and `convex/lib/coiGenerator.ts` own COI lifecycle, holder records, holder identity resolution/reuse, additional-insured gating, versioning, model-assisted certificate description wording, and generated PDFs. Do not add MGA/program-admin, certified COI, partner approval, or template-overlay primitives back into Glass.
- Compliance and Connect: compliance requirements are typed rules owned by `convex/compliance.ts`, `convex/lib/complianceTypes.ts`, `convex/lib/complianceCheck.ts`, `convex/actions/complianceRequirements.ts`, `convex/actions/ownComplianceMonitor.ts`, `convex/lib/complianceAgent.ts`, and `convex/lib/vendorComplianceTools.ts`. Use `kind: "coverage" | "insurer" | "condition"` plus `scope: "own_org" | "vendors"`; coverage rules are ACORD line-of-business keyed and checked deterministically against structured policy coverages, while insurer standards and administrative conditions are manually verified through `complianceChecks`. The daily own-insurance monitor is independent of connected mailboxes, assesses final policies only, pauses while extraction is pending, and uses persisted compliance snapshots to alert on status changes or at most once every seven days. The `/compliance` surface groups first by source type/document context, then by coverage LOB, insurer standards, and conditions. Connect vendor/client relationships belong in `convex/connectedOrgs.ts` and the `/connect/*` surfaces. The `connect_features` feature flag gates Connect pages and vendor requirements UI for client orgs.
- Agent, chat, and task control: prompts and shared agent rules live in `convex/lib/agentPrompts.ts`; scope/context in `convex/lib/agentScope.ts`; tool definitions/execution/audit in `convex/lib/chatTools.ts`, `convex/lib/agentToolExecutors.ts`, and `convex/lib/agentToolAudit.ts`; thread history in `convex/lib/agentMessageHistory.ts`; deterministic reset/cancel controls in `convex/lib/taskControlIntent.ts`, `convex/lib/taskControlDecision.ts`, `convex/lib/webChatDeterministicControls.ts`, and `convex/lib/textChannelControls.ts`. `convex/lib/threadAccess.ts` owns thread visibility: `user_private` threads are readable and mutable only by `createdBy`, including personal-mailbox activity and linked-user direct iMessage conversations; iMessage groups remain org-visible.
- Email, notifications, and iMessage: outbound mail must go through `convex/lib/resend.ts`, with agent send attempts recorded through `convex/lib/emailDelivery.ts` and `convex/emailDeliveryAttempts.ts`. Email HTML shells live in `convex/lib/emailTemplate.ts`, notification emails in `convex/lib/notificationEmailTemplate.ts`, inbound email agent paths in `convex/lib/emailSubagent.ts` and `convex/lib/emailIntentGuards.ts`, notification behavior and proactive-channel inheritance in `convex/lib/notificationTypes.ts`, `convex/lib/notify.ts`, and `convex/notificationPreferences.ts`, draft lifecycle and artifacts in `convex/lib/emailWorkflow.ts`, `convex/lib/emailDraftService.ts`, `convex/lib/emailDraftArtifacts.ts`, `convex/lib/emailPayloadFields.ts`, and `pendingEmails`, deterministic text-channel email execution in `convex/lib/emailCommandExecutor.ts`, branding/sender identity in `convex/lib/emailIdentity.ts`, and iMessage/Spectrum paths in `convex/lib/imessage*.ts` plus `imessage-worker/`. Connected-mailbox access, scan cursors, and outcome ledgers belong in `convex/connectedEmail.ts`, `convex/actions/connectedEmail.ts` (interactive tools + import pipelines), `convex/actions/connectedEmailScan.ts` (proactive scan engine + manual date-range scans), `convex/lib/imapMailbox.ts` (shared IMAP/crypto helpers, node-only), and `convex/connectedEmailAutomation.ts`; `convex/lib/mailboxAutomation.ts` owns automation policy, decision sanitation, and supported-attachment classification. Settings UI belongs in `components/settings/email-connection-*.tsx`. Durable email drafts carry `sendBlockedReason` when recipient/subject/body/attachment uncertainty must block deterministic sends. Proactive email/iMessage delivery must go through `notify`; do not call channel workers directly or expose a notification channel whose sender path does not exist.
- Public APIs and integrations: REST route behavior must follow `convex/lib/apiAuth.ts`, `convex/lib/apiDto.ts`, and `convex/lib/apiError.ts`. MCP behavior belongs under `mcp-server/` and Convex MCP HTTP handlers, with tools limited to current policy, thread, org, agent, broker/client, certificate, and connected-vendor primitives.
- Worker and deployment primitives: Railway worker ownership, envs, health endpoints, and local Apple `container` parity commands are documented in the DevOps section above. Keep worker SDK versions aligned with Convex expected-version envs using `npm run check:cl-sdk-version`.

## Current Model Routing

Default model routing and model capability budgets live in [extraction-worker/src/modelRoutingPolicy.ts](extraction-worker/src/modelRoutingPolicy.ts). Convex consumes that shared policy through [convex/lib/modelCatalog.ts](convex/lib/modelCatalog.ts) and executes routes in [convex/lib/models.ts](convex/lib/models.ts); the extraction worker imports the same policy for its static defaults.

- `chat` → Fireworks `accounts/fireworks/models/deepseek-v4-flash` for low-latency interactive tool use
- `classification`, `triage`, `extraction`, `extraction_preview`, `requirement_extraction`, `org_memory_extraction`, `email_extraction`, `document_extraction` → Fireworks `accounts/fireworks/models/deepseek-v4-flash` for cheap structured work and high-volume extraction/classification calls
- `extraction_quality` → Fireworks `accounts/fireworks/models/deepseek-v4-flash` for proactive source-tree and operational-profile extraction
- `fallback` → Fireworks `accounts/fireworks/models/deepseek-v4-pro` for explicit fallback escalation
- `extraction_coverage_cleanup` → OpenAI `gpt-5.4-mini` by default for source-backed coverage repair. This remains an operator-configurable route and should not be hardcoded in extraction code.
- `email_draft`, `email_reply`, `analysis`, `summary`, `mailbox_coordinator` → Fireworks `accounts/fireworks/models/glm-5p2` for deliberate text reasoning, writing, and coordination
- `security` → Fireworks `accounts/fireworks/models/gpt-oss-safeguard-20b`
- `embeddings` → OpenAI `text-embedding-3-small` at 1536 dimensions until re-embedding and retrieval-shadow validation prove a Fireworks embedding route is safe

Usage notes:

- Broker admins can configure their own provider API keys and per-use-case model routes in `/settings?section=models`.
- Broker model settings are stored in `brokerModelSettings`, keyed by broker org. Client-org workflows inherit the managing broker's settings.
- Operators can configure global default routes in `/operator/models`; broker admins still only see provider-key-backed overrides for their own broker org.
- The broker UI never exposes Glass's exact default model configuration; broker model selectors unlock only for providers where the broker has supplied an API key.
- `embeddings` is routed separately from language-model use cases and is restricted to direct embedding providers. Embeddings remain 1536-dimensional to match Convex vector indexes.
- Default Fireworks language routes require `FIREWORKS_API_KEY` for direct provider calls. OpenAI embedding routes still require `OPENAI_API_KEY`. Glass model routing is direct-provider-only; do not use Vercel AI Gateway as a fallback for chat, extraction, provisional extraction, classification, embeddings, web retrieval, or any configured model route.
- Fireworks defaults should stay serverless until observed steady utilization, strict latency SLOs, or a fine-tuned model rollout justify an on-demand or dedicated deployment.
- Main org-aware actions use `generateTextForOrg(ctx, orgId, task, options)` and `generateObjectForOrg(ctx, orgId, task, options)`. These helpers apply broker/global/static route resolution, route-specific provider options, Fireworks structured-output normalization, and the configured fallback route. Use `generateTextForPublicTask` or `generateObjectForPublicTask` only for public demo or other non-tenant workflows. Do not call `getModelForOrg`, `getProviderOptionsForTask`, `generateTextWithFallback`, or `generateStructuredWithFallback` directly from feature actions unless the callsite is a streaming or SDK-adapter primitive that genuinely needs lower-level control.
- Model catalogs in [convex/lib/modelCatalog.ts](convex/lib/modelCatalog.ts) mirror Glass route labels, but runtime calls must be supported by the selected provider's direct SDK or OpenAI-compatible direct endpoint. Global model settings only expose and resolve direct-provider-supported routes with matching server env keys; broker overrides only resolve when the broker has supplied a key for a directly supported provider/model pair.
- SDK-facing extraction passes the org context into the SDK callbacks, so broker-owned provider keys and routes apply to `cl-sdk` model calls. SDK-facing workflows also pass task-specific model capability metadata from the shared route policy through `MODEL_CAPABILITIES` in [convex/lib/modelCatalog.ts](convex/lib/modelCatalog.ts), so `cl-sdk` can resolve budgets against the actual route for source-tree, operational-profile, coverage-cleanup, review, and lookup calls instead of using the generic focused-extraction route.
- Fireworks structured output uses [convex/lib/fireworksStructuredOutput.ts](convex/lib/fireworksStructuredOutput.ts) and the worker mirror in [extraction-worker/src/fireworksStructuredOutput.ts](extraction-worker/src/fireworksStructuredOutput.ts). The adapter converts Zod schemas to Fireworks-compatible JSON Schema by rewriting `oneOf` to `anyOf` and dropping provider-unsupported length, item-count, pattern, and property-name constraints while preserving local Zod validation on returned objects.
- Fireworks calls do not send OpenAI-style PDF file parts. Glass passes LiteParse/PDF.js text in prompts. Current Fireworks defaults are treated as text-only; bounded page screenshots are held back unless a selected non-Fireworks or future verified multimodal route supports image input.

Fallback behavior:

- If no broker key exists for a route, Glass uses the operator global default when present and otherwise the static `MODEL_ROUTING` default.
- If a global route targets a provider/model without direct runtime support or without the matching server-side provider key, Glass ignores that override and falls back to the static route for that task.
- If the selected static route is missing its direct provider key, Glass fails with a configuration error instead of trying Vercel AI Gateway or a hardcoded provider fallback.
- `generateTextWithFallback()` and `generateStructuredWithFallback()` use task-aware fallback policy. Missing API key errors are not retried, because retrying another model does not fix missing credentials and only adds latency. Low-cost extraction/classification calls do not generically escalate. SDK `taskKind`s that represent strict source-tree/profile generation, validation repair, ambiguous synthesis, unsupported source-evidence resolution, or high-risk packet generation may retry only through the configured `fallback` route in [convex/lib/modelCatalog.ts](convex/lib/modelCatalog.ts).
- Web chat streaming in [processThreadChat.ts](convex/actions/processThreadChat.ts) stays on the Fireworks DeepSeek V4 Flash route by default and retries transient provider `server_error` / 5xx stream failures once before any visible text, tool call, or side-effectful work has started. If a broker override is active, that retry may use the configured fallback route; otherwise it retries the same Fireworks route.

## Compliance Requirements

Glass now stores contractor/vendor and internal insurance requirements as typed rules. `insuranceRequirements.kind` is `coverage`, `insurer`, or `condition`; `scope` is `own_org` or `vendors`. Coverage rules are keyed by ACORD line-of-business code and store structured `limits[]`, optional deductible ceilings, provisions, and required forms. Insurer rules store carrier standards such as AM Best rating, financial size, and admitted-status requirements. Condition rules store administrative obligations such as cancellation notice, certificate delivery, claims reporting, or subcontractor insurance. Do not reintroduce `category`, `appliesTo`, `evaluationTarget`, or regex requirement semantics.

Uploaded or pasted sources are recorded in `requirementSourceDocuments`, and created requirements keep `sourceDocumentId`, `sourceDocumentName`, `sourceType`, `sourceExcerpt`, and optional source page fields. `/compliance` groups first by source type/document context so lease, client-contract, vendor-packet, manual, and other requirement sets remain distinguishable, then groups coverage rules by ACORD LOB with separate insurer-standard and condition sections.

Current check state lives in `complianceChecks`, keyed by requirement and subject org. `convex/lib/complianceCheck.ts` performs deterministic coverage checks against structured policy evidence: LOB equality, limit-kind comparisons, deductible ceilings, provision/form detection, expiration, and insured-name matching. Insurer and condition rules are manual in v1 and return `unverified` until an admin verifies them with optional note/evidence/valid-until. The daily vendor compliance monitor records snapshots in `complianceChecks`; `unverified` counts as attention in UI but does not generate vendor gap notifications or follow-up emails. Gap notifications are for `not_met`, `expired`, and `expiring_soon` only.

Surfaces:

- Web: `/compliance` is focused on requirement creation/management. Its top-bar action opens a right-side aside for bulk import or kind-aware manual entry. Vendor orgs also see active client-owned vendor requirements as read-only rows under **My requirements**, labeled as client requirements from the source client org; those rows cannot be archived by the vendor. **My requirements** rows include live compliance status badges (`Met`, `Expiring`, `Not met`, `Expired`, `Unverified`) based on the org's current policies and manual checks. Orgs that are purely vendors hide the **Vendor requirements** tab, while mixed orgs still show both **Vendor requirements** and **My requirements**.
- Connect: `/connect/vendors` is for vendors the org contracts with and monitors against its own standards; active vendor rows hide the invite/note copy, show one of `invited`, `waiting on policies`, `active / noncompliant`, or `active / compliant`, expand into a full requirement checklist with matched policy, limit, expiration, and insured-name details, and link to read-only vendor policy pages under `/connect/vendors/:vendorOrgId/policies`. `/connect/clients` is for clients the org reports insurance requirements to and approves access for. Vendor/client monitoring belongs on these Connect surfaces, not on `/compliance`. Legacy `/connected-orgs/*` paths redirect to the shorter `/connect/*` routes.
- MCP/CLI/REST: compliance requirements and vendor compliance are exposed through `list_insurance_requirements`, `create_insurance_requirement`, `list_vendor_compliance`, `GET/POST /api/v1/compliance/requirements`, and `GET /api/v1/compliance/vendors`.
- Agent: web chat and MCP chat include a vendor compliance snapshot in context so users can ask questions such as “are all my vendors compliant?”
- Broker portfolio agent: when the active org is a broker workspace, web chat, broker-staff inbound email to the broker handle, direct broker iMessage/SMS, MCP, and CLI `ask_glass` resolve a broker portfolio scope. That scope includes the broker org plus managed client orgs, keeps vector retrieval filtered per org, labels client data in prompts/tool results, and keeps connected-email mailbox access governed by existing connected-email account rules rather than broker-of-client access. Broker mode is internal and can compare clients, summarize portfolio risk, identify renewals, and draft broker-side follow-up, while client-facing and mixed-participant contexts must not disclose unrelated client data.
- Agent tools: web chat, inbound email, iMessage, and MCP chat expose `lookup_connected_vendors`, `lookup_vendor_policies`, and `lookup_vendor_compliance` so agents can answer vendor-specific compliance questions with the actual vendor roster, vendor policies, and requirement-by-requirement diffs instead of relying only on the generic requirements summary. MCP write-capable API-key callers may use shared write tools through `ask_glass`; read-only MCP identities receive a tool-level refusal for write operations.
- Agent task control: web chat and iMessage run a deterministic task-control gate before the main agent response path. The gate ranks natural-language cancel/reset candidates with search-style scoring and uses a structured classification model only for plausible ambiguous cases; high-confidence exits clear the active task before workflow-specific guards such as COI completion repair can rewrite the response. Email-specific cancellation remains higher priority than generic task reset.
- iMessage slash commands: deterministic text commands are parsed in `convex/lib/textChannelCommands.ts` and executed through `convex/lib/imessageSlashCommands.ts` after thread/org resolution but before pending-email natural-language controls, task-control intent resolution, retrieval, or model generation. `/help`, `/commands`, `/cancel`, `/reset`, `/new`, `/status`, `/drafts`, `/send`, `/discard`, `/leave`, and `/whoami` should remain command-router behavior rather than prompt instructions.

## Policy Update Broker Emails And Endorsements

Policy updates are broker-mediated email work, not an in-Glass case-management workflow. The user-facing flow should feel like: "draft/email my broker to update the policy with XYZ." Glass no longer exposes policy-change agent tools, policy-change sidebars, hidden case tracking, broker-reply correlation, or auto-reissue of held certificates after endorsements arrive. General policy-update requests should be handled through the generic email drafting/sending path with the relevant policy context and the broker assignment contact when known.

COI endorsement requests use the three-situation model: plain evidence-only certificates issue immediately; endorsement requests already satisfied by policy evidence issue with source-backed citation remarks on the certificate; requests needing new endorsements hold and store a broker email draft on the certificate hold. The user re-requests the certificate after the endorsement arrives.

Endorsement documents still enter the normal policy document extraction/attachment path. `policyUpdateRuns` and `policyDeclarationFacts` remain as source-backed policy update audit/fact storage for appended endorsement documents, but there is no policy-change case lifecycle around them. Full replacement extraction still uses the existing policy extraction pipeline.

## Connected Vendor/Client Accounts

Glass supports one-way connected organization relationships for vendor/client insurance access, modeled after the platform/connected-account idea of a parent org receiving scoped access to a connected org's records. The implementation intentionally keeps this separate from the broker/client hierarchy so broker portal features remain broker-only.

## Broker Identity For Client Orgs

Client-side broker identity is resolved through [convex/lib/brokerIdentity.ts](convex/lib/brokerIdentity.ts). Broker contact details come only from `brokerClientAssignments`: the optional `producerId` plus assignment-level contact name, email, and phone. Glass does not fall back to static broker fields on `organizations` or the broker org's primary insurance contact.

The shared resolver is used by web chat, inbound email, iMessage, email drafting, sidebar broker contact display, and iMessage group recipient resolution. When a client asks Glass to send something to "my broker," the email path should resolve the broker contact email from this identity and draft for confirmation rather than auto-sending. Broker identity is editable by broker admins from the client settings surface.

## Broker-Created Client Drafts

Broker-created client drafts are created only from explicit invite-drawer actions, not while the broker types. The broker-side client invite drawer can prefill the client's org name, website, primary user name, primary user phone, and policy PDFs before sending. Email remains required because it creates or updates the invited user record and is the invite recipient; phone is optional but must be a unique valid E.164-capable user phone because iMessage identity depends on user-phone uniqueness. Website enrichment for broker-created drafts must target the client org, not the broker org, and staged policy PDFs are uploaded only after the draft exists so extraction can run in the background against the client org.

## Team Invitations

Team-member invitations use `orgInvitations` for the pending membership record, but the settings drawer must call `orgs.sendMemberInvitation` rather than the raw `orgs.inviteMember` mutation. The action creates or refreshes the pending invite, sends the auth-domain email through Resend, and rolls back only newly-created invites when delivery fails. Invited users sign in with the invited email address; `AuthGuard` auto-accepts a pending `orgInvitations` row for the authenticated viewer, creates the membership through `orgs.acceptInvitation`, and marks user onboarding complete so invited teammates land directly in the org.

## Operator Provisioning

Broker orgs and broker admin accounts can be created from the private installable operator CLI without adding an admin web portal or requiring a customer OTP during setup. The CLI package lives in `operator-cli/` as `@claritylabs/glass-operator` and exposes the `glass-operator` binary; the repo wrapper `npm run operator:provision-broker` builds and runs the same package locally. It calls `convex/operatorProvisioning.ts` directly through Convex. The Convex deployment requires `OPERATOR_PROVISIONING_SECRET`; the CLI stores that token locally with `glass-operator auth:login` or reads `GLASS_OPERATOR_TOKEN` in agent environments. Requests are HMAC-signed with timestamp, nonce, and body hash, and Convex stores used nonces in `operatorAuthNonces` to reject replay. This flow may create or update the broker org, create/link the admin user account for the provided email, add the admin org membership, mark onboarding complete, and optionally seed draft client orgs. It deliberately does not create a browser session or bypass normal login; the broker contact still signs in with the usual OTP when they first access Glass.

Internal Glass operators are a separate account class, not customer org admins. Operator users have `users.accountKind: "operator"` plus an `operatorProfiles` row and must not have `orgMemberships`; customer users have missing/`customer` account kind and get tenant permissions only through `orgMemberships`. Operator accounts are bootstrapped only from `OPERATOR_BOOTSTRAP_EMAILS` through `/operator/login`. The `/operator` console lists broker tenants, creates setup broker shells, switches broker `operatorStatus` between `onboarding` and `live`, launches broker access emails, and starts audited org-role impersonation. `/operator/clients` lists both standalone and broker-managed client tenants, with a broker column to distinguish them; creating from this page can create either a standalone client tenant or a broker-linked client tenant for bulk setup. `/operator/models` controls global model defaults in `globalModelSettings`; runtime model routing applies broker-owned provider-key overrides first, then operator global defaults, then code defaults in `MODEL_ROUTING`. `/operator/extractions` shows retained policy extraction trace sessions across tenants for operator debugging; it exposes timing, phase, log, model/provider, token, error data, and bounded model-call debug previews for prompt text, system text, input attachment summaries, and outputs. `/operator/demo-leads` shows public demo sales transcripts and raw chat logs from unknown prospect email/iMessage flows; these records live in `publicDemoConversations`, `publicDemoSalesTranscripts`, and `publicDemoChatLogs`, separate from customer org `threads`. It must redact raw PDF/base64 payloads and should not store provider request bodies. Operator pages read current operator identity, tenant lists, global model settings, extraction trace data, and public demo lead data through the scoped local query cache in `lib/sync/operator-cached-queries.ts`; create/launch/status mutations patch that cache immediately, while slug/handle uniqueness checks stay live against Convex. Operator-created standalone clients and broker-linked clients use strict email verification seeded to the admin email and are launched through the normal `/login` OTP flow. Operator impersonation is an app-level overlay stored in `operatorImpersonationSessions`, not a Convex Auth session takeover. Setup writes are allowed only while the target tenant is `operatorStatus: "onboarding"`; live-tenant impersonation is read-only. Normal app routes redirect operator accounts back to `/operator` unless an impersonation session is active, and onboarding operator-provisioned tenants are hidden from external users until launch.

Schema: `connectedOrgRelationships` stores approved/resolvable org-to-org requests with `clientOrgId`, `vendorOrgId`, `status` (`pending` | `active` | `revoked`), audit user IDs, label/note, and timestamps. `connectedOrgInvitations` stores email-backed pending requests and token hashes for vendors who need an approval/signup link. Active relationships grant the client/customer org read-only access to selected vendor insurance system-of-record data. Relationships are one-hop only; a client that can read a vendor does not inherit that vendor's broker, clients, vendors, email, threads, or write capabilities. White labeling continues to be resolved from the viewer's own org/broker context, not from a connected vendor.

Shared access rules live in `convex/lib/access.ts`:

- `member` — direct org member, full org-member capabilities by role.
- `broker_of_client` — broker member viewing a managed client, matching existing broker portal behavior.
- `connected_client` — member of a client/customer org viewing an approved vendor org, read-only for policies/org profile.

Surfaces:

- Web: Connect in the main app menu uses `convex/connectedOrgs.ts` to request vendor access by email, approve email request links, and revoke relationships.
- REST: `GET /api/v1/vendors`, `GET /api/v1/vendors/:id`, and `GET /api/v1/vendors/:id/policies`.
- MCP/CLI: `list_connected_vendors`, `get_connected_vendor`, `list_connected_vendor_policies`.
- Agent: MCP chat receives connected-vendor roster context; exact vendor policy lists should come from the MCP vendor tools.

## Org Memory

`orgMemory` is the single curated per-org company-context store. It replaces the old `orgIntelligence`, `businessContext`, dream consolidation, and proactive analysis pipelines. Memory is for stable facts about the company itself: legal structure, headquarters, operations, products, employees, revenue, ownership, compliance posture, and business activities. Do not store policy numbers, policy terms, endorsements, COI/certificate details, email drafts, recipients, attachments, agent/tool limitations, workflow status, user requests, or one-off tasks. Policy and endorsement facts must come from source-backed policy tools and first-class policy tables, not memory.

### Schema: `orgMemory`

Each entry has:

- `orgId`
- `type` — legacy-compatible `fact` | `preference` | `risk_note` | `observation`; new accepted writes are restricted to `fact`
- `content` — free-text string
- `source` — `extraction` | `analysis` | `chat` | `email` | `imessage`
- `policyId` — legacy optional field; new accepted writes reject policy-specific memory
- `sourceRef` — optional stable evidence reference used for idempotent automated writes
- `confidence` — optional evidence confidence for extracted facts
- `observedAt` — optional timestamp for when the source evidence was observed
- `expiresAt` — optional legacy expiry
- `createdAt` / `updatedAt`

No embeddings, no supersession graph, no category taxonomy. Retrieval is bounded and list-based: it filters out legacy unsafe entries, ranks curated facts against the active request with recency as a tie-breaker, and injects only the most relevant company context into prompts. Automated mailbox extraction uses structured output, a high-confidence threshold, source references, and normalized-content deduplication.

## Connected Email (IMAP)

Users can connect generic IMAP mailboxes from Settings → Email. The default access scope is user-only; users can opt into org scope so direct org members and agents acting for that org can search the mailbox. Access scope is separate from the three per-mailbox automation controls: policy imports, requirement imports/compliance checks, and durable company-context extraction. Connected-client and broker-of-client access do not grant mailbox access. Glass stores account metadata, encrypted credentials, automation settings, scan cursors, and bounded outcome/audit metadata; it does not persist raw mailbox bodies during ordinary search/read or proactive classification. IMAP passwords/app passwords are encrypted server-side with `EMAIL_CONNECTIONS_ENCRYPTION_KEY` and are never returned to the browser or agent tools. New connections enable all three automation controls after an explicit disclosure that imported policies, requirements, and company memory become workspace data visible to organization members; mailbox activity threads remain private to the mailbox owner. Legacy personal mailboxes remain on-demand until configured; legacy organization mailboxes retain alert-only behavior until configured.

Agent mailbox tools perform live IMAP search/read, read bounded text from selected PDF/DOCX/text-like attachments, save mailbox attachments or the email message itself into the current thread for reuse, import selected PDF attachments into the existing bound-policy extraction pipeline, import email bodies and lease/contract/vendor requirement attachments into internal or vendor compliance requirements, and send connected-vendor invites when the user requested that action. Complex mailbox tasks should go through the `mailbox_coordinator` model route (Fireworks GLM 5.2 by default), which can call live mailbox tools and existing Glass import actions. Main web chat exposes the mailbox coordinator as a single tool and stores a `mailbox_task` artifact so the message shows a compact background-process opener and the right panel shows the coordinator's plan, search audit, specific email evidence, and user-confirmed buttons to save attachments to the thread, import policy documents, plus create vendor/internal requirements; the direct mailbox search/read/import tools remain behind the coordinator rather than being attached to every chat request. Coordinator searches are intentionally agentic: it derives targeted search terms and explicit `dateFrom` / `dateTo` windows from the user's request, searches all accessible connected mailboxes unless the user selected `/` mailbox targets, ignores messages sent from `glass.insure`, `glass.claritylabs.inc`, or their subdomains to prevent reference loops, inspects promising messages, then broadens or pivots terms/date ranges before concluding that an item is missing. When the coordinator identifies attachments the user may need again, it should save them to the thread with `save_connected_email_attachments_to_thread`; saved thread attachments are stored in Convex file storage on a `threadMessages` row and are available to the email expert as uploaded-file attachments without another mailbox search. When the user asks to attach, forward, preserve, or provide proof of an email whose useful content is in the email body, the coordinator should use `save_connected_email_message_to_thread`, which exports the message as an attachable `.eml` file before drafting or sending. For web chat, the coordinator writes a running `mailbox_task` artifact onto the current agent message as soon as it has a plan, so the thread shows an auditable background process while the live IMAP search is still running. For iMessage/text requests, the coordinator generates a short plan first and sends a status text before running the live mailbox workflow. Imported policies, requirements, vendor invites, notes, and thread artifacts are persisted through their existing first-class tables; raw mailbox messages remain remote unless a user-directed import stores an attachment/artifact.

Web chat also exposes `render_email_preview` for outbound email drafts. It renders the current or specified `pendingEmails` draft through Playwright as a PNG screenshot or PDF printout, stores the rendered file in Convex storage, and attaches it to the current assistant message so users can inspect email formatting without sending. Runtime environments need Playwright's Chromium browser installed; if the browser binary is missing, the tool returns a renderer-unavailable result instead of fabricating a preview.

Outbound emails are persisted as `pendingEmails` and email `threadMessages`. Sending assigns a deterministic RFC `Message-ID` and uses the thread-specific email address as Reply-To when available, so broker replies can be correlated back to the original thread. General policy-update requests should be handled as broker email drafts through the generic email tooling; Glass no longer opens hidden policy-change cases or uses endorsement-specific completion tools.

Daily connected-mailbox automation runs from the Railway cron service in `mailbox-scan-worker/`. The worker starts once daily at `0 15 * * *` UTC, calls `POST /cron/connected-email/scan` on the Convex site URL, and exits. The HTTP route validates `EMAIL_SCAN_CRON_SECRET` as a Bearer token and then calls the internal action `actions/connectedEmailScan.scanAllMailboxes`, which scans active legacy org mailboxes plus any personal or org mailbox with at least one automation control enabled; `actions/connectedEmailScan.scanOrgMailboxes` runs the same bounded flow for one org. The proactive scan engine lives in `convex/actions/connectedEmailScan.ts`; interactive mailbox tools and import pipelines stay in `convex/actions/connectedEmail.ts`, and shared IMAP connection/crypto/parse helpers live in `convex/lib/imapMailbox.ts` (node-only). The first scan searches the last 400 days for insurance-relevant subject terms, processes the newest 50 matches oldest-first, then advances to the live high-water mark so historical mail cannot starve new arrivals. Later runs process up to 50 new messages in UID order. A message the IMAP fetch cannot read is retried on later scans and, after three failed attempts, its automation item is marked `skipped` with the fetch error so the UID watermark advances past it instead of stalling the mailbox forever; the incomplete-scan attention notice fires only on the first failure. Discovery reads IMAP envelope/body-structure plus at most 64 KB from one text part, rejects Glass-originated loops, uses the `mailbox_coordinator` route for structured high-confidence classification, and records UIDVALIDITY-aware cursor/outcome metadata for retry safety. Policies reuse the bound-policy extraction pipeline with SHA-256 duplicate guards, requirements reuse the compliance importer and final-policy assessment, and company facts reuse `orgMemory` evidence/dedupe policy. Missing, unreadable, or ambiguous items create replyable proactive threads and route external delivery through the user's Profile → Proactive conversations preference (`email`, `imessage`, or both) via the shared notification system. Raw messages remain remote unless an existing import path deliberately stores an attachment or thread artifact.

Users who can manage a mailbox (the owner, or an org admin for org-scoped mailboxes) can also run a manual scan over an explicit date range from Settings → Email → mailbox drawer. The public action `actions/connectedEmailScan.scanMailboxRange` searches the range without subject-term filtering, scans the newest 50 matches with the same classification/import pipeline and automation-item ledger (already-processed messages are skipped), and reports scanned/processed/attention counts plus truncation. Manual scans never move the incremental UID watermark and never record unreadable-message attempts, so they cannot affect the daily scan's cursor or poison-pill retry budget.

### Writers

| Source                         | Where                                              | Trigger                                   |
| ------------------------------ | -------------------------------------------------- | ----------------------------------------- |
| `save_note` chat tool          | `convex/lib/agentToolExecutors.ts`                 | Explicit user request to remember a stable company fact |
| Website enrichment             | `convex/actions/extractCompanyInfo.ts`             | Client onboarding step 2 + manual refresh |
| Connected mailbox automation   | `convex/actions/connectedEmail.ts`                 | High-confidence durable company fact with a stable source reference |

Generic automatic email/iMessage post-reply memory extraction is disabled. Only explicitly enabled connected-mailbox automation may extract high-confidence company facts from bounded email evidence. `confirm_policy_fact` updates source-backed policy fields and audit logs only; it does not write `orgMemory`.

## cl-sdk Integration

The Glass-specific `cl-sdk` wiring lives under `convex/lib/`.

- [sdkCallbacks.ts](convex/lib/sdkCallbacks.ts): adapts Glass model routing to `cl-sdk` callbacks
- [extraction.ts](convex/lib/extraction.ts): builds a preconfigured extractor
- [documentMapping.ts](convex/lib/documentMapping.ts): maps SDK documents to Convex policy records
- [extractionFieldReview.ts](convex/lib/extractionFieldReview.ts): reusable evidence-backed field review groups for missed or contradicted extracted fields
- [extractionPostProcess.ts](convex/lib/extractionPostProcess.ts): shared post-extraction quality pipeline before policy persistence
- [convexDocumentStore.ts](convex/lib/convexDocumentStore.ts): `DocumentStore` adapter
- [convexMemoryStore.ts](convex/lib/convexMemoryStore.ts): `MemoryStore` adapter
- [queryAgent.ts](convex/lib/queryAgent.ts): `createQueryAgent()` wrapper
- [agentPrompts.ts](convex/lib/agentPrompts.ts): SDK prompt exports plus Glass retrieval-backed context builders

### Callback Contract

Current `cl-sdk` passes document content through callback `providerOptions`.

- `providerOptions.pdfBase64` is legacy/non-extraction helper input only. Policy extraction must pass preprocessed `sourceSpans`; do not add new raw-PDF extraction or page-map flows.
- `providerOptions.parsedPdfText` carries full parsed text for helper flows that pre-extract attachment text before calling a model.
- `providerOptions.images` carries page images when PDF-to-image conversion is used.
- `providerOptions.sourceSpans` carries parser-derived source evidence. The v3 path builds a source-node hierarchy and operational profile from those spans; model calls may label/group existing nodes or cite facts, but canonical wording and PDF provenance remain in `sourceNodes`/`sourceSpans`.
- `trace` metadata identifies task-specific extraction/model batches for operator model-call debugging. Preserve it in extraction trace events.

Glass translates those into AI SDK multipart message content in `sdkCallbacks.ts`:

- PDFs become `{ type: "file", data, mediaType: "application/pdf" }`
- images become `{ type: "image", image, mediaType }`
- Parsed PDF text is already injected into those helper prompts and preserved in `providerOptions.parsedPdfText`; Glass callbacks do not convert it back to a PDF file part.

Notes:

- The `providerOptions.images` items from `cl-sdk` do not carry a `type` field; Glass adds `type: "image"` when building AI SDK parts.

### Extraction Shape

Glass treats the v3 source tree as canonical extraction truth. `PolicyDocument`, `documentMetadata`, and `documentOutline` are compatibility projections for existing surfaces. Keep SDK interpretation labels (`type`, `label`, `interpretationLabels`) as hints inside the original source hierarchy. Do not regroup source text into Glass-owned buckets when a source tree is available.

Glass persists:

- Top-level policy financials: `premium`, `totalCost`, `taxesAndFees`, `premiumBreakdown`, `minPremium`, `depositPremium`
- Extracted dates are normalized to `MM/DD/YYYY` before persistence where the source value is parseable. Monetary and limit-like fields keep user-facing display strings while also storing numeric companions such as `premiumAmount`, `totalCostAmount`, coverage `limitAmount` / `deductibleAmount`, and row-level `amountValue` for deterministic comparison.
- Source document structure: `sourceNodes` rows plus top-level `documentMetadata` and `documentOutline` projections. Existing rows may lack source nodes; source-native preview surfaces should show a rebuild/re-extraction warning instead of pretending legacy categories are equivalent to the original document structure.
- Operational policy profile: `operationalProfile` stores source-backed metadata, parties, ACORD lines of business, coverage lines, limits, deductibles, premiums, key dates, and endorsement support with `sourceNodeIds` and `sourceSpanIds`. Keep policy classification in `linesOfBusiness`; do not add a parallel `policyTypes`, `coverageTypes`, `coverageOrigin` bucket, or deterministic coverage-origin projection.
- Legacy document detail may still exist under `document.sections`, `document.definitions`, `document.coveredReasons`, `document.endorsements`, `document.exclusions`, and `document.conditions`, but it is not canonical extraction truth.
- Declarations and supplementary facts as top-level policy fields
- Raw source evidence in `sourceSpans`; retrievable hierarchy in non-vector `sourceNodes`; compatibility source windows in non-vector `sourceChunks`. Source spans preserve `sourceUnit`, `parentSpanId`, table location, page/character location, bounding boxes, and stable `sourceSpanIds`; `sourceSpans.listSpansByPolicyAndSpanIds` returns requested spans plus related parent spans so table-cell facts can highlight their parent row or fall back to the source page. Client-facing source-span lookups are capped for page stability; individual visible rows should query their own narrow evidence IDs instead of asking for every source span in a policy at once.
- Glass runs all post-extraction cleanup through `postProcessExtractionDocument()`: deterministic policy-period fallback, evidence-backed field review, `insuranceDocToPolicy()`, coverage declaration scoping, review-copy polish, and organization-name normalization. Keep new cross-cutting extraction cleanup in this pipeline rather than adding one-off fallback extractors inside `policyExtraction.ts` or `documentMapping.ts`.
- Field review is configured as reusable groups in `extractionFieldReview.ts`. It uses source spans and document sections, applies only evidence-quoted corrections for registered fields, and runs on the low-cost `classification` route. `EXTRACTION_FIELD_REVIEW_MODE=skip|auto|always` controls whether it is disabled, runs only for missing group fields, or runs for all groups with evidence.
- The policy-period fallback still performs a deterministic source-span check over raw PDF text before persistence. Clear `PERIOD OF INSURANCE` / `POLICY PERIOD` / `POLICY TERM` source text, including day-month-year table layouts, is allowed to override missing, malformed, or conflicting SDK `effectiveDate` / `expirationDate` values.

### Token Limits

Glass avoids low artificial max-output caps for SDK-facing extraction calls.

- `cl-sdk` resolves task preferences for diagnostics, but when model capabilities expose `maxOutputTokens`, the SDK uses that upper bound as the request cap.
- `sdkCallbacks.ts` re-resolves the effective cap from the actual Glass route selected for the call. Broker or operator model overrides therefore use the selected route's known max output limit instead of the static SDK hint.
- Do not add prompt-specific low max-token overrides for extraction unless the provider itself has a lower hard limit.

## Policy Extraction

Two entrypoints, both PDF-only:

- [convex/actions/extractFromUpload.ts](convex/actions/extractFromUpload.ts) — `extractFromUpload` (public action) for direct user uploads; `extractFromUploadInternal` (internal action) for the email agent.
- [convex/actions/extractPolicy.ts](convex/actions/extractPolicy.ts) — internal helpers used by the email agent via the `extract_policy_attachment` tool.
- [convex/actions/reExtractFromFile.ts](convex/actions/reExtractFromFile.ts) / [retryExtraction.ts](convex/actions/retryExtraction.ts) — re-run and retry.

### Flow

1. Fetch or receive a PDF.
2. Store the raw PDF in Convex file storage.
3. Load the PDF bytes from Convex file storage. If the LiteParse worker endpoint is configured, convert the PDF to parsed text plus hierarchical source spans and run `buildExtractor().extract(pdfBytes, documentId, { sourceSpans })`. If conversion is unavailable, build local PDF.js source spans and call the same source-span extraction path. Do not pass a signed storage URL into `cl-sdk`; review and follow-up extractors can run long enough that repeated URL fetches become unreliable.
4. Verify critical policy-period dates from source text when a clear declaration-page period is present, then map `InsuranceDocument` into Glass policy fields.
5. Run coverage declaration scoping before persistence. When the SDK extracts multiple limits for the same coverage and limit role, Glass scores declarations, selected-option markers, summary/confirmation pages, endorsements, and source-span evidence; persists only the best current coverage value; and stores `extractionReview.questions` for any same-role limit conflict that still needs client/broker confirmation. Distinct limit roles such as per-occurrence and aggregate remain separate coverage rows.
6. Persist the extracted document and metadata.
7. Chunk the structured document when compatibility/runtime paths still need `documentChunks`, and embed only those chunks with `text-embedding-3-small`.
8. Store `sourceNodes` as the canonical non-vector hierarchy, store `sourceSpans` for exact PDF highlights, and keep non-vector `sourceChunks` plus embedded `documentChunks` only as compatibility artifacts for old paths.

Pipeline runtime state:

- Policy extraction status remains denormalized on `policies.pipelineStatus` / `pipelineError` for fast list filtering.
- High-churn extraction runtime state lives in `policyExtractionRuns`: `pipelineCheckpoint`, `pipelineLog`, leases, heartbeat timestamps, and detailed progress. This avoids rewriting large policy documents for every log, checkpoint, and heartbeat. Large `cl-sdk` checkpoint payloads and extraction-to-embedding payloads are stored in Convex file storage and tracked by `policyExtractionArtifacts` records keyed by policy/job ID and artifact kind. The pipeline checkpoint only keeps compact storage IDs and summaries. `cl-sdk` assemble checkpoints intentionally omit the assembled document before storage, because the document can be rebuilt from checkpointed extraction memory and storing both memory and document can make the checkpoint artifact too large.
- Durable operator debugging history lives separately in `policyExtractionTraceSessions` and `policyExtractionTraceEvents`. Each upload/full retry starts a new trace session; resume retries reuse the checkpoint's `traceId` when available. Trace events record phase timing, pipeline logs, model-call metadata, external-worker events, embedding batch summaries, token usage, provider/model/route-source/transport, durations, errors, and bounded model-call debug previews. The debug payload redacts raw PDF/base64 payloads, stores attachment summaries instead of file bytes, truncates prompt/output text, and the daily `extractionTraces.sweepExpired` cron removes records after 90 days.
- Query surfaces such as `policies.get` and `policies.getInternal` merge runtime state from `policyExtractionRuns`, falling back to legacy fields on `policies` for old in-flight jobs.
- The extract phase stores `documentChunksForEmbedding`, `sourceSpansForStorage`, `sourceNodesForStorage`, and compatibility `sourceChunksForEmbedding` in a storage-backed `embedding_payload` artifact before advancing to `embed_and_store`, so a resumed storage phase can reload transient artifacts without inflating checkpoint documents. Only `documentChunksForEmbedding` are embedded; source spans, source nodes, and source chunks are stored as non-vector evidence records. Artifact blobs are cleaned up after durable embedding/source-span/source-node storage succeeds, cancellation, terminal success, and full restart; generic errors keep artifacts for resume/retry.
- External extraction completion payloads are stored as `external_completion_payload` artifacts before Convex finalization. If a policy is stuck after this artifact is saved, retry the same extraction run rather than starting a fresh upload/restart; the external worker first calls `completeExternalExtractFromStoredPayload`, verifies the active lease/checkpoint still matches, and replays the stored payload into the normal finalization path. Do not replay across a newer extraction run or after cancellation.
- Extraction now uses the source-span SDK path only. LiteParse/PDF.js preprocessing must produce `sourceSpans` before calling `cl-sdk`; the old raw-PDF page-map, focused-extractor, formatter, form-inventory, broad-review, and SDK checkpoint/resume paths have been removed. The SDK builds operator source nodes for evidence/search but feeds operational-profile extraction from compact source-span evidence windows so model time is spent on end-user facts rather than display-tree repair. The extraction worker claims multiple full extraction jobs concurrently through `EXTRACTION_JOB_CONCURRENCY` (default 100, bounded 1-1000), while embedding defaults to 8 concurrent embedding calls (`EXTRACTION_EMBEDDING_CONCURRENCY`, bounded 1-16).
- Long-running SDK extraction can be offloaded to the standalone Railway worker in `extraction-worker/` by setting `EXTRACTION_WORKER_MODE=external` and a shared `EXTRACTION_WORKER_SECRET` on Convex, then running the worker with `CONVEX_URL` and the same secret. In external mode Convex remains the durable job ledger: uploads/retries create `policyExtractionRuns` checkpoints, the worker claims extract-phase leases, heartbeats, completes extraction, and hands the job back to Convex for embedding/source-span persistence and post-processing. Workers send their protocol, worker version, and `@claritylabs/cl-sdk` dependency on each claim; Convex rejects incompatible workers before leasing jobs, and dev/staging deployments should set `EXTRACTION_WORKER_EXPECTED_CL_SDK_VERSION` to the current extraction-worker package spec so stale workers cannot silently leave uploads at “Extraction starts shortly.” After any SDK bump, verify the package specs with `npm run check:cl-sdk-version`, compare Convex `/agent-health` `extractionWorker.expectedClSdkVersion` against the extraction worker `/health` `clSdkVersion`, then run `AGENT_HEALTH_ATTEMPTS=1 npm run check:agent-health -- --env=staging` before starting staging extractions. The claim action returns broker model routes/provider keys so trusted workers preserve extraction/classification overrides instead of falling back to only static env routing. The same worker also exposes authenticated `POST /liteparse/convert` when `PORT` is set; configure Convex with `EXTRACTION_WORKER_URL` plus `EXTRACTION_WORKER_SECRET` so requirements imports, mailbox attachment reads, on-demand source lookup, supplementary extraction, and chat/email/iMessage PDF attachment context can use LiteParse text with PDF/PDF.js fallback.

Cancellation:

- `policies.cancelExtraction` marks `pipelineError` as `Cancelled by user`.
- `policyExtraction.ts` checks that flag before phases and before/after each `cl-sdk` model call. Cancellation stops at the next provider-call boundary and is recorded as an expected pipeline error, not as a transient action failure.
- `policyExtraction:advance` uses a Convex-backed checkpoint lease before running a phase. This prevents overlapping scheduled advances from running the same long extraction phase concurrently and racing to overwrite extracted policy data. The lease is heartbeat-based and watchdog-scheduled, so if an advance action dies during a long provider call, a later advance can reclaim the checkpoint after the heartbeat goes stale instead of leaving the policy stuck in `running`. A five-minute cron (`policyExtraction.sweepStale`) also scans `policyExtractionRuns` by `pipelineStatus`/`updatedAt` and requeues stale running checkpoints, or marks runs with no resumable checkpoint as errored.

## Retrieval And Agent Context

Glass uses vector-backed document/conversation stores plus list-based source evidence:

- `sourceNodes` — canonical source-tree hierarchy, ranked lexically and expanded by hierarchy for policy wording
- `sourceSpans` — exact PDF evidence/highlight layer
- `sourceChunks` — non-vector compatibility source-span windows for policies not yet rebuilt into source nodes
- `documentChunks` — legacy extracted policy structured fact chunks, secondary only
- `conversationTurns` — legacy raw cross-thread conversation memory table, no longer written or injected into prompts; clear it with the operator memory purge when cleaning an environment
- `orgMemory` — curated company-context facts only (list, filtered by the memory policy)

[agentPrompts.ts](convex/lib/agentPrompts.ts) builds agent context:

- `buildDocumentContext()` — embeds the query only for secondary `documentChunks`, ranks source nodes lexically, expands hierarchy context, and attaches stable `sourceSpanIds`. If only legacy chunks exist, it queues `ensurePolicyV3SourceTree()` and warns that exact policy-wording answers require source-tree rebuild.
- `lookup_policy_section` uses [policyLookup.ts](convex/lib/policyLookup.ts) in web chat, inbound email, iMessage, and MCP chat to return source-node matches with hierarchy path, excerpts, `sourceNodeIds`, `sourceSpanIds`, and PDF location metadata. It still falls back to raw source spans or on-demand PDF parsing for older policies, but source-node evidence is preferred.
- `confirm_policy_fact` lets agents confirm a concise policy fact after `lookup_policy_section` returns supporting original-PDF `sourceSpanIds`. The tool may patch only a constrained set of top-level policy fields when the cited PDF text directly supports the update, and records policy audit history rather than long-term memory.
- SDK query-agent wrappers use [convexSourceRetriever.ts](convex/lib/convexSourceRetriever.ts) to lexically search `sourceNodes`, return hierarchy-expanded packets with exact spans, and fall back to source spans only when no source-node evidence exists.
- `buildOrgMemoryContext()` / `buildIntelligenceContext()` — lists recent curated `orgMemory` company facts.
- `buildConversationMemoryContext()` — intentionally returns no context; raw conversation memory should not steer future answers.
- Web chat composer steering lives in [components/glass-prompt-input.tsx](components/glass-prompt-input.tsx) and [convex/agentTargets.ts](convex/agentTargets.ts). Typing `@` opens a custom picker for policies and requirements; typing `/` opens accessible connected mailboxes. Selected targets are stored on the user `threadMessages` row as `referencedPolicyIds`, `referencedRequirementIds`, and `referencedMailboxIds`, then [processThreadChat.ts](convex/actions/processThreadChat.ts) injects them as explicit context. Selected mailbox IDs are passed into [mailboxCoordinator.ts](convex/actions/mailboxCoordinator.ts), which restricts live IMAP search to those accounts unless the user asks to broaden the search. When a user submits while an agent response is active, the web composer queues that message locally and sends it after activity ends; the queued row's **Send now** action sends immediately, cancels the in-flight agent message, and lets the new message steer the thread.
- Agent thread UI lives under [components/agent-thread](components/agent-thread). [app/agent/thread/[id]/page.tsx](app/agent/thread/[id]/page.tsx) should stay route/AppShell orchestration only; reusable message rendering belongs in `thread-content.tsx`, shared thread shapes in `types.ts`, and artifact-specific summary cards, right panels, and normalization helpers under `components/agent-thread/artifacts/`.

## Certificate Holds

Held certificate requests store the reason, requested endorsement kinds, evidence excerpts, and an optional broker `emailDraft` directly on `certificateRequestHolds`. New holds do not create `policyChangeCases` or open a policy-change sidebar. Keep historical link fields schema-compatible until cleanup has removed old rows and references.

[aiUtils.ts](convex/lib/aiUtils.ts) owns shared agent instructions for web chat and email:

- `buildSystemPromptForContext()` builds the Glass-specific capability and safety prompt. It deliberately allows the agent's real insurance operations: answer questions, draft/send/forward validated emails, read/upload policies for extraction, generate COIs, and save durable notes.
- `buildChannelInstructions()` adds channel-specific web-chat/email behavior without duplicating the base prompt.
- `buildPolicyToolInstructions()` adds shared policy lookup and analysis standards.
- `policySearchScore()` provides shared policy search ranking for natural language requests such as "what's my policy number?"

## Convex Patterns

Auth pattern:

- Public Convex functions have user auth context.
- Internal functions do not.
- Never call a public function that depends on `requireAuth()` from an internal action.

Storage and retrieval pattern:

- `policies.document` stores the structured extracted document.
- `sourceNodes` stores canonical non-vector policy hierarchy; `documentChunks` is the remaining embedded policy compatibility corpus.
- `orgMemory` stores curated company-context facts only. Policy, endorsement, COI, thread, email, and workflow facts live in their first-class tables and must be retrieved with tools.

Important: in a Conductor worktree, `npx convex dev` and `npx convex dev --once` update only that worktree's native local deployment. They do not update shared dev, staging, or production. Production Convex deploys through `.github/workflows/deploy-convex.yml` on relevant `main` pushes, or manually with `npx convex deploy --yes` when needed.

## Main Product Flows

### Onboarding

Onboarding is role-specific.

- `/onboarding` is a router-only entrypoint.
- Broker users (or users without an org) are sent to `/onboarding/broker` (unchanged from v0.1.x).
- Client users are sent to `/onboarding/setup`, a 4-step wizard:
  1. **Identity** — name + role.
  2. **Org** — organization name + website; on continue, `extractCompanyInfo` runs server-side enrichment from the website and writes `orgMemory` facts.
  3. **Policies** — list current policies; user can upload PDFs (extracted via `extractFromUpload`) or forward them to the org's inbound address.
  4. **Finish** — intro to the chat assistant + MCP connection info.

Passport onboarding (`/onboarding/passport/*`) has been removed.

### Email Agent (Inbound)

Inbound email arrives at `POST /resend-inbound` and is handled by `convex/actions/handleInboundEmail.ts`.

- No hardcoded intent routing. The agent runs chat through the shared `chat` model route and a tool set:
  - `lookup_policy`
  - `lookup_policy_section`
  - `confirm_policy_fact`
  - `compare_coverages`
  - `email_expert` — delegates outbound drafting/sending to the shared email subagent when the sender is an authenticated internal team member in direct mode
  - `save_note` — writes only explicit stable company facts to `orgMemory`
  - `generate_coi`
  - `extract_policy_attachment` — extracts PDF attachments via `extractFromUploadInternal`
- Email replies do not automatically write observations to memory.

### iMessage Agent (Inbound)

Inbound iMessage arrives through the `imessage-worker` Spectrum bridge and `POST /imessage-inbound`. Direct chats and group chats share the same handler in `convex/actions/handleInboundImessage.ts`.

- The worker forwards the Photon chat GUID, group flag, chat title, sender address, and participant roster when available.
- Convex stores group-level state in `imessageChats` and one row per participant in `imessageParticipants`; do not create auth `users` rows for unlinked group participants.
- If no participant in a group has a linked Glass phone number, Glass sends the signup fallback and asks the worker to leave the group.
- If one or more linked participants resolve to the same org, the group runs in single-org mode while preserving anonymous speaker labels for context.
- If linked participants resolve to multiple orgs, the agent may read context from the linked orgs represented in the group, but write actions require an unambiguous org/policy and a linked current sender. Mutating tools should fail closed rather than guessing across orgs.
- Thread routing for iMessage groups uses `threads.imessageChatGuid`; legacy direct-chat routing by `threadPhone` is retained for fallback/proactive sends.
- Agents can create new outbound iMessage group chats only after explicit user confirmation. Group creation resolves the requester plus named teammates, client-specific broker contacts, broker/client/vendor org members, or explicit phone numbers, then calls the `imessage-worker` private `/send` API with a `participants` payload. Production uses Photon Advanced iMessage chat creation; terminal mode simulates a deterministic group GUID for dev. Created groups are synced into `imessageChats` / `imessageParticipants` and routed through `threads.imessageChatGuid`; unlinked phone numbers remain anonymous participants and do not create auth `users` rows.
- Client-specific broker group-chat resolution prefers the primary `brokerClientAssignments` producer for that client, then the broker org's `primaryInsuranceContactId`, then a broker admin/member with a phone number. Broker admins can update the client-specific broker contact from the client list.

### Glass Agent Email Sending

Outbound emails sent by Glass Agent are centralized in `convex/lib/emailSubagent.ts`.

- Channel agents should delegate draft/send/forward requests to the `email_expert` tool instead of hand-rolling email payloads.
- The email subagent owns recipient caution, formatting, signatures, attachment preparation, Resend payload construction, pending-send scheduling, and sent-email thread records.
- It can attach original policy PDFs from `policies.fileId`, user-uploaded files already present in the conversation, and generated COI PDFs from `generateCoi.run`.
- `generateCoi.run` stores every newly generated COI PDF in Convex file storage, records file history in `certificates`, and records holder/version identity in `certificateHolders`, `policyCertificates`, and `certificateVersions`. Treat the lifecycle tables as the source of truth for certificate holder contact, snapshot, version, request kind, request signature, and reuse details. Legacy `certificates` rows are file-history rows only; do not bridge them back to lifecycle IDs or backfill old certificate rows. Direct page generation uses `certificates.generateForPolicy`. Programmatic generation is exposed through REST (`GET/POST /api/v1/policies/:id/certificates`) and MCP/CLI tools (`list_policy_certificates`, `generate_policy_certificate`).
- Certificates are broker-owned informational COIs and must include the ACORD-style disclaimer: `THIS CERTIFICATE IS ISSUED AS A MATTER OF INFORMATION ONLY AND CONFERS NO RIGHTS UPON THE CERTIFICATE HOLDER.` Holder-only requests generate or reuse immediately from holder information; holder address is optional. Additional-insured requests run a source-backed policy evidence gate: supported requests generate a certificate showing the holder and additional insured, while unsupported, ambiguous, or conflicting requests create a broker follow-up draft/request and do not generate a certificate. Other endorsement-bearing requests should route to broker follow-up rather than certificate generation.
- Shared email intent and COI attachment safety guards live in `convex/lib/emailIntentGuards.ts` and `convex/lib/coiAttachmentGuards.ts`. Keep cross-channel routing decisions and multi-certificate attachment rules there instead of duplicating regex guards in web chat, inbound email, iMessage, or pending-send code.
- It requires confirmation instead of sending when the recipient email is inferred or unknown, the body/subject is incomplete, attachments are ambiguous, or `autoSendEmails` is false and the user has not explicitly approved the exact draft.
- Web chat, inbound email, iMessage, and MCP/CLI surfaces all route directed outbound email through shared email-draft primitives rather than hand-rolled send paths. The shared email identity falls back to `agent@${AGENT_DOMAIN}` when no custom agent handle is configured. Web chat and iMessage pass the current user's email/name as the default recipient so "email me" requests resolve without asking for already-known contact details. The `bccRequesterOnAgentEmails` org setting defaults on and blind-copies the requesting team member on directed outbound emails. The email expert supports structured `cc` and `bcc` recipients.
- In web chat, draft emails are persisted as native email-channel thread messages backed by a `pendingEmails` draft. The chat still shows a concise assistant note that an email was drafted, while the full copy lives in the email card/right-side preview. The user can review or quickly send from the draft card, send/cancel from the resizable right-side email preview panel, or use typed chat approval as a fallback that sends the current draft artifact instead of requiring a regenerated draft message. Right-side previews can stack, so an email draft and PDF/policy preview may be open at the same time; when stacked, panels begin at equal widths with the main content and the PDF panel stays furthest right.
- MCP and local CLI expose the same durable draft lifecycle through `list_email_drafts`, `draft_email`, `update_email_draft`, `send_email_draft`, and `cancel_email_draft`. Programmatic tools should update the existing draft artifact in place and send/cancel by draft ID; `ask_glass` remains for Q&A and contextual reasoning.
- Pending emails persist attachment metadata in `pendingEmails.attachments`; the scheduled sender writes those attachments back into the unified thread email message after Resend accepts the send.

### Agent Q&A (Chat)

1. Load org context, policies, and `orgMemory`.
2. Build retrieval-backed document context + curated company-memory context.
3. If the user message has attachments (images, PDFs, text), read them from Convex storage and include as AI SDK multipart content parts.
4. Run chat model via `streamText` with tools: `lookup_policy`, `lookup_policy_section`, `confirm_policy_fact`, `compare_coverages`, `email_expert`, `save_note`, `generate_coi`. `save_note` is only for explicit stable company facts.
5. Persist conversation state.

## UI

- `/policies` — list, detail, upload, re-extract, and generated certificate history.
- Policy detail **Breakdown** includes save-on-change editing for key extracted fields, premium breakdown rows, taxes/fees, and coverage limit/deductible rows. Direct org members and broker-of-client users can edit; connected-client/vendor access remains read-only. Edits write through `policies.updateExtractedFields` and record `manual_policy_update` audit entries.
- `/chat` — threaded assistant.
- `/agent/thread/:id` — renders unified `threads` records. Legacy `webChats`, `webChatMessages`, and `agentConversations` backend tables/functions have been removed after migration to `threads` + `threadMessages`.
- Proactive features that create a chat thread use `threads.createProactiveInternal` so the thread starts with an agent message explaining why Glass created it, what evidence or trigger was found, and what the user should do next. Proactive email drafts attach to that agent message via `pendingEmailId`, so the chat context and email card render together.
- Chat artifact cards such as email drafts should keep meaningful visual presence. Sources and tool calls should stay compact and consistent in the message footer row: inline policy citations are small chips, footer source chips open the right-side preview, and tool call parameters expand only on demand.
- Web chat email artifacts are visually attached to the assistant message that created them, not rendered as a separate standalone chat turn. Sent email artifacts use `View sent email` instead of draft language.
- Automatic chat title generation lives in `convex/actions/threadTitle.ts`. It should use the initial user message plus `threads.initialContext` and attachments, prefer the user's work intent/deliverable, and avoid recipient names, email domains, usernames, or file IDs.
- `/settings` — org settings, branding, members, and an **Integrations** section rendered as a coming-soon grid. The Merge.dev backend and all integration sync tables/actions have been removed; only the static grid remains.

## MCP

Glass exposes MCP functionality for remote and local AI tools.

- Remote MCP is served from Convex HTTP handlers at `/mcp`.
- Local MCP support lives under [mcp-server/](mcp-server/).
- MCP discovery: `GET /.well-known/mcp.json`

### Tools (trimmed in v0.2.0)

- `list_policies`, `get_policy`, `list_policy_certificates`, `generate_policy_certificate`
- `list_threads`, `get_thread_messages`
- `list_email_drafts`, `draft_email`, `update_email_draft`, `send_email_draft`, `cancel_email_draft`
- `get_org_info`
- `ask_glass`
- `list_clients`, `get_client` (broker)
- `list_broker_activity` (broker)
- `list_my_policies` (client)

Application, quote, passport, business-context, and integration tools are gone. The local MCP server should only register current policy, thread, org, agent, broker/client, certificate, and connected-vendor tools.

All MCP tool invocations require a Bearer token (OAuth or API key) and resolve org from session metadata. Write tools require a token with `write` scope.

## REST API

Versioned REST API under `/api/v1/*`. All routes require:

- `Authorization: Bearer <token>` (OAuth token from `/oauth/token`)
- `X-Org-Id: <orgId>` header

Scopes: `read` (default) and `write`. Write endpoints require a `write` token.

Error shape: `{ "error": { "code": "...", "message": "...", "request_id": "..." } }`

Pagination shape: `{ "data": [...], "next_cursor": "opaque_or_null" }` with `?limit` capped at 100.

Rate limit: 600 req/min burst, 20 req/s sustained per token. Returns 429 with `Retry-After`.

OpenAPI spec: `GET /api/v1/openapi.json`

### Resources

- `GET /api/v1/me`
- `GET /api/v1/org`
- `GET /api/v1/clients` / `GET /api/v1/clients/:id` (broker)
- `POST /api/v1/clients/invitations` (write)
- `GET /api/v1/policies` / `GET /api/v1/policies/:id`
- `GET /api/v1/policies/:id/certificates` / `POST /api/v1/policies/:id/certificates` (write)
- `GET /api/v1/notifications`
- `GET /api/v1/activity`

Write requests are audit-logged to `apiAuditLog`.

## Documentation Maintenance

When behavior changes, prefer updating:

- `AGENTS.md` for engineering and agent workflow detail
- the Primitive Catalog above and `.agents/skills/glass-primitives/SKILL.md` when adding, removing, renaming, or materially changing reusable primitives
- inline comments only when they clarify non-obvious code paths

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.

<!-- convex-ai-end -->
