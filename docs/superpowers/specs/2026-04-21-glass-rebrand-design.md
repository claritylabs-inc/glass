# Glass — Prism → Glass Rebrand Design

**Date:** 2026-04-21
**Status:** Draft — awaiting review
**Scope:** Cross-cutting rebrand that threads through all Glass subsystems.
**Depends on:** [foundation](./2026-04-21-glass-dual-org-foundation-design.md) (for broker branding fields and agent display name).

## Context

This repo started as a clone of Prism (an insurance intelligence platform). Glass is a new product built on the same code, with a different product position (broker-driven client onboarding platform). This subsystem covers the surface rewrite from "Prism" to "Glass" — and, where applicable, to the broker's white-labeled agent name ("Aon Agent, powered by Glass from Clarity Labs").

This is **not** a code refactor — internal symbols, file paths, and repo name stay as-is. It is a user-facing and agent-facing rewrite.

## Decision

**Scope:** user-facing copy + agent prompts only (option D from brainstorm). Internal code identifiers (`askPrism`, etc.) and stored data keep Prism names where they're not user-visible. `ask_prism` MCP tool gets a `ask_glass` alias as defined in subsystem 8; both names continue to work.

## Branding Model

Three product-name contexts, resolved by a single helper:

### `getBrandingContext(access): BrandingContext`

```ts
type BrandingContext = {
  surface: "broker_app" | "client_app" | "client_email" | "broker_email" | "marketing";
  productName: string;               // "Glass"
  companyName: string;               // "Clarity Labs"
  agentDisplayName: string;          // "Glass Agent" default; broker override for client-facing
  accentColor: string | undefined;   // broker brandingColor when applicable
  logoStorageId: Id<"_storage"> | undefined;
  poweredByFooter: string | undefined; // "Powered by Glass from Clarity Labs" on client_app/client_email
};
```

Resolution rules:

- **Broker app / broker email** — `productName = "Glass"`, `agentDisplayName = "Glass Agent"`, no broker branding (brokers see the platform directly).
- **Client app** (client user signed in, viewing their own org) — uses the client's broker's branding. `agentDisplayName = brokerOrg.agentDisplayName ?? "Glass Agent"`, accent + logo from broker, `poweredByFooter = "Powered by Glass from Clarity Labs"`.
- **Client email** (transactional email sent to client users) — same as client app.
- **Marketing** — broker-less context (signup, pre-auth landing). `productName = "Glass"`, Clarity Labs branding.

Helper lives in `convex/lib/branding.ts` (server) and a matching React hook `useBranding()` reads from context set at layout level (client).

## Surface Inventory

Each item below gets rewritten. A "Glass" label means the product name swaps in; a "broker-branded" label means the client-facing version uses `agentDisplayName` + broker accents.

### 1. In-app copy (Next.js)

| Surface | Rewrite |
|---|---|
| Page titles / `<title>` tags | Broker app pages: "Clients · Glass" etc. Client app pages: "{brokerAgentDisplayName}" as prefix, "powered by Glass" subtitle optional. |
| App header / nav label | Broker: "Glass". Client: broker's `agentDisplayName`. |
| Agent chat header / avatar caption | Broker-branded on client side; "Glass Agent" on broker side. |
| Empty states, onboarding copy, help text referencing "Prism" | Swap to "Glass" / broker-branded. |
| Error messages ("Prism couldn't …") | Swap to "Glass couldn't …" or broker-branded equivalent. |
| Footer / about / legal strip | "© Clarity Labs · Powered by Glass" on client app; "© Clarity Labs" on broker app. |

Task for implementation: grep `/Prism/i` across `app/`, `components/`, and inline strings in Convex queries/mutations; categorize each match (broker-app / client-app / agent / other); replace with the right value from `useBranding()` or a literal where safe.

### 2. Email templates

All Resend templates:

| Template | Rewrite |
|---|---|
| Client invitations (foundation spec) | Broker-branded. From: `{brokerAgentDisplayName} via Glass`. Body: broker logo top; content; footer "Powered by Glass from Clarity Labs". |
| Application notifications (sent / returned / accepted) | Broker-branded. |
| Passport flag notifications | Broker-branded. |
| Notification digest (when added) | Broker-branded for client recipients. |
| Broker-side notifications | "Glass" branding — generic Clarity Labs sender. |
| Agent-generated emails (responses in email threads) | Broker-branded for client recipients; use `agentDisplayName` in the from-name. |
| Quote/policy delivery notifications | Broker-branded. |

