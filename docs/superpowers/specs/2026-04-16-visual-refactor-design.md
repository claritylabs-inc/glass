# Visual Refactor Design Spec

**Date:** 2026-04-16
**Status:** Draft
**Scope:** Full frontend visual refactor across navigation, pages, components, theming, and branding

---

## 1. Navigation Restructure

### Current state
- Sidebar has two groups: Insurance (Dashboard, Policies, Applications) and Tools (Context, Prism Agent)
- "Ask Prism" input in sidebar routes to agent threads
- `nav.tsx` (legacy top navbar) is unused except in one loading skeleton — dead code
- `/connections` page serves as a mega-page with 4 tabs: Sources, Scanned Emails, Intelligence, Activity
- `/agent` page is mostly a settings/config page, not a real standalone feature

### New structure

**Sidebar groups:**
- **Insurance:** Dashboard, Policies, Applications
- **Threads:** Conversation list (existing, unchanged)
- **Settings** (gear icon, bottom of sidebar): opens `/settings`

**Removed from sidebar:**
- "Ask Prism" search input (replaced by dashboard hero input)
- "Context" / "Connections" link
- "Prism Agent" link

**Deleted:**
- `components/nav.tsx` — dead code, only imported in `policies/[id]/loading.tsx` (update that file to use AppShell)

### Settings sidebar-nav layout

`/settings` uses a vertical sidebar nav on the left, content on the right (like GitHub/Vercel settings):

| Section | Content (migrated from) |
|---------|------------------------|
| **Sources** | Email connections list, integration cards, connection form (from `/connections` Sources tab) |
| **Intelligence** | Org intelligence entries, vector visualization, search (from `/connections` Intelligence tab) |
| **Activity** | Dream consolidation logs, extraction history, email scan logs (from `/connections` Activity tab) |
| **Agent** | Agent email handle config, COI settings, email toggles, send delay (from `/agent` Settings tab + main page) |
| **Organization** | Org name, website, industry, business context, broker info (from `/settings` Basic Info tab) |
| **Team** | Team members, roles, invitations (from `/settings` Team Members tab) |
| **API Keys** | Create/view/revoke keys (from `/settings` API Keys tab) |

The Connected Apps tab from the current settings page merges into Sources since it's the same concept (external integrations).

---

## 2. Dashboard — Conversation-First

### Current state
Dashboard shows 7+ sections: stats cards, applications card, agent card, coverage chart, demo banner, expiring policies, expiring quotes. Dense and unfocused.

### New design

**Hero section:** Large centered prompt input (reusing the refactored PromptInput components). This is the primary CTA — "Ask Prism anything about your insurance."

**Behavior:** User types and sends a message. The app creates a thread, then seamlessly navigates to `/agent/thread/[id]`. The transition should feel smooth — no jarring page jump. Use a fade or slide transition so it feels like the conversation started inline.

**Secondary section (below the fold):**
- Stats row: Total policies, active policies, applications (compact, single row of small cards)
- Expiring policies: Next 90 days, compact list (quotes removed)
- Demo data banner (if applicable)

**Removed from dashboard:**
- Agent card (redundant — the hero IS the agent entry point)
- Coverage-by-type chart (move to Policies page as a compact summary widget above the table)
- Expiring quotes section (quotes are removed)

---

## 3. Quotes Removal

### Files to delete
- `components/quote-table.tsx`
- `components/quote-grouped-view.tsx`
- `components/quote-filters.tsx`
- `components/preview/quote-preview.tsx`
- `app/quotes/page.tsx` (redirect)
- `app/quotes/[id]/page.tsx` (redirect)

