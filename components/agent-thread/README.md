# Agent Thread Components

The thread route is intentionally thin. Reusable message UI and artifact surfaces live here so new artifacts can be added without growing `app/agent/thread/[id]/page.tsx`.

## Structure

- `types.ts` defines the shared thread message, artifact data and side-panel reference shapes. Artifact modules must import types from here instead of from the route.
- `thread-content.tsx` owns the reusable thread renderer, message bubbles, message controls and input overlay. Route files should pass thread identity, viewer metadata and shell callbacks into this component instead of defining message UI inline.
- `thread-attachment-chip.tsx` owns attachment rendering and PDF preview integration for stored thread files and externally resolved mailbox attachments.
- `artifacts/` contains one module per artifact family. Each module owns its summary card, right-panel detail view and normalization helpers for that artifact's data shape.

## Adding An Artifact

1. Add a module under `artifacts/` that exports a compact summary card and a right-panel component.
2. Put parsing/normalization beside the artifact module, not in the route page.
3. Add exports to `artifacts/index.ts`.
4. In the route integration, only wire message selection/open state and pass the selected artifact into the right panel. Keep data-shaping logic inside the artifact module.

## UX Contract

Web chat follows a messaging contract rather than an execution-console contract:

- While Glass is working, render one compact thinking bubble. Do not stream partial answer text, model reasoning, tool labels, tool input/output, or subagent logs into the conversation.
- Show `Delivered` on the viewer's latest web message after Convex acknowledges it, and `Read` only after the linked agent run has started. Older receipts stay hidden to keep the thread quiet.
- Publish the agent's response as one complete message. Keep source links, files, delivery status, and actionable artifacts because they change what the user can verify or do next.
- Tool audit data may remain available to internal telemetry and channel adapters, but model reasoning stays private and the customer-facing thread does not disclose either.

Artifact summary cards should be compact, truncate long labels and expose one clear action that opens the right panel. Right panels should use the same 12px header height, close button pattern and bottom action bar only when there are actionable controls.
