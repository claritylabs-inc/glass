# AGENTS.md

Guidance for any coding agent working in this repository: Codex, Claude Code, Cursor, or similar tools.

## Workflow

- After major architecture or data-flow changes, update `AGENTS.md`.
- Prefer documenting current behavior over planned behavior.
- Treat the Convex worktree as potentially dirty. Do not revert unrelated user changes.
- Use `dayjs` for date parsing, formatting, comparisons, and timestamps in new or touched code instead of raw `Date.now()`, `Date.parse()`, or `new Date(...)`.

## Commands

- `npm install` — install dependencies
- `npm run dev` — start the Next.js app
- `npx convex dev` — start the Convex backend (also pushes schema + functions to dev)
- `npx convex deploy --yes` — push Convex functions to production
- `npm run build` — production build
- `npm run lint` — repo-wide ESLint
- `npx tsc --noEmit` — TypeScript validation (Next.js)
- `npx convex typecheck` — TypeScript validation (Convex functions)
- `npm run operator:provision-broker -- --name "Broker Name" --admin-email "admin@example.com"` — repo wrapper around the private installable operator CLI for provisioning broker orgs/accounts without using the web app
- `npx convex run seed:seed` — seed demo data
- `npx convex run actions/backfillChunks:backfill --args '{"orgId":"..."}'` — embed existing documents for vector search

## High-Level Architecture (v0.2.0)

Glass is an insurance intelligence platform built on Next.js + Convex. v0.2.0 is a deliberate simplification: the product is now focused on policies, an agentic chat assistant, an agentic inbound email agent, and a lightweight per-org knowledge store (`orgMemory`). Applications v2, Client Passport / ACORD 125, email inbox scanning, org context documents, and the Merge.dev sync backend have all been removed.

Core layers:

- Frontend: Next.js 16 App Router, React 19, Tailwind 4
- Backend: Convex queries, mutations, actions, scheduler, file storage, vector search
- Browser sync: `@claritylabs/cl-sync` provides reusable IndexedDB-backed local-first sync primitives. The package is maintained as the sibling public package `../cl-sync`; Glass owns only its app-specific collections and cache policies under `lib/sync/`.
- AI runtime: Vercel AI SDK (`ai`)
- Extraction, query agent, and prompts: `@claritylabs/cl-sdk@1.2.x`
- Providers: OpenAI, Anthropic, DeepSeek
- PDF parsing: policy and quote extraction use the single stable `cl-sdk` pipeline. When the Railway extraction worker is available, Glass first preprocesses PDFs with Docling and passes serialized DoclingDocument JSON into `cl-sdk`; if Docling fails or times out, Glass falls back to raw PDF bytes plus local PDF.js source spans. Docling is hosted inside `extraction-worker/`, not as a separate service, feature flag, or callback interception layer.
- Email: outbound + inbound via Resend, plus user-connected generic IMAP mailboxes for live agent search/read. All outbound Resend calls go through `convex/lib/resend.ts` (`sendResendEmail`). The primary signed-in web app is `app.glass.insure` for both broker and client users; broker/client landing is role-based after sign-in. `glass.claritylabs.inc` is the legacy browser host and redirects to `app.glass.insure`. `auth.glass.insure` is an auth/invite email sender domain rather than a separate web app host. Agent mail defaults to `glass.insure`, notification mail defaults to `notifications.glass.insure`, and auth/invite mail defaults to `auth.glass.insure`; legacy inbound agent addresses at `glass.claritylabs.inc` and `dev.claritylabs.inc` remain recognized. Inbound webhook at `POST /resend-inbound`.
- Program administrator partners: MGAs, carriers, and underwriters that can approve or certify output are modeled as first-class partner organizations with `partnerKind: "program_admin"`. The registry in `partnerPrograms` supports line, subline, combined-line, and alias-based programs; active programs are embedded in `partnerProgramEmbeddings` so COI generation can semantically match policy text, while policy-level overrides remain available for ambiguous extraction. Partner users have approval-scoped access through `/partner/approvals`, `/partner/programs`, and `/partner/templates`, not broad broker/client workspace access.
- Program records may include a structured `securityPanel` listing carriers, Lloyd's underwriters, reinsurers, or coverholders plus each member's participation percentage. Certified COI generation exposes that panel to standard insurer rows and custom PDF overlay fields such as `security_panel`, `capacity_panel`, and `insurer_panel`.
- UI forms should use the shared React select/dropdown primitives from `components/ui/select.tsx` or `components/ui/dropdown-menu.tsx` instead of native `<select>` elements. Multi-value business fields such as aliases, labels, categories, or tags should be stored and edited as lists, not comma-delimited text.
- Auth/loading: the app shell uses `GlassSyncProvider`, an inline minimal boot hint, and safe scoped cached shell records to avoid full-page skeletons on repeat visits after Convex verifies auth. Cached data must remain scoped by user/org and must be cleared on confirmed sign-out or auth failure. The production service worker in `public/sw.js` is limited to same-origin static assets and must not cache app HTML, API routes, OAuth, MCP, Convex, or other dynamic/authenticated responses.
- iMessage / Spectrum: Photon-backed iMessage is production-only. Set `IMESSAGE_ENABLED=true`, `IMESSAGE_WORKER_URL`, `IMESSAGE_WORKER_SECRET`, and `NEXT_PUBLIC_GLASS_IMESSAGE_NUMBER` only in production with the production Photon account. For dev/preview testing, keep `IMESSAGE_ENABLED` false and use the Spectrum Terminal provider in `imessage-worker` (`SPECTRUM_PROVIDER=terminal`, `IMESSAGE_TERMINAL_FROM_PHONE=<test user phone>`). Convex accepts terminal-driven inbound messages only when `IMESSAGE_TERMINAL_ENABLED=true`; do not set `NEXT_PUBLIC_GLASS_IMESSAGE_NUMBER` in dev/preview unless intentionally advertising a test line. iMessage direct chats and groups both enter through `/imessage-inbound`; group chats are keyed by Photon chat GUID and mirrored into `imessageChats` / `imessageParticipants` so Glass can distinguish linked users from anonymous participants. If a thread originated on iMessage and a user later adds messages from web chat, Convex mirrors the web user message and Glass reply back through `imessage-worker` with explicit web-chat context; generated PDFs and other stored thread attachments should be sent through the same outbound worker path when resolvable. These web-to-iMessage sync sends must use stable `clientMessageId` idempotency keys and the `imessageOutboundSends` ledger so scheduler retries do not duplicate iMessage messages; the worker also treats duplicate `/send` requests with the same `clientMessageId` as already handled.