Templates read from a shared layout that pulls branding from `getBrandingContext` on the server at send time. One template file, two renderings driven by resolver.

### 3. Agent prompts

Prompts live in `convex/lib/agentPrompts.ts` (and SDK-provided prompts via `cl-sdk`). Audit every prompt:

- References to "Prism" as the product name → "Glass".
- References that establish the agent's identity ("You are Prism, an insurance intelligence assistant") → parameterized on the branding context:
  - Broker-side invocations: "You are Glass Agent, an insurance intelligence assistant for brokers."
  - Client-side invocations: "You are {agentDisplayName}, powered by Glass. You help {brokerOrgName}'s clients manage insurance applications, policies, and organizational intelligence."
- System-prompt "voice" adjustments stay minimal; only the name + positioning change.

Prompt helpers take a `brandingContext` parameter; existing prompt-building functions are updated to pass it through. SDK-side prompts (from `cl-sdk`) that hardcode "Prism" are overridden via the SDK's prompt-injection callback rather than modified upstream.

### 4. Stored `sourceLabel` strings (leave alone)

Existing `orgIntelligence.sourceLabel` values like "Prism analysis" or "Prism extraction" persist as-is — these are historical labels on stored facts, not live UI strings. New intelligence entries written from rebranded code will use "Glass analysis" naturally.

### 5. MCP tool catalog (already covered by subsystem 8)

- `ask_prism` → primary name `ask_glass`, `ask_prism` kept as alias for backward compatibility.
- Tool descriptions referencing "Prism" rewritten to "Glass".
- New broker-side tools use "Glass" natively (no alias needed).

### 6. Meta / SEO / favicons

- HTML `<title>` templates, Open Graph tags, favicon, manifest.
- Broker app: "Glass".
- Client app: default to broker's logo + agent name where resolvable; fall back to "Glass" when no broker context (pre-auth pages).
- Apple / Android touch icons: one generic Glass set + per-broker overrides rendered from `logoStorageId` at request time.

### 7. Marketing / landing pages

Pre-auth landing (signup, login, invite acceptance):

- Signup (broker) — "Glass for insurance brokers" branding. Clarity Labs-owned.
- Invite acceptance (client) — broker-branded (logo + accent + agent name), "Powered by Glass from Clarity Labs" footer per subsystem 1.
- Login — generic Glass branding (user's org affiliation isn't known until after auth).

## Implementation Playbook

This spec describes *what* changes; *how* is a straightforward sweep. Ordering:

1. Land the branding helper (`getBrandingContext` + `useBranding`) and the broker org branding fields (done in foundation spec) — prerequisite for everything else.
2. Rewrite email templates to consume the helper. Verify send flow end-to-end in both broker and client orgs.
3. Audit and rewrite agent prompts. Run regression on agent Q&A with a seeded broker+client to make sure prompt changes don't regress answer quality.
4. Sweep `app/` and `components/` for literal "Prism" strings; categorize and replace.
5. Update MCP tool catalog (adds the `ask_glass` alias, rewrites descriptions).
6. Meta / SEO / favicons last (cheapest per change but visual; lines up well with final QA).

Each step lands as its own PR so regressions are attributable.

## Testing Strategy (outline)

- Snapshot tests on rendered email templates for both broker and client contexts — captures `agentDisplayName`, accent color, footer presence.
- Visual regression on key in-app pages with a broker-org session (brand = "Glass") and a client-org session (brand = broker's).
- Agent prompt regression: canned Q&A fixtures rerun against a broker-seeded and client-seeded org; outputs compared for basic quality (not exact match — prompts changed).
- Full-text search for `/Prism/i` in `app/`, `components/`, `convex/**/*.ts` (excluding paths/imports): zero hits in user-facing modules; internal symbol hits allowed and catalogued.

## Out of Scope

- Internal code identifier renames (`askPrism` → `askGlass`, file paths, module names).
- Repo / package name change.
- Database value rewrites for historical `sourceLabel` strings.
- External integrations / 3rd-party services that reference "Prism" in their config (e.g., an OAuth app name on Google) — handled operationally, not in code.
- Broker-specific custom domains + sending identities — deferred from foundation spec.
- Multi-language copy.
