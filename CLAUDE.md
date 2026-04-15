# CLAUDE.md

This repository uses a generic agent guide.

See [AGENTS.md](AGENTS.md) for architecture, model routing, org intelligence pipeline, dream consolidation, `cl-sdk` integration, and contributor workflow.

Key commands:
- `npx convex typecheck` — validate Convex functions
- `npx tsc --noEmit` — validate Next.js
- `npx convex dev --once` — push functions to dev
- `npx convex deploy --yes` — push functions to prod (git push only deploys the Next.js frontend)