## Current Model Routing

Default model routing lives in [convex/lib/models.ts](convex/lib/models.ts), with broker-visible catalogs in [convex/lib/modelCatalog.ts](convex/lib/modelCatalog.ts).

- `chat`, `chat_with_tools`, `email_draft`, `email_reply` → `gpt-5.4-mini`
- `application_authoring`, `analysis` → `gpt-5.4-mini`
- `extraction`, `classification`, `email_extraction`, `document_extraction` → `gpt-5.4-nano`
- `summary`, `triage`, `security` → `gpt-5.4-mini`
- `embeddings` → `text-embedding-3-small` at 1536 dimensions

Usage notes:

- Broker admins can configure their own provider API keys and per-use-case model routes in `/settings?section=models`.
- Broker model settings are stored in `brokerModelSettings`, keyed by broker org. Client-org workflows inherit the managing broker's settings.
- Operators can configure global default routes in `/operator/models`; broker admins still only see provider-key-backed overrides for their own broker org.
- The broker UI never exposes Glass's exact default model configuration; broker model selectors unlock only for providers where the broker has supplied an API key.
- `embeddings` is routed separately from language-model use cases and is restricted to embedding models. Embeddings remain 1536-dimensional to match Convex vector indexes.
- Main org-aware actions use `getModelForOrg(ctx, orgId, task)`, which applies broker overrides only when a matching broker-owned provider key exists.
- Model catalogs in [convex/lib/modelCatalog.ts](convex/lib/modelCatalog.ts) mirror Vercel AI Gateway `provider/model` slugs. Runtime calls use direct provider SDKs when an explicit broker key or matching server env key exists; otherwise they route through Vercel AI Gateway using `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`.
- SDK-facing extraction passes the org context into the SDK callbacks, so broker-owned provider keys and routes apply to `cl-sdk` model calls. SDK-facing workflows also pass model capability metadata from `MODEL_CAPABILITIES` in [convex/lib/modelCatalog.ts](convex/lib/modelCatalog.ts), so `cl-sdk` can resolve task-aware token budgets for extraction, query, and PCE instead of relying on low static caps.

Fallback behavior:

- If no broker key exists for a route, Glass uses the operator global default when present and otherwise the static `MODEL_ROUTING` default.
- If a global/static route targets a provider without a server-side provider key, Glass uses Vercel AI Gateway instead of failing on a missing provider key.
- `getModel()` falls back to Claude Haiku if a provider is unavailable.
- `generateTextWithFallback()` and `generateStructuredWithFallback()` use task-aware fallback policy. Missing API key errors are not retried, because retrying another OpenAI model does not fix a missing key and only adds latency. Low-cost extraction/classification calls stay on the nano path by default; only SDK `taskKind`s that represent validation repair, ambiguous synthesis, unsupported source-evidence resolution, or high-risk packet generation may escalate to the fallback route in [convex/lib/modelCatalog.ts](convex/lib/modelCatalog.ts).
- Web chat streaming in [processThreadChat.ts](convex/actions/processThreadChat.ts) stays on `gpt-5.4-mini` by default and retries transient provider `server_error` / 5xx stream failures once before any visible text, tool call, or side-effectful work has started. If a broker override is active, that retry may use the configured fallback route; otherwise it retries the same `gpt-5.4-mini` route.

## Compliance Requirements

Glass now has a top-level compliance workflow for contractor/vendor insurance monitoring. Requirement imports can also create source-backed requirement records from leases, client contracts, vendor requirement packets, or other documents. Uploaded or pasted sources are recorded in `requirementSourceDocuments`, and created `insuranceRequirements` keep `sourceDocumentId`, `sourceDocumentName`, `sourceType`, `sourceExcerpt`, and optional source page fields so web UI, agents, MCP, CLI, and REST responses can explain the original source language behind a requirement. The same import surface powers bulk requirement import and lease/contract extraction; extracted requirements for the org's own obligations belong in **My requirements** (`appliesTo: own_org`), while vendor/customer standards remain in **Vendor requirements**.

Glass now has a top-level compliance workflow for contractor/vendor insurance monitoring. `insuranceRequirements` stores one active/archived requirement set per organization; requirements are category-tagged rules that apply to vendors, the org's own coverage, or both. Requirement records deliberately mirror the policy `coverages` shape (`name`, `coverageCode`, `limit`, numeric `limitAmount`, limit typing, deductible fields, and `originalContent`) so compliance comparison can operate on the same schema as extracted policy coverage data. Client/customer requirements establish the minimum vendor standard. Requirements can be created one at a time or bulk-generated from pasted text / uploaded requirement documents through `convex/actions/complianceRequirements.ts`, which extracts text from TXT/Markdown/PDF/DOCX/CSV/JSON inputs and uses Glass's static `gpt-5.4-mini` chat route to produce coverage-shaped structured requirements. PDF requirement imports use local PDF.js text extraction. Current web and MCP surfaces compute live checklist status from active connected vendors plus extracted `policies` data. The daily `vendorComplianceMonitor` cron records deterministic snapshots in `vendorComplianceChecks`, creates client notifications and notification emails for new or recurring compliance gaps, drafts vendor follow-up emails when a vendor contact is available, and sends iMessage/SMS alerts to org admins with phone numbers when the worker is configured. The deterministic checker matches requirement categories/text against policy types, summaries, coverages, expiration dates, structured coverage limits, and insured names, returning `met`, `missing`, `expiring_soon`, or `expired`; future LLM review should augment this table rather than replacing requirement ownership.

