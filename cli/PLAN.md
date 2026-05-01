# Glass CLI Implementation Plan (CLA-9)

## Goals
- Deliver a first-party Glass CLI with API-backed parity for high-value web workflows.
- Make the CLI agent-first (scriptable, machine-readable output), while still usable by humans.
- Enforce the same auth and org-role gating model as web and MCP.

## Scope Breakdown
1. Foundation: standalone TypeScript CLI package + typed API client + output formatters.
2. Authentication: browser-based OAuth flow, token storage, and org selection.
3. Core parity: me/org/policies/notifications/activity plus broker-scoped clients.
4. Expansion: write-scope commands and broader one-to-one feature parity.

## Parallelization (Sub-agent workstreams)
- Auth flow and secure persistence.
- API client and pagination/error handling.
- Command UX and output modes.
- RBAC command gating.
- QA/build/test automation.

## PR Deliverable
- CLI scaffold with foundational commands and auth flow.
- Read-only core endpoint coverage.
- Broker-only gating for client listing.