### Files to modify
- `app/policies/page.tsx` — remove "Quotes" tab, remove quote filtering logic
- `app/page.tsx` — remove expiring quotes section, remove quotes stat card
- `app/connections/page.tsx` (before it's broken up) — remove any quote references
- `components/entity-preview-panel.tsx` — remove quote preview rendering
- `components/context-reference-card.tsx` — remove quote references
- Any sidebar/nav references to quotes

### Shared constants cleanup
- Remove `TYPE_COLORS` from quote-specific files (will be centralized — see section 7)

---

## 4. Policy Detail Page Refactor

### Current state
`app/policies/[id]/page.tsx` is 2,426 lines with 8+ tabs of deeply nested extracted data. Overwhelming for non-expert users.

### New design

**Summary-first layout:**
- Top section: Key facts card — policy number, carrier, type, effective/expiration dates, premium, key limits. Always visible, compact.
- Status indicators: Active/expired badge, days until expiration if relevant.

**PDF viewer (primary content area):**
- The actual PDF document viewer takes the main content space below the summary.
- Uses the existing `PdfPanel`/`PdfViewer` components.

**Extracted data (secondary, collapsible):**
- A collapsible "Extraction Details" panel (default collapsed) that contains the structured extraction data.
- Frame this as an audit/debug tool — label it something like "Extraction Data" or "Parsed Details."
- When expanded, use a simpler presentation than the current 8-tab system. Group into fewer logical sections:
  - **Coverage & Limits** (sections, endorsements, costs)
  - **Exclusions & Conditions**
  - **Contacts & Regulatory** (claims, complaints, jurisdiction)

**File structure:**
Break the 2,426-line file into:
- `app/policies/[id]/page.tsx` — page shell, summary card, layout
- `app/policies/[id]/policy-summary.tsx` — key facts card
- `app/policies/[id]/extraction-panel.tsx` — collapsible extraction details
- `app/policies/[id]/extraction-sections.tsx` — individual section renderers

---

## 5. Connections Page Breakup

### Current state
`/connections` (large file) has 4 tabs: Sources, Scanned Emails, Intelligence, Activity. Each tab is a substantial feature.

### Migration plan

| Current tab | New home | Notes |
|-------------|----------|-------|
| Sources | `/settings` → Sources section | Email connections + integration cards |
| Scanned Emails | `/settings` → Sources section | Email review table shown when a connection is selected/expanded within Sources |
| Intelligence | `/settings` → Intelligence section | Full intelligence tab with sub-tabs |
| Activity | `/settings` → Activity section | Dream logs, extraction logs, scan logs |

### Route changes
- `/connections` — redirect to `/settings?section=sources`
- `/extractions` — redirect to `/settings?section=activity`

### Settings URL pattern
Single `/settings` page with client-side section switching via `?section=` query param (e.g., `/settings?section=sources`, `/settings?section=agent`). Default section is Sources. This matches the existing tab-switching pattern used elsewhere in the app.

### File changes
- `app/connections/page.tsx` — delete (replace with redirect)
- `app/connections/layout.tsx` — delete
- Create `app/settings/page.tsx` — new settings shell with sidebar nav
- Create `app/settings/layout.tsx` — settings layout
- Move tab content into dedicated components under `components/settings/` or keep existing components and just re-import them in the new settings sections

---

## 6. Agent Page Restructure

### Current state
`/agent` has two states: unclaimed handle (shows setup + mode explainer cards) and claimed handle (shows email + Help/Settings tabs). It's essentially a settings page.

### New design

**Agent settings move to `/settings` → Agent section:**
- Handle claim form (if unclaimed)
- Agent email display with copy button
- Mode explainer cards (Help content)
- COI settings, email toggles, send delay

**`/agent` route:** Redirect to `/settings/agent` (or just remove — threads are accessed via sidebar).

**`/agent/thread/[id]`:** Stays as-is. This is the actual conversation page.

**`/agent/archive`:** Route stays for direct linking. Archive is primarily accessible from the sidebar's thread list (which already has archive functionality).

---

## 7. Component Deduplication & Cleanup

### TYPE_COLORS centralization

Currently duplicated in 5 files. Extract to:
```
lib/policy-type-colors.ts
```

Import everywhere: extraction-log, policy-table, policy-grouped-view, coverage-by-type, and any other consumers.

### Quote component deletion (see section 3)

### Log component consolidation

Current state: 4 log variants + 2 activity section wrappers:
- `terminal-log.tsx` — timestamped terminal-style log
- `extraction-log.tsx` — extraction status with colors
- `email-scan-log.tsx` — email scan activity
- `dream-log.tsx` — context consolidation log
- `activity-log-section.tsx` — reusable log container
- `activity-section.tsx` — generic collapsible section

Target: `activity-section.tsx` is the base pattern. `activity-log-section.tsx` should extend it or be merged. The domain-specific logs (`email-scan-log`, `dream-log`) are small and focused — they can stay but should use the same base wrapper consistently.

`terminal-log.tsx` and `extraction-log.tsx` should be reviewed — if they're only used in one place each, consider inlining.

### Input component consolidation

Current: `chat-input.tsx`, `prism-prompt-input.tsx`, `ask-prism-input.tsx`, plus `ai-elements/prompt-input.tsx` (UI kit).

Target:
- `ask-prism-input.tsx` — delete (sidebar input removed, dashboard uses PromptInput directly)
- `chat-input.tsx` — review if still needed. If only used for email thread replies, keep. Otherwise consolidate into `prism-prompt-input.tsx`.
- `prism-prompt-input.tsx` — becomes the single prompt input consumer, with file upload and screenshot tools properly wired up and visible.

### prompt-input.tsx split

Split the 1,456-line UI kit into individual files under `components/ai-elements/prompt-input/`:

```
components/ai-elements/prompt-input/
  index.ts              — re-exports everything
  context.tsx           — PromptInputProvider, hooks, context types
  prompt-input.tsx      — main PromptInput component
  body.tsx              — PromptInputBody, PromptInputTextarea
  header-footer.tsx     — PromptInputHeader, PromptInputFooter
  actions.tsx           — PromptInputActionMenu, attachments, screenshot
  submit.tsx            — PromptInputSubmit, PromptInputButton
  select.tsx            — PromptInputSelect and sub-components
  hover-card.tsx        — PromptInputHoverCard and sub-components
  tabs.tsx              — PromptInputTabsList, Tab, TabLabel, TabBody, TabItem
  command.tsx           — PromptInputCommand and sub-components
  helpers.ts            — captureScreenshot, convertBlobUrlToDataUrl
```

Wire up attachment and screenshot tools so they're visible in `prism-prompt-input.tsx`.

---

## 8. Branding & Theming Centralization

### Current state
- Good: Tailwind v4 @theme setup with CSS variables, light/dark mode, shadcn/ui integration
- Bad: 30+ files hardcode `#A0D2FA` and `#5BA4D9` instead of using CSS variables

### Changes

**CSS variable mapping (already exists, just underused):**
- `#A0D2FA` → `var(--primary-light)` or the Tailwind class `text-primary-light`
- `#5BA4D9` → `var(--primary-muted)` or equivalent

If `--primary-light` doesn't exist as a Tailwind utility yet, add it to the @theme block in `globals.css`.

**Files to update (grep for `#A0D2FA`, `#5BA4D9`, `#1a1816`, `#242220`):**
- `components/ui/logo-icon.tsx`
- `components/nav.tsx` (being deleted, but for reference)
- `components/conversation-message.tsx`
- `components/chat-message-bubble.tsx`
- `components/ask-prism-input.tsx` (being deleted)
- `components/command-palette.tsx`
- `components/prism-prompt-input.tsx`
- `components/context-reference-card.tsx`
- `components/chat-input.tsx`
- `components/vector-space.tsx`
- `app/agent/page.tsx`
- `app/agent/thread/[id]/page.tsx`
- `app/onboarding/page.tsx`
- `app/page.tsx`
- `app/settings/page.tsx`
- `components/ui/pill-button.tsx` (hardcoded rgba)
- `components/ui/pdf-viewer.tsx` (hardcoded rgba)

**Email templates** (`convex/lib/emailTemplate.ts`, `convex/lib/agentEmailTemplate.ts`, etc.) — these render server-side HTML and can't use CSS variables. Create a shared `convex/lib/brandColors.ts` constant object and import it in all email templates.

**Canvas/3D components** (`vector-space.tsx`) — read CSS variable values from the DOM at render time or accept theme colors as props.

---

## 9. Wording & Terminology Audit

### Known issues to fix
- Sidebar says "Context" but the page says "Connections" — moot after restructure (both go away)
- "Scanned Emails" tab — becomes part of Sources in settings
- Agent mode names (Direct, CC, Forward, Application, Unknown) — review for clarity to non-insurance users

### Principles
- Target user: business/startup managing insurance, NOT an insurance expert
- Use plain language: "carrier" or "insurer" (not "producer"), "policy" (not "binder" unless contextually needed)
- Buttons should be verbs: "Scan emails", "Add connection", "Start conversation"
- Avoid jargon in labels and headings

A full wording audit should be done during implementation as each component is touched.

---

## 10. Page & Tab Layout Summary

### Before (7 top-level pages + sub-pages)
```
/ (Dashboard — 7 sections)
/policies (3 tabs: Active, Expired, Quotes)
/policies/[id] (8+ tabs of extraction data)
/applications
/applications/[id] (2 tabs: Details, Threads)
/connections (4 tabs: Sources, Emails, Intelligence, Activity)
/agent (2 states, 2 tabs when claimed)
/agent/thread/[id]
/agent/archive
/settings (4 tabs: Info, Team, Apps, API Keys)
/profile
```

### After (4 top-level pages + settings)
```
/ (Dashboard — conversation hero + compact stats)
/policies (2 tabs: Active, Expired)
/policies/[id] (summary + PDF viewer + collapsible extraction)
/applications
/applications/[id] (Details + Threads tabs — unchanged)
/agent/thread/[id] (unchanged)
/agent/archive (unchanged or moved)
/settings (sidebar nav: Sources, Intelligence, Activity, Agent, Organization, Team, API Keys)
/profile (unchanged)
```

### Removed routes
- `/connections` → redirect to `/settings`
- `/agent` → redirect to `/settings/agent`
- `/quotes`, `/quotes/[id]` → delete
- `/extractions` → redirect to `/settings/activity`

---

## 11. Usability Considerations

- **No tab-hopping for information transfer.** Users should never need to remember something from one tab and carry it to another. The conversation-first dashboard lets users ask questions that span all their data.
- **Settings are "set and forget."** Sources, Intelligence, Activity, and Agent config are not daily-use features — they belong in settings, not primary navigation.
- **Policy detail is scannable.** Summary card answers "what is this policy?" in 3 seconds. PDF viewer lets users read the original. Extraction data is there for power users / debugging.
- **Thread list in sidebar provides quick access** to ongoing conversations without navigating away from the current page.

---

## 12. Out of Scope

- Backend/Convex changes (schema, actions, mutations) — frontend only
- New features or functionality — this is a restructure of existing features
- Mobile-specific redesign — responsive behavior follows from the restructured layout
- Email template visual redesign — only centralizing hardcoded colors