Surfaces:

- Web: `/compliance` is focused on requirement creation/management. Its top-bar actions open separate right-side asides for bulk import and manual entry; it should not render vendor/client monitoring cards. Vendor orgs also see active client-owned vendor requirements as read-only rows under **My requirements**, labeled as client requirements from the source client org; those rows cannot be archived by the vendor. **My requirements** rows include live compliance status badges (`Met`, `Needs attention`, `Not met`) based on the org's current policies. Orgs that are purely vendors hide the **Vendor requirements** tab, while mixed orgs still show both **Vendor requirements** and **My requirements**.
- Connect: `/connect/vendors` is for vendors the org contracts with and monitors against its own standards; active vendor rows hide the invite/note copy, show one of `invited`, `waiting on policies`, `active / noncompliant`, or `active / compliant`, expand into a full requirement checklist with matched policy, limit, expiration, and insured-name details, and link to read-only vendor policy pages under `/connect/vendors/:vendorOrgId/policies`. `/connect/clients` is for clients the org reports insurance requirements to and approves access for. Vendor/client monitoring belongs on these Connect surfaces, not on `/compliance`. Legacy `/connected-orgs/*` paths redirect to the shorter `/connect/*` routes.
- MCP/CLI/REST: compliance requirements and vendor compliance are exposed through `list_insurance_requirements`, `create_insurance_requirement`, `list_vendor_compliance`, `GET/POST /api/v1/compliance/requirements`, and `GET /api/v1/compliance/vendors`.
- Agent: web chat and MCP chat include a vendor compliance snapshot in context so users can ask questions such as “are all my vendors compliant?”
- Broker portfolio agent: when the active org is a broker workspace, web chat, broker-staff inbound email to the broker handle, direct broker iMessage/SMS, MCP, and CLI `ask_glass` resolve a broker portfolio scope. That scope includes the broker org plus managed client orgs, keeps vector retrieval filtered per org, labels client data in prompts/tool results, and keeps connected-email mailbox access governed by existing connected-email account rules rather than broker-of-client access. Broker mode is internal and can compare clients, summarize portfolio risk, identify renewals, and draft broker-side follow-up, while client-facing and mixed-participant contexts must not disclose unrelated client data.
- Agent tools: web chat, inbound email, iMessage, and MCP chat expose `lookup_connected_vendors`, `lookup_vendor_policies`, and `lookup_vendor_compliance` so agents can answer vendor-specific compliance questions with the actual vendor roster, vendor policies, and requirement-by-requirement diffs instead of relying only on the generic requirements summary.

## Policy Change Requests And Endorsements

Policy change requests now use a lightweight case workflow instead of making typed PCE packet items the primary user model. `policyChangeCases` keeps legacy status values during migration, but new writes use `intake`, `needs_info`, `ready_to_submit`, `submitted`, `waiting_for_endorsement`, `completed`, `declined`, and `cancelled`. SDK PCE output remains available as optional internal analysis for evidence, missing-info questions, and packet assistance.

Shared agent tools across web chat, inbound email, iMessage, MCP, and CLI ask paths are `create_policy_change_request`, `add_policy_change_info`, `draft_policy_change_email`, and `complete_policy_change_from_endorsement`. Broker recipient emails must come from explicit user input or known contacts; otherwise Glass drafts the email and asks for the recipient.

Completed endorsements are appended to the existing policy ID rather than creating a replacement policy. The append path inserts `policyFiles` rows with `fileType: "endorsement"`, records a `policyUpdateRuns` audit row with before/after snapshots and field diffs, updates current policy fields only when explicitly supplied by endorsement evidence, refreshes declaration facts, marks the case complete, and emits policy-change completion notifications. Full replacement extraction still uses the existing policy extraction pipeline.

`policyDeclarationFacts` stores normalized comparable declaration and policy facts with provenance fields, and `declarationDiscrepancies` stores conflicts across active policy facts. Extraction completion syncs declaration facts and scans for actionable identity/location discrepancies; proactive external email/iMessage outreach uses notification preferences and defaults iMessage off unless the user opts in.

## Connected Vendor/Client Accounts

Glass supports one-way connected organization relationships for vendor/client insurance access, modeled after the platform/connected-account idea of a parent org receiving scoped access to a connected org's records. The implementation intentionally keeps this separate from the broker/client hierarchy so broker portal features remain broker-only.

## Broker Identity For Client Orgs

Client-side broker identity is resolved through [convex/lib/brokerIdentity.ts](convex/lib/brokerIdentity.ts). For broker-connected client orgs, Glass uses the primary `brokerClientAssignments` producer as the per-client broker contact, with optional assignment-level overrides for contact name, email, and phone. If no per-client assignment exists, Glass falls back to the broker org's `primaryInsuranceContactId`. Standalone client orgs can store manual broker company/contact/email/phone fields directly on `organizations`.

The shared resolver is used by web chat, inbound email, iMessage, email drafting, sidebar broker contact display, and iMessage group recipient resolution. When a client asks Glass to send something to "my broker," the email path should resolve the broker contact email from this identity and draft for confirmation rather than auto-sending. Connected broker identity is editable by broker admins from the client settings surface; standalone manual broker identity is editable by the client org admin.

## Broker-Created Client Drafts

Broker-created client drafts are created only from explicit invite-drawer actions, not while the broker types. The broker-side client invite drawer can prefill the client's org name, website, primary user name, primary user phone, and policy PDFs before sending. Email remains required because it creates or updates the invited user record and is the invite recipient; phone is optional but must be a unique valid E.164-capable user phone because iMessage identity depends on user-phone uniqueness. Website enrichment for broker-created drafts must target the client org, not the broker org, and staged policy PDFs are uploaded only after the draft exists so extraction can run in the background against the client org.

## Team Invitations

Team-member invitations use `orgInvitations` for the pending membership record, but the settings drawer must call `orgs.sendMemberInvitation` rather than the raw `orgs.inviteMember` mutation. The action creates or refreshes the pending invite, sends the auth-domain email through Resend, and rolls back only newly-created invites when delivery fails. Invited users sign in with the invited email address; `AuthGuard` auto-accepts a pending `orgInvitations` row for the authenticated viewer, creates the membership through `orgs.acceptInvitation`, and marks user onboarding complete so invited teammates land directly in the org.

## Operator Provisioning

Broker orgs and broker admin accounts can be created from the private installable operator CLI without adding an admin web portal or requiring a customer OTP during setup. The CLI package lives in `operator-cli/` as `@claritylabs/glass-operator` and exposes the `glass-operator` binary; the repo wrapper `npm run operator:provision-broker` builds and runs the same package locally. It calls `convex/operatorProvisioning.ts` directly through Convex. The Convex deployment requires `OPERATOR_PROVISIONING_SECRET`; the CLI stores that token locally with `glass-operator auth:login` or reads `GLASS_OPERATOR_TOKEN` in agent environments. Requests are HMAC-signed with timestamp, nonce, and body hash, and Convex stores used nonces in `operatorAuthNonces` to reject replay. This flow may create or update the broker org, create/link the admin user account for the provided email, add the admin org membership, mark onboarding complete, and optionally seed draft client orgs. It deliberately does not create a browser session or bypass normal login; the broker contact still signs in with the usual OTP when they first access Glass.

Internal Glass operators are a separate account class, not customer org admins. Operator users have `users.accountKind: "operator"` plus an `operatorProfiles` row and must not have `orgMemberships`; customer users have missing/`customer` account kind and get tenant permissions only through `orgMemberships`. Operator accounts are bootstrapped only from `OPERATOR_BOOTSTRAP_EMAILS` through `/operator/login`. The `/operator` console lists broker tenants, creates setup broker shells, switches broker `operatorStatus` between `onboarding` and `live`, launches broker access emails, and starts audited org-role impersonation. `/operator/clients` lists both standalone and broker-managed client tenants, with a broker column to distinguish them; creating from this page can create either a standalone client tenant or a broker-linked client tenant for bulk setup. `/operator/mgas` creates and launches MGA/program administrator tenants as `type: "partner"` plus `partnerKind: "program_admin"` with an initial `partnerPrograms` row. `/operator/models` controls global model defaults in `globalModelSettings`; runtime model routing applies broker-owned provider-key overrides first, then operator global defaults, then code defaults in `MODEL_ROUTING`. `/operator/extractions` shows retained policy extraction trace sessions across tenants for operator debugging; it exposes metadata-only timing, phase, log, model/provider, token, and error data, not prompts, PDF text, or provider request bodies. Operator pages read current operator identity, tenant lists, global model settings, and extraction trace data through the scoped local query cache in `lib/sync/operator-cached-queries.ts`; create/launch/status mutations patch that cache immediately, while slug/handle uniqueness checks stay live against Convex. Operator-created standalone clients, broker-linked clients, and MGAs use strict email verification seeded to the admin email and are launched through the normal `/login` OTP flow. Operator impersonation is an app-level overlay stored in `operatorImpersonationSessions`, not a Convex Auth session takeover. Setup writes are allowed only while the target tenant is `operatorStatus: "onboarding"`; live-tenant impersonation is read-only. Normal app routes redirect operator accounts back to `/operator` unless an impersonation session is active, and onboarding operator-provisioned tenants are hidden from external users until launch.

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

`orgMemory` is the single per-org knowledge store. It replaces the old `orgIntelligence`, `businessContext`, dream consolidation, and proactive analysis pipelines.

### Schema: `orgMemory`

Each entry has:

- `orgId`
- `kind` — `fact` | `preference` | `risk_note` | `observation`
- `content` — free-text string
- `source` — `extraction` | `analysis` | `chat` | `email`
- `sourceRef` — optional ID of originating record
- `createdAt`

No embeddings, no supersession graph, no category taxonomy. Retrieval is list-based and filtered by `kind` / `source`.

## Connected Email (IMAP)

Users can connect generic IMAP mailboxes from Settings → Email. The default access scope is user-only; users can opt into org scope so direct org members and agents acting for that org can search the mailbox. Connected-client and broker-of-client access do not grant mailbox access. Glass stores account metadata and encrypted credentials in `connectedEmailAccounts`; it does not persist mailbox message bodies or mailbox attachment metadata during ordinary search/read. IMAP passwords/app passwords are encrypted server-side with `EMAIL_CONNECTIONS_ENCRYPTION_KEY` and are never returned to the browser or agent tools.

Agent mailbox tools perform live IMAP search/read, read bounded text from selected PDF/DOCX/text-like attachments, save mailbox attachments or the email message itself into the current thread for reuse, import selected PDF attachments into the existing policy/quote extraction pipeline, import email bodies and lease/contract/vendor requirement attachments into internal or vendor compliance requirements, and send connected-vendor invites when the user requested that action. Complex mailbox tasks should go through the `mailbox_coordinator` model route (`gpt-5.5` by default), which can call live mailbox tools and existing Glass import actions. Main web chat exposes the mailbox coordinator as a single tool and stores a `mailbox_task` artifact so the message shows a compact background-process opener and the right panel shows the coordinator's plan, search audit, specific email evidence, and user-confirmed buttons to save attachments to the thread, import policy/quote documents, plus create vendor/internal requirements; the direct mailbox search/read/import tools remain behind the coordinator rather than being attached to every chat request. Coordinator searches are intentionally agentic: it derives targeted search terms and explicit `dateFrom` / `dateTo` windows from the user's request, searches all accessible connected mailboxes unless the user selected `/` mailbox targets, ignores messages sent from `glass.insure`, `glass.claritylabs.inc`, or their subdomains to prevent reference loops, inspects promising messages, then broadens or pivots terms/date ranges before concluding that an item is missing. When the coordinator identifies attachments the user may need again, it should save them to the thread with `save_connected_email_attachments_to_thread`; saved thread attachments are stored in Convex file storage on a `threadMessages` row and are available to the email expert as uploaded-file attachments without another mailbox search. When the user asks to attach, forward, preserve, or provide proof of an email whose useful content is in the email body, the coordinator should use `save_connected_email_message_to_thread`, which exports the message as an attachable `.eml` file before drafting or sending. For web chat, the coordinator writes a running `mailbox_task` artifact onto the current agent message as soon as it has a plan, so the thread shows an auditable background process while the live IMAP search is still running. For iMessage/text requests, the coordinator generates a short plan first and sends a status text before running the live mailbox workflow. Imported policies, requirements, vendor invites, notes, and thread artifacts are persisted through their existing first-class tables; raw mailbox messages remain remote unless a user-directed import stores an attachment/artifact.

Web chat also exposes `render_email_preview` for outbound email drafts. It renders the current or specified `pendingEmails` draft through Playwright as a PNG screenshot or PDF printout, stores the rendered file in Convex storage, and attaches it to the current assistant message so users can inspect email formatting without sending. Runtime environments need Playwright's Chromium browser installed; if the browser binary is missing, the tool returns a renderer-unavailable result instead of fabricating a preview.

Outbound broker emails for policy change requests are persisted as `pendingEmails` and email `threadMessages` with `policyChangeCaseId`. Sending assigns a deterministic RFC `Message-ID` and uses the thread-specific email address as Reply-To when available, so broker replies to the outbound email can be correlated back to the original thread and policy change case. Inbound broker replies matched by `In-Reply-To`, `References`, or policy-change email thread context are treated as direct case replies, recorded on the case timeline, and the email agent is prompted to use `complete_policy_change_from_endorsement` for attached endorsement PDFs instead of importing them as standalone policy documents.

Daily mailbox attention scans run from the Railway cron service in `mailbox-scan-worker/`. The worker starts once daily at `0 15 * * *` UTC, calls `POST /cron/connected-email/scan` on the Convex site URL, and exits. `actions/connectedEmail.scanPreviousDay` requires `EMAIL_SCAN_CRON_SECRET`, scans every org with active org-scoped IMAP accounts for the previous calendar day, classifies only insurance-specific attention items through the mailbox coordinator route, and surfaces concise proactive alerts by iMessage when org members have phone numbers and the worker is configured, otherwise by proactive web chat threads. `actions/connectedEmail.scanPreviousDayForOrg` runs the same flow for one org. The scan reads mailbox content live and does not persist raw messages.

### Writers

| Source                         | Where                                              | Trigger                                   |
| ------------------------------ | -------------------------------------------------- | ----------------------------------------- |
| `save_note` chat tool          | `convex/actions/processThreadChat.ts` (buildTools) | Agent tool call during chat               |
| Website enrichment             | `convex/actions/extractCompanyInfo.ts`             | Client onboarding step 2 + manual refresh |
| Email agent post-reply summary | `convex/actions/handleInboundEmail.ts`             | After a tool-using email reply resolves   |

## cl-sdk Integration

The Glass-specific `cl-sdk` wiring lives under `convex/lib/`.

- [sdkCallbacks.ts](convex/lib/sdkCallbacks.ts): adapts Glass model routing to `cl-sdk` callbacks
- [extraction.ts](convex/lib/extraction.ts): builds a preconfigured extractor
- [documentMapping.ts](convex/lib/documentMapping.ts): maps SDK documents to Convex policy records
- [convexDocumentStore.ts](convex/lib/convexDocumentStore.ts): `DocumentStore` adapter
- [convexMemoryStore.ts](convex/lib/convexMemoryStore.ts): `MemoryStore` adapter
- [queryAgent.ts](convex/lib/queryAgent.ts): `createQueryAgent()` wrapper
- [agentPrompts.ts](convex/lib/agentPrompts.ts): SDK prompt exports plus Glass retrieval-backed context builders

### Callback Contract

Current `cl-sdk` passes document content through callback `providerOptions`.

- `providerOptions.pdfBase64` carries the PDF for classification, planning, review, and page-scoped extraction calls when extraction is using raw PDF input.
- `providerOptions.doclingText` carries full or page-scoped text when extraction is using a host-provided DoclingDocument input.
- `providerOptions.images` carries page images when PDF-to-image conversion is used.

Glass translates those into AI SDK multipart message content in `sdkCallbacks.ts`:

- PDFs become `{ type: "file", data, mediaType: "application/pdf" }`
- images become `{ type: "image", image, mediaType }`
- Docling text is already injected into the SDK prompt and preserved in `providerOptions.doclingText`; Glass callbacks do not convert it back to a PDF file part.

Notes:

- The `providerOptions.images` items from `cl-sdk` do not carry a `type` field; Glass adds `type: "image"` when building AI SDK parts.

### Extraction Shape

`cl-sdk` 0.17 adds first-class `definitions` and `coveredReasons` arrays, plus premium promotion from declaration fields into `premium`, `totalCost`, and `taxesAndFees`.

Glass persists:

- Top-level policy financials: `premium`, `totalCost`, `taxesAndFees`, `premiumBreakdown`, `minPremium`, `depositPremium`
- Extracted dates are normalized to `MM/DD/YYYY` before persistence where the source value is parseable. Monetary and limit-like fields keep user-facing display strings while also storing numeric companions such as `premiumAmount`, `totalCostAmount`, coverage `limitAmount` / `deductibleAmount`, and row-level `amountValue` for deterministic comparison.
- Document detail: `document.sections`, `document.definitions`, `document.coveredReasons`, `document.endorsements`, `document.exclusions`, `document.conditions`
- Declarations, form inventory, and supplementary facts as top-level policy fields
- Raw source evidence in `sourceSpans` and embedded `sourceChunks` when cl-sdk returns source spans/chunks. These source units preserve stable `sourceSpanIds` for exact policy citations.
- Glass performs a deterministic post-extraction policy-period check over raw PDF source spans before persisting policy fields. Clear `PERIOD OF INSURANCE` / `POLICY PERIOD` / `POLICY TERM` source text, including day-month-year table layouts, is allowed to override missing, malformed, or conflicting SDK `effectiveDate` / `expirationDate` values.

### Token Limits

Glass preserves higher extraction token allowances for long-list extractors in `sdkCallbacks.ts`.

- Default token limits come from `cl-sdk`.
- If the prompt matches the exclusions extractor, Glass raises the effective max token count to `8192`.
- If the prompt matches the covered reasons extractor, Glass raises the effective max token count to `24576`.

## Policy Extraction

Two entrypoints, both PDF-only:

- [convex/actions/extractFromUpload.ts](convex/actions/extractFromUpload.ts) — `extractFromUpload` (public action) for direct user uploads; `extractFromUploadInternal` (internal action) for the email agent.
- [convex/actions/extractPolicy.ts](convex/actions/extractPolicy.ts) — internal helpers used by the email agent via the `extract_policy_attachment` tool.
- [convex/actions/reExtractFromFile.ts](convex/actions/reExtractFromFile.ts) / [retryExtraction.ts](convex/actions/retryExtraction.ts) — re-run and retry.

### Flow

1. Fetch or receive a PDF.
2. Store the raw PDF in Convex file storage.
3. Load the PDF bytes from Convex file storage. If the Docling worker endpoint is configured, convert the PDF to a serialized DoclingDocument and run `buildExtractor().extract({ kind: "docling_document", document, sourceKind: "policy_pdf" }, documentId)`. If conversion is unavailable, build local PDF.js source spans and run `buildExtractor().extract(pdfBytes, documentId, { sourceSpans })`. Do not pass a signed storage URL into `cl-sdk`; review and follow-up extractors can run long enough that repeated URL fetches become unreliable.
4. Verify critical policy-period dates from source text when a clear declaration-page period is present, then map `InsuranceDocument` into Glass policy fields.
5. Run coverage declaration scoping before persistence. When the SDK extracts multiple limits for the same coverage and limit role, Glass scores declarations, selected-option markers, summary/confirmation pages, endorsements, and source-span evidence; persists only the best current coverage value; and stores `extractionReview.questions` for any same-role limit conflict that still needs client/broker confirmation. Distinct limit roles such as per-occurrence and aggregate remain separate coverage rows.
6. Persist the extracted document and metadata.
7. Chunk the document and embed each chunk with `text-embedding-3-small`.
8. Store chunks in `documentChunks` for semantic retrieval.

Pipeline runtime state:

- Policy extraction status remains denormalized on `policies.pipelineStatus` / `pipelineError` for fast list filtering.
- High-churn extraction runtime state lives in `policyExtractionRuns`: `pipelineCheckpoint`, `pipelineLog`, leases, heartbeat timestamps, and detailed progress. This avoids rewriting large policy documents for every log, checkpoint, and heartbeat. Large `cl-sdk` checkpoint payloads and extraction-to-embedding payloads are stored in Convex file storage and tracked by `policyExtractionArtifacts` records keyed by policy/job ID and artifact kind. The pipeline checkpoint only keeps compact storage IDs and summaries. `cl-sdk` assemble checkpoints intentionally omit the assembled document before storage, because the document can be rebuilt from checkpointed extraction memory and storing both memory and document can make the checkpoint artifact too large.
- Durable operator debugging history lives separately in `policyExtractionTraceSessions` and `policyExtractionTraceEvents`. Each upload/full retry starts a new trace session; resume retries reuse the checkpoint's `traceId` when available. Trace events record phase timing, pipeline logs, model-call metadata, external-worker events, embedding batch summaries, token usage, provider/model/route-source/transport, durations, and errors. Trace records intentionally do not store prompts, source text, PDFs, or provider request bodies, and the daily `extractionTraces.sweepExpired` cron removes records after 90 days.
- Query surfaces such as `policies.get` and `policies.getInternal` merge runtime state from `policyExtractionRuns`, falling back to legacy fields on `policies` for old in-flight jobs.
- The extract phase stores `documentChunksForEmbedding`, `sourceSpansForStorage`, and `sourceChunksForEmbedding` in a storage-backed `embedding_payload` artifact before advancing to `embed_and_store`, so a resumed embedding phase can reload transient artifacts without inflating checkpoint documents. Artifact blobs are cleaned up after durable embedding/source-span storage succeeds, cancellation, terminal success, and full restart; generic errors keep artifacts for resume/retry.
- Extraction concurrency defaults to 6 SDK worker calls (`EXTRACTION_CONCURRENCY`, bounded 1-8), and page mapping, focused extraction, and formatting default to that same concurrency unless independently tuned with `EXTRACTION_PAGE_MAP_CONCURRENCY`, `EXTRACTION_EXTRACTOR_CONCURRENCY`, and `EXTRACTION_FORMAT_CONCURRENCY` (each bounded 1-8). Review defaults to `EXTRACTION_REVIEW_MODE=auto` with 1 round (`EXTRACTION_MAX_REVIEW_ROUNDS`, bounded 0-2), so cl-sdk's evidence-gated review semantics decide when a repair pass is useful. Embedding defaults to 8 concurrent embedding calls (`EXTRACTION_EMBEDDING_CONCURRENCY`, bounded 1-16). Current dev/prod deployments intentionally run aggressive speed settings: extraction/page-map/extractor/format concurrency 8 and embedding concurrency 16.
- Long-running SDK extraction can be offloaded to the standalone Railway worker in `extraction-worker/` by setting `EXTRACTION_WORKER_MODE=external` and a shared `EXTRACTION_WORKER_SECRET` on Convex, then running the worker with `CONVEX_URL` and the same secret. In external mode Convex remains the durable job ledger: uploads/retries create `policyExtractionRuns` checkpoints, the worker claims extract-phase leases, heartbeats, saves compact `cl-sdk` checkpoints to storage, completes extraction, and hands the job back to Convex for embedding/source-span persistence and post-processing. The claim action returns broker model routes/provider keys so trusted workers preserve extraction/classification overrides instead of falling back to only static env routing. The same worker also exposes authenticated `POST /docling/convert` when `PORT` is set; configure Convex with `EXTRACTION_WORKER_URL` plus `EXTRACTION_WORKER_SECRET` so requirements imports, mailbox attachment reads, on-demand source lookup, supplementary extraction, and chat/email/iMessage PDF attachment context can use Docling text with PDF/PDF.js fallback.

Cancellation:

- `policies.cancelExtraction` marks `pipelineError` as `Cancelled by user`.
- `policyExtraction.ts` checks that flag before phases, before/after each `cl-sdk` model call, and before checkpoint saves. Cancellation stops at the next provider-call boundary and is recorded as an expected pipeline error, not as a transient action failure.
- `policyExtraction:advance` uses a Convex-backed checkpoint lease before running a phase. This prevents overlapping scheduled advances from running the same long extraction phase concurrently and racing to overwrite extracted policy data. The lease is heartbeat-based and watchdog-scheduled, so if an advance action dies during a long provider call, a later advance can reclaim the checkpoint after the heartbeat goes stale instead of leaving the policy stuck in `running`. A five-minute cron (`policyExtraction.sweepStale`) also scans `policyExtractionRuns` by `pipelineStatus`/`updatedAt` and requeues stale running checkpoints, or marks runs with no resumable checkpoint as errored.

## Retrieval And Agent Context

Glass uses two vector-backed stores plus one list-based store:

- `sourceChunks` — raw source-span evidence chunks (vector), preferred for exact policy terms when present
- `documentChunks` — extracted policy/quote content chunks (vector)
- `conversationTurns` — cross-thread conversation memory (vector)
- `orgMemory` — business facts/preferences/risk notes/observations (list, filtered by kind/source)

[agentPrompts.ts](convex/lib/agentPrompts.ts) builds agent context:

- `buildDocumentContext()` — if chunks exist, embed query and search `documentChunks`; otherwise fall back to keyword-scored document summary.
- When `sourceChunks` exist, `buildDocumentContext()` searches them before `documentChunks` and labels the results as source-span evidence with stable `sourceSpanIds`.
- `lookup_policy_section` uses [policyLookup.ts](convex/lib/policyLookup.ts) in web chat, inbound email, iMessage, and MCP chat to return structured policy matches enriched with stable `sourceSpanIds` and short raw evidence excerpts. If extracted structured data is missing or weak, it also searches original-PDF source evidence from `sourceChunks` / `sourceSpans`; for older policies without stored spans it can parse the stored policy PDF on demand for read-only evidence.
- `confirm_policy_fact` lets agents persist a concise policy fact after `lookup_policy_section` returns supporting original-PDF `sourceSpanIds`. The tool records an `orgMemory` fact and may patch only a constrained set of top-level policy fields when the cited PDF text directly supports the update.
- SDK query-agent wrappers use [convexSourceRetriever.ts](convex/lib/convexSourceRetriever.ts) to search `sourceChunks` and return source spans for SDK hybrid retrieval.
- `buildOrgMemoryContext()` — lists recent `orgMemory` entries, grouped by kind.
- `buildConversationMemoryContext()` — vector search over `conversationTurns` for cross-thread memory.
- Web chat composer steering lives in [components/glass-prompt-input.tsx](components/glass-prompt-input.tsx) and [convex/agentTargets.ts](convex/agentTargets.ts). Typing `@` opens a custom picker for policies, quotes, and requirements; typing `/` opens accessible connected mailboxes. Selected targets are stored on the user `threadMessages` row as `referencedPolicyIds`, `referencedQuoteIds`, `referencedRequirementIds`, and `referencedMailboxIds`, then [processThreadChat.ts](convex/actions/processThreadChat.ts) injects them as explicit context. Selected mailbox IDs are passed into [mailboxCoordinator.ts](convex/actions/mailboxCoordinator.ts), which restricts live IMAP search to those accounts unless the user asks to broaden the search. When a user submits while an agent response is active, the web composer queues that message locally and sends it after activity ends; the queued row's **Send now** action sends immediately, cancels the in-flight agent message, and lets the new message steer the thread.
- Agent thread UI lives under [components/agent-thread](components/agent-thread). [app/agent/thread/[id]/page.tsx](app/agent/thread/[id]/page.tsx) should stay route/AppShell orchestration only; reusable message rendering belongs in `thread-content.tsx`, shared thread shapes in `types.ts`, and artifact-specific summary cards, right panels, and normalization helpers under `components/agent-thread/artifacts/`.

## Policy Change / Endorsement Cases

Glass persists first-class policy-change case state for endorsement workflows:

- `policyChangeCases` stores request text, status, affected policy, evidence source IDs, validation issues, and packet references.
- `pcePackets` stores generated broker request packet artifacts and validation snapshots.
- `caseMessages`, `caseEvidenceLinks`, and `caseValidationReports` preserve missing-info replies, source evidence links, and audit-friendly validation history.
- `convex/policyChanges.ts` exposes safe entrypoints to create requests from chat, email, or uploaded documents, process replies, generate a broker request packet preview, and mark lifecycle status.
- Client-facing policy change views should stay progress-focused: show the request, simple lifecycle status, and cancellation when the case is still open. Broker/operator-only packet generation, send/status controls, raw packet previews, validation internals, and audit details are hidden from clients.
- The `create_policy_change_request` tool is available in web chat, inbound email, and iMessage. It creates a persistent deterministic intake case immediately with source evidence IDs; later broker request packets and lifecycle updates should not block the initial tool call.
- Web chat stores the created `policyChangeCases` ID on the producing `threadMessages` record as a visible policy-change artifact. The thread renders a compact request card under the assistant response and can open the case in the right-side preview panel.
- Clients can create and review policy-change intake cases, including standalone client orgs without a connected broker. Broker email drafting remains broker-mediated: use connected broker identity first, then manual broker identity, then explicit user-provided broker contact, and keep the case in `needs_info` until a broker recipient is known. Lifecycle status updates remain broker-side actions. Connected-client/vendor access remains read-only and cannot manage PCE workflows.
- If a policy matches an active program administrator partner, PCE approval is routed to that partner's approval queue. Partner approval marks the case accepted and stores a staged policy update for broker/admin review or updated-document import; Glass does not automatically patch structured policy fields from PCE approval in v1.

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
- `documentChunks` stores semantic chunks plus embeddings.
- `orgMemory` stores all per-org knowledge.

Important: `git push` only deploys the Next.js frontend via Vercel. Convex functions require a separate `npx convex dev --once` (dev) or `npx convex deploy --yes` (prod) to go live.

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

- No hardcoded intent routing. The agent runs `streamText` with `getModel("chat")` and a tool set:
  - `lookup_policy`
  - `lookup_policy_section`
  - `confirm_policy_fact`
  - `compare_coverages`
  - `email_expert` — delegates outbound drafting/sending to the shared email subagent when the sender is an authenticated internal team member in direct mode
  - `save_note` — writes to `orgMemory`
  - `generate_coi`
  - `extract_policy_attachment` — extracts PDF attachments via `extractFromUploadInternal`
- After a reply is produced, a Haiku summarization pass writes a `source: "email"` observation to `orgMemory`.

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
- `generateCoi.run` stores every newly generated COI PDF in Convex file storage and records it in `certificates` with `policyId`, `orgId`, certificate-holder text, source, creator, and storage file ID. The policy detail page's Certificates tab reads this table; direct page generation uses `certificates.generateForPolicy`. Programmatic generation is exposed through REST (`GET/POST /api/v1/policies/:id/certificates`) and MCP/CLI tools (`list_policy_certificates`, `generate_policy_certificate`).
- Certificates persist authority metadata. Non-network broker-generated certificates are `authorityType: "non_binding"` and must be described as non-binding in agents, UI, email, REST, MCP, and CLI output. Partner-backed certificates are `authorityType: "certified"` only when a program administrator approval record or standing authorization record exists. If a partner route exists but no standing authorization applies, generation creates a `certificateRequests` approval item instead of producing a certified PDF.
- Program administrator certificate support lives in `partnerPrograms`, `partnerProgramEmbeddings`, `coiTemplates`, `standingAuthorizations`, `certificateRequests`, and `certificateApprovals`. Programs define approval mode (`auto_approve_all`, `require_approval_all`, or source-grounded `llm_review`), optional approval-rule text, and a default template. Templates can use the standard Glass COI generator or a PDF overlay builder backed by `react-pdf`/`react-moveable` in `/partner/templates`; PDF overlay rendering happens server-side with `pdf-lib` and falls back to the standard generator unless explicitly disabled. Overlay fields can be fixed policy fields, generated certificate fields, custom prompt-backed smart fields resolved from policy/COI data during generation, static text, or configurable coverage tables. The template builder's Auto-place flow calls `partnerPrograms.autoPlaceTemplateFields`, which sends the uploaded PDF plus requested fields to the model and applies normalized placements returned from PDF layout analysis instead of relying on hardcoded coordinates. Standing authorizations require a program, template, and optional policy/coverage constraints before Glass can auto-issue a certified certificate with a system approval record.
- Shared email intent and COI attachment safety guards live in `convex/lib/emailIntentGuards.ts` and `convex/lib/coiAttachmentGuards.ts`. Keep cross-channel routing decisions and multi-certificate attachment rules there instead of duplicating regex guards in web chat, inbound email, iMessage, or pending-send code.
- It requires confirmation instead of sending when the recipient email is inferred or unknown, the body/subject is incomplete, attachments are ambiguous, or `autoSendEmails` is false and the user has not explicitly approved the exact draft.
- Web chat, inbound email, iMessage, and MCP/CLI surfaces all route directed outbound email through shared email-draft primitives rather than hand-rolled send paths. The shared email identity falls back to `agent@${AGENT_DOMAIN}` when no custom agent handle is configured. Web chat and iMessage pass the current user's email/name as the default recipient so "email me" requests resolve without asking for already-known contact details. The `bccRequesterOnAgentEmails` org setting defaults on and blind-copies the requesting team member on directed outbound emails. The email expert supports structured `cc` and `bcc` recipients.
- In web chat, draft emails are persisted as native email-channel thread messages backed by a `pendingEmails` draft. The chat still shows a concise assistant note that an email was drafted, while the full copy lives in the email card/right-side preview. The user can review or quickly send from the draft card, send/cancel from the resizable right-side email preview panel, or use typed chat approval as a fallback that sends the current draft artifact instead of requiring a regenerated draft message. Right-side previews can stack, so an email draft and PDF/policy preview may be open at the same time; when stacked, panels begin at equal widths with the main content and the PDF panel stays furthest right.
- MCP and local CLI expose the same durable draft lifecycle through `list_email_drafts`, `draft_email`, `update_email_draft`, `send_email_draft`, and `cancel_email_draft`. Programmatic tools should update the existing draft artifact in place and send/cancel by draft ID; `ask_glass` remains for Q&A and contextual reasoning.
- Pending emails persist attachment metadata in `pendingEmails.attachments`; the scheduled sender writes those attachments back into the unified thread email message after Resend accepts the send.

### Agent Q&A (Chat)

1. Load org context, policies, and `orgMemory`.
2. Build retrieval-backed document context + orgMemory context + conversation memory.
3. If the user message has attachments (images, PDFs, text), read them from Convex storage and include as AI SDK multipart content parts.
4. Run chat model via `streamText` with tools: `lookup_policy`, `lookup_policy_section`, `confirm_policy_fact`, `compare_coverages`, `email_expert`, `save_note`, `generate_coi`.
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
- `list_quotes`, `get_quote`
- `list_threads`, `get_thread_messages`
- `list_email_drafts`, `draft_email`, `update_email_draft`, `send_email_draft`, `cancel_email_draft`
- `get_org_info`
- `ask_glass`
- `list_clients`, `get_client` (broker)
- `list_broker_activity` (broker)
- `list_my_policies` (client)

Application, passport, business-context, and integration tools are gone. The local MCP server should only register current policy, quote, thread, org, agent, broker/client, certificate, and connected-vendor tools.

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
- inline comments only when they clarify non-obvious code paths

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.

<!-- convex-ai-end -->
