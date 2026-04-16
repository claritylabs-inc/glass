# Visual Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure Prism's frontend for clarity — fewer pages, conversation-first dashboard, unified settings, no quote artifacts, centralized branding.

**Architecture:** Break the monolithic Connections page into Settings sections with sidebar-nav. Make the dashboard a conversation launcher. Simplify policy detail to summary-first. Remove all quote code. Centralize duplicated constants and hardcoded colors.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind 4, Framer Motion, shadcn/ui, Convex

**Spec:** `docs/superpowers/specs/2026-04-16-visual-refactor-design.md`

---

## Phase 1: Cleanup & Centralization (no visible changes)

### Task 1: Centralize TYPE_COLORS into shared module

The same 25-entry `TYPE_COLORS` map is copy-pasted in 5 component files. Move it to the existing `convex/lib/policyTypes.ts` which already has `POLICY_TYPE_LABELS`.

**Files:**
- Modify: `convex/lib/policyTypes.ts` — add `POLICY_TYPE_COLORS` export
- Modify: `components/policy-table.tsx` — remove local `TYPE_COLORS`, import shared
- Modify: `components/policy-grouped-view.tsx` — remove local `TYPE_COLORS`, import shared
- Modify: `components/coverage-by-type.tsx` — remove local `TYPE_COLORS`, import shared
- Modify: `components/extraction-log.tsx` — remove local `TYPE_COLORS`, import shared
- Modify: `app/page.tsx` — remove local `TYPE_COLORS`, import shared
- Modify: `app/policies/[id]/page.tsx` — remove local `TYPE_COLORS` if present, import shared

- [ ] **Step 1:** Add `POLICY_TYPE_COLORS` to `convex/lib/policyTypes.ts`

Copy the map from `components/policy-table.tsx:27-51` and export it as `POLICY_TYPE_COLORS`:

```ts
export const POLICY_TYPE_COLORS: Record<string, string> = {
  general_liability: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
  commercial_property: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400",
  // ... full map from policy-table.tsx
  other: "bg-gray-100 dark:bg-gray-800/40 text-gray-700 dark:text-gray-400",
};
```

- [ ] **Step 2:** Replace local `TYPE_COLORS` in each consumer file

In each file, remove the local `const TYPE_COLORS = { ... }` block and add:
```ts
import { POLICY_TYPE_COLORS } from "@/convex/lib/policyTypes";
```

Then find-replace `TYPE_COLORS` → `POLICY_TYPE_COLORS` in the JSX of each file.

Files: `components/policy-table.tsx`, `components/policy-grouped-view.tsx`, `components/coverage-by-type.tsx`, `components/extraction-log.tsx`, `app/page.tsx`, `app/policies/[id]/page.tsx`

- [ ] **Step 3:** Verify build

Run: `npm run build`

- [ ] **Step 4:** Commit

```bash
git add convex/lib/policyTypes.ts components/policy-table.tsx components/policy-grouped-view.tsx components/coverage-by-type.tsx components/extraction-log.tsx app/page.tsx app/policies/\[id\]/page.tsx
git commit -m "refactor: centralize POLICY_TYPE_COLORS into policyTypes.ts"
```

---

### Task 2: Delete all quote code

Quotes are no longer used. Remove all quote-specific components, routes, and references.

**Files:**
- Delete: `components/quote-table.tsx`
- Delete: `components/quote-grouped-view.tsx`
- Delete: `components/quote-filters.tsx`
- Delete: `components/preview/quote-preview.tsx`
- Delete: `app/quotes/page.tsx`
- Delete: `app/quotes/[id]/page.tsx`
- Modify: `app/policies/page.tsx` — remove Quotes tab and related state/filtering
- Modify: `app/page.tsx` — remove expiring quotes section and quotes stat
- Modify: `components/entity-preview-panel.tsx` — remove quote preview case
- Modify: `components/context-reference-card.tsx` — remove quote references
- Modify: `components/stats-cards.tsx` — remove quotes stat if present
- Modify: `components/policy-table.tsx` — remove any quote-related imports/logic
- Modify: `convex/lib/policyTypes.ts` — keep `QUOTE_SECTION_TYPE_*` exports for now (backend may still use them)

- [ ] **Step 1:** Delete quote component files and routes

```bash
rm components/quote-table.tsx components/quote-grouped-view.tsx components/quote-filters.tsx components/preview/quote-preview.tsx
rm app/quotes/page.tsx app/quotes/\[id\]/page.tsx
rmdir app/quotes/\[id\] app/quotes 2>/dev/null
```

- [ ] **Step 2:** Clean up `app/policies/page.tsx`

Remove the "Quotes" tab from the tab list, remove the quotes view state, remove quote filtering logic, remove `QuoteTable`/`QuoteGroupedView`/`QuoteFilters` imports. Read the file first to find exact locations.

- [ ] **Step 3:** Clean up `app/page.tsx`

Remove the "Expiring Quotes" section and the quotes stat card. Remove any `quote` imports.

- [ ] **Step 4:** Clean up `components/entity-preview-panel.tsx`

Remove the quote preview rendering case and the `QuotePreview` import.

- [ ] **Step 5:** Clean up `components/context-reference-card.tsx`

Remove quote-related references and imports.

- [ ] **Step 6:** Verify build

Run: `npm run build`

- [ ] **Step 7:** Commit

```bash
git add -A
git commit -m "refactor: remove all quote code — quotes feature retired"
```

---

### Task 3: Delete legacy nav.tsx

`components/nav.tsx` is dead code — only imported in one loading skeleton.

**Files:**
- Delete: `components/nav.tsx`
- Modify: `app/policies/[id]/loading.tsx` — replace Nav with AppShell or simple skeleton

- [ ] **Step 1:** Read and update `app/policies/[id]/loading.tsx`

Read the file. Replace the `Nav` import and usage with a simple loading skeleton that matches the AppShell layout (sidebar placeholder + content skeleton), or import `AppShell` if appropriate for a loading file.

- [ ] **Step 2:** Delete `components/nav.tsx`

```bash
rm components/nav.tsx
```

- [ ] **Step 3:** Verify no other imports exist

```bash
grep -r "from.*nav" --include="*.tsx" --include="*.ts" | grep -v node_modules | grep -v ".next"
```

Ensure no remaining imports of `@/components/nav`. (Other nav-like imports like `next/navigation` are fine.)

- [ ] **Step 4:** Verify build

Run: `npm run build`

- [ ] **Step 5:** Commit

```bash
git add -A
git commit -m "refactor: remove dead nav.tsx component"
```

---

### Task 4: Centralize hardcoded brand colors

Replace 30+ hardcoded `#A0D2FA` and `#5BA4D9` references with Tailwind theme classes.

**CSS variables already exist:**
- `--primary-light: #a0d2fa` → use `text-primary-light`, `bg-primary-light`, `border-primary-light`
- `--primary-muted: #5ba3d9` → use `text-primary-muted`, `bg-primary-muted`

**Files to update** (grep for `#A0D2FA`, `#5BA4D9`, case-insensitive):
- `components/conversation-message.tsx`
- `components/chat-message-bubble.tsx`
- `components/command-palette.tsx`
- `components/prism-prompt-input.tsx`
- `components/context-reference-card.tsx`
- `components/chat-input.tsx`
- `components/vector-space.tsx`
- `components/ui/logo-icon.tsx`
- `components/ui/pdf-viewer.tsx`
- `components/ui/pill-button.tsx`
- `app/agent/page.tsx`
- `app/agent/thread/[id]/page.tsx`
- `app/onboarding/page.tsx`
- `app/page.tsx`
- `app/settings/page.tsx`

- [ ] **Step 1:** Verify Tailwind utility classes exist for `--primary-light` and `--primary-muted`

Check `globals.css` @theme block. If `text-primary-light` etc. don't resolve, add them to the @theme section:

```css
@theme {
  --color-primary-light: var(--primary-light);
  --color-primary-muted: var(--primary-muted);
}
```

- [ ] **Step 2:** Find and replace in each file

For each file listed above:
- Replace `text-[#A0D2FA]` → `text-primary-light`
- Replace `text-[#5BA4D9]` → `text-primary-muted`
- Replace `bg-[#A0D2FA]` → `bg-primary-light`
- Replace `bg-[#A0D2FA]/10` → `bg-primary-light/10` (preserve opacity modifiers)
- Replace `bg-[#A0D2FA]/15` → `bg-primary-light/15`
- Replace `border-[#A0D2FA]` → `border-primary-light`
- For `vector-space.tsx` canvas hardcoded hex values (`#1a1816`, `#faf8f4`): read CSS variables from DOM via `getComputedStyle(document.documentElement).getPropertyValue('--background')` at render time
- For `logo-icon.tsx` default color prop: change from `"#A0D2FA"` to reading from theme or accepting `currentColor`
- For `pill-button.tsx` hardcoded `rgba(239,68,68,0.1)`: replace with `bg-destructive/10`
- For `pdf-viewer.tsx` hardcoded `rgba(59, 130, 246, 0.5)`: replace with theme-aware value

- [ ] **Step 3:** Verify build and spot-check dark mode

Run: `npm run build`

- [ ] **Step 4:** Commit

```bash
git add -A
git commit -m "refactor: replace hardcoded brand colors with theme variables"
```

---

## Phase 2: prompt-input Split

### Task 5: Split prompt-input.tsx into submodule directory

Split the 1,456-line UI kit into focused files.

**Files:**
- Delete: `components/ai-elements/prompt-input.tsx` (after migration)
- Create: `components/ai-elements/prompt-input/index.ts`
- Create: `components/ai-elements/prompt-input/helpers.ts`
- Create: `components/ai-elements/prompt-input/context.tsx`
- Create: `components/ai-elements/prompt-input/prompt-input.tsx`
- Create: `components/ai-elements/prompt-input/body.tsx`
- Create: `components/ai-elements/prompt-input/header-footer.tsx`
- Create: `components/ai-elements/prompt-input/actions.tsx`
- Create: `components/ai-elements/prompt-input/submit.tsx`
- Create: `components/ai-elements/prompt-input/select.tsx`
- Create: `components/ai-elements/prompt-input/hover-card.tsx`
- Create: `components/ai-elements/prompt-input/tabs.tsx`
- Create: `components/ai-elements/prompt-input/command.tsx`

- [ ] **Step 1:** Create directory and `helpers.ts`

Extract `captureScreenshot` and `convertBlobUrlToDataUrl` (lines 81-175 of original).

- [ ] **Step 2:** Create `context.tsx`

Extract `AttachmentsContext`, `TextInputContext`, `PromptInputControllerProps`, `PromptInputController`, `PromptInputProvider`, and all hooks (`usePromptInputController`, `useProviderAttachments`, `useOptionalPromptInputController`, `useOptionalProviderAttachments`, `usePromptInputAttachments`, `usePromptInputReferencedSources`, `LocalReferencedSourcesContext`).

- [ ] **Step 3:** Create `prompt-input.tsx`

Extract the main `PromptInput` component (the large compound component starting around line 514).

- [ ] **Step 4:** Create `body.tsx`

Extract `PromptInputBody` and `PromptInputTextarea`.

- [ ] **Step 5:** Create `header-footer.tsx`

Extract `PromptInputHeader`, `PromptInputFooter`, `PromptInputTools`.

- [ ] **Step 6:** Create `actions.tsx`

Extract `PromptInputActionAddAttachments`, `PromptInputActionAddScreenshot`, `PromptInputActionMenu`, `PromptInputActionMenuTrigger`, `PromptInputActionMenuContent`, `PromptInputActionMenuItem`.

- [ ] **Step 7:** Create `submit.tsx`

Extract `PromptInputSubmit`, `PromptInputButton`.

- [ ] **Step 8:** Create `select.tsx`

Extract `PromptInputSelect`, `PromptInputSelectTrigger`, `PromptInputSelectContent`, `PromptInputSelectItem`, `PromptInputSelectValue`.

- [ ] **Step 9:** Create `hover-card.tsx`

Extract `PromptInputHoverCard`, `PromptInputHoverCardTrigger`, `PromptInputHoverCardContent`.

- [ ] **Step 10:** Create `tabs.tsx`

Extract `PromptInputTabsList`, `PromptInputTab`, `PromptInputTabLabel`, `PromptInputTabBody`, `PromptInputTabItem`.

- [ ] **Step 11:** Create `command.tsx`

Extract `PromptInputCommand`, `PromptInputCommandInput`, `PromptInputCommandList`, `PromptInputCommandEmpty`, `PromptInputCommandGroup`, `PromptInputCommandItem`, `PromptInputCommandSeparator`.

- [ ] **Step 12:** Create `index.ts` barrel export

Re-export everything from all submodules so existing `import { ... } from "@/components/ai-elements/prompt-input"` paths still work.

- [ ] **Step 13:** Delete the original `prompt-input.tsx` file

```bash
rm components/ai-elements/prompt-input.tsx
```

- [ ] **Step 14:** Verify build

Run: `npm run build`

- [ ] **Step 15:** Commit

```bash
git add -A
git commit -m "refactor: split prompt-input.tsx into focused submodules"
```

---

### Task 6: Wire up attachment and screenshot tools in prism-prompt-input

Make file upload and screenshot buttons visible in the prompt input.

**Files:**
- Modify: `components/prism-prompt-input.tsx`

- [ ] **Step 1:** Read `components/prism-prompt-input.tsx` to understand current structure

- [ ] **Step 2:** Add `PromptInputActionAddAttachments` and `PromptInputActionAddScreenshot` to the rendered prompt input

Import them from `@/components/ai-elements/prompt-input` and add them to the input's action area (likely in the footer or tools section). Make them visible — not hidden in a menu.

- [ ] **Step 3:** Verify build

Run: `npm run build`

- [ ] **Step 4:** Commit

```bash
git add components/prism-prompt-input.tsx
git commit -m "feat: expose file upload and screenshot tools in prompt input"
```

---

## Phase 3: Settings Page Restructure

### Task 7: Create new Settings page with sidebar-nav layout

Build the new `/settings` page shell with vertical sidebar navigation.

**Files:**
- Rewrite: `app/settings/page.tsx` — new settings shell with sidebar nav and section routing
- Create: `app/settings/layout.tsx` — settings layout (if needed)

- [ ] **Step 1:** Read current `app/settings/page.tsx` to understand existing org settings structure

- [ ] **Step 2:** Create new settings page shell

The page should:
- Accept a `?section=` query param (default: `"sources"`)
- Render a left sidebar with section links: Sources, Intelligence, Activity, Agent, Organization, Team, API Keys
- Render the active section's content on the right
- Use `AppShell` as the outer wrapper
- Style the sidebar nav like GitHub/Vercel settings (vertical list, active indicator)

```tsx
const SETTINGS_SECTIONS = [
  { id: "sources", label: "Sources", icon: Mail },
  { id: "intelligence", label: "Intelligence", icon: Sparkles },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "agent", label: "Agent", icon: Bot },
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "api-keys", label: "API Keys", icon: Key },
] as const;
```

- [ ] **Step 3:** Initially render placeholder content for each section

Each section should show `<div>Section: {id}</div>` as a placeholder. We'll migrate content in subsequent tasks.

- [ ] **Step 4:** Verify build

Run: `npm run build`

- [ ] **Step 5:** Commit

```bash
git add app/settings/
git commit -m "feat: new settings page shell with sidebar-nav layout"
```

---

### Task 8: Migrate Organization and Team settings into new shell

Move the existing org settings content into the new settings page sections.

**Files:**
- Modify: `app/settings/page.tsx` — extract org settings sections into inline components or separate files
- Create: `components/settings/organization-section.tsx` — org info form
- Create: `components/settings/team-section.tsx` — team members management
- Create: `components/settings/api-keys-section.tsx` — API key management

- [ ] **Step 1:** Read existing `app/settings/page.tsx` fully to identify the 4 tab sections

- [ ] **Step 2:** Extract "Basic Information" tab content into `components/settings/organization-section.tsx`

Move the org name, website, industry, business context fields, broker info, and the dangerous actions (Reset Account, Remove Demo Data, Restart Onboarding) into a standalone component that accepts org data as props or fetches it internally.

- [ ] **Step 3:** Extract "Team Members" tab content into `components/settings/team-section.tsx`

Move member list, role management, invite modal, pending invitations.

- [ ] **Step 4:** Extract "API Keys" tab content into `components/settings/api-keys-section.tsx`

Move API key CRUD.

- [ ] **Step 5:** Wire sections into the new settings page

Import the three new section components and render them for their respective section IDs.

- [ ] **Step 6:** Verify build

Run: `npm run build`

- [ ] **Step 7:** Commit

```bash
git add -A
git commit -m "refactor: migrate org/team/api-keys settings into new settings shell"
```

---

### Task 9: Migrate Sources tab from Connections page

Move the email connections and integrations content into Settings → Sources.

**Files:**
- Create: `components/settings/sources-section.tsx`
- Modify: `app/settings/page.tsx` — wire Sources section
- Reference: `app/connections/page.tsx` — copy Sources tab content (the email connections list, integration cards, connection form, scan controls, email review table)

- [ ] **Step 1:** Read the Sources tab content in `app/connections/page.tsx`

Identify the exact JSX block rendered when `activeTab === "sources"` and `activeTab === "inbox"` (Scanned Emails merges into Sources).

- [ ] **Step 2:** Create `components/settings/sources-section.tsx`

Extract the Sources tab content. Include:
- Email connections list with actions (scan, remove, calendar)
- "Coming Soon" integration cards
- Connection form trigger
- Scanned Emails (EmailReviewTable) — shown when a connection is selected/expanded
- All necessary state and hooks from the connections page

- [ ] **Step 3:** Wire into settings page

- [ ] **Step 4:** Verify build

Run: `npm run build`

- [ ] **Step 5:** Commit

```bash
git add -A
git commit -m "refactor: migrate Sources into settings page"
```

---

### Task 10: Migrate Intelligence tab from Connections page

**Files:**
- Create: `components/settings/intelligence-section.tsx`
- Modify: `app/settings/page.tsx` — wire Intelligence section

- [ ] **Step 1:** Read the Intelligence tab content in `app/connections/page.tsx`

Identify the JSX block for `activeTab === "intelligence"`.

- [ ] **Step 2:** Create `components/settings/intelligence-section.tsx`

This is likely just a thin wrapper that renders `<IntelligenceTab />` (the existing 765-line component). Keep it simple — the IntelligenceTab component already handles its own sub-tabs and state.

- [ ] **Step 3:** Wire into settings page

- [ ] **Step 4:** Verify build

Run: `npm run build`

- [ ] **Step 5:** Commit

```bash
git add -A
git commit -m "refactor: migrate Intelligence into settings page"
```

---

### Task 11: Migrate Activity tab from Connections page

**Files:**
- Create: `components/settings/activity-section.tsx`
- Modify: `app/settings/page.tsx` — wire Activity section

- [ ] **Step 1:** Read the Activity tab content in `app/connections/page.tsx`

Identify the JSX block for `activeTab === "activity"`.

- [ ] **Step 2:** Create `components/settings/activity-section.tsx`

Extract the Activity tab content — DreamLog, EmailScanLog, PolicyExtractionsLog, and any upload/document extraction UI.

- [ ] **Step 3:** Wire into settings page

- [ ] **Step 4:** Verify build

Run: `npm run build`

- [ ] **Step 5:** Commit

```bash
git add -A
git commit -m "refactor: migrate Activity into settings page"
```

---

### Task 12: Migrate Agent settings from /agent page

**Files:**
- Create: `components/settings/agent-section.tsx`
- Modify: `app/settings/page.tsx` — wire Agent section
- Reference: `app/agent/page.tsx` — copy agent config content

- [ ] **Step 1:** Read `app/agent/page.tsx` to identify settings content

The page has: handle claim form, agent email display, mode explainer cards (Help), and settings (COI, email toggles, send delay).

- [ ] **Step 2:** Create `components/settings/agent-section.tsx`

Extract all agent config content into this component:
- Handle claim form (if unclaimed)
- Agent email with copy button (if claimed)
- Mode explainer cards
- COI settings, email notification toggle, auto-send toggle, send delay dropdown

- [ ] **Step 3:** Wire into settings page

- [ ] **Step 4:** Verify build

Run: `npm run build`

- [ ] **Step 5:** Commit

```bash
git add -A
git commit -m "refactor: migrate Agent config into settings page"
```

---

### Task 13: Add redirects and delete old pages

**Files:**
- Rewrite: `app/connections/page.tsx` — replace with redirect to `/settings?section=sources`
- Delete: `app/connections/layout.tsx`
- Rewrite: `app/agent/page.tsx` — replace with redirect to `/settings?section=agent`
- Modify: `app/extractions/layout.tsx` or page — update redirect to `/settings?section=activity`

- [ ] **Step 1:** Replace `app/connections/page.tsx` with redirect

```tsx
import { redirect } from "next/navigation";
export default function ConnectionsPage() {
  redirect("/settings?section=sources");
}
```

- [ ] **Step 2:** Delete `app/connections/layout.tsx`

- [ ] **Step 3:** Replace `app/agent/page.tsx` with redirect

```tsx
import { redirect } from "next/navigation";
export default function AgentPage() {
  redirect("/settings?section=agent");
}
```

- [ ] **Step 4:** Update extractions redirect

Read `app/extractions/` to check current redirect and update to `/settings?section=activity`.

- [ ] **Step 5:** Verify build

Run: `npm run build`

- [ ] **Step 6:** Commit

```bash
git add -A
git commit -m "refactor: add redirects for retired /connections and /agent routes"
```

---

## Phase 4: Navigation Update

### Task 14: Update sidebar navigation

**Files:**
- Modify: `components/app-sidebar.tsx`

- [ ] **Step 1:** Read `components/app-sidebar.tsx` fully

- [ ] **Step 2:** Update navigation groups

Change from:
```
Insurance: Dashboard, Policies, Applications
Tools: Context, Prism Agent
```

To:
```
Insurance: Dashboard, Policies, Applications
```

Remove the "Tools" group entirely. "Context"/"Connections" and "Prism Agent" links are gone — they're now in Settings.

- [ ] **Step 3:** Remove the "Ask Prism" sidebar input

Delete the search input component and its associated state/handlers from the sidebar. The dashboard will be the primary conversation entry point.

- [ ] **Step 4:** Ensure Settings link exists at bottom of sidebar

There should already be a Settings gear icon at the bottom (for admins). Make it visible for all users (not just admin) since Settings now contains Sources and other non-admin features. Keep admin-only sections (Team, API Keys, Organization dangerous actions) gated within the settings page itself.

- [ ] **Step 5:** Update keyboard shortcuts

Remove shortcuts for deleted nav items (Context = E, Agent = G). Keep Dashboard (D), Policies (O), Applications (Y), Settings (J).

- [ ] **Step 6:** Verify build

Run: `npm run build`

- [ ] **Step 7:** Commit

```bash
git add components/app-sidebar.tsx
git commit -m "refactor: simplify sidebar — remove Tools group and Ask Prism input"
```

---

## Phase 5: Dashboard Redesign

### Task 15: Redesign dashboard as conversation-first

**Files:**
- Rewrite: `app/page.tsx` — conversation hero + compact stats

- [ ] **Step 1:** Read current `app/page.tsx` to understand all sections

- [ ] **Step 2:** Redesign the page layout

New structure:
1. **Hero section** (top, centered): Large prompt input using `PrismPromptInput` (or the refactored prompt-input components). Big heading like "What can I help you with?" or "Ask Prism about your insurance." Center it vertically in available space when no stats exist.

2. **On submit behavior**: Create a new thread via Convex mutation, then `router.push(\`/agent/thread/\${threadId}\`)`. The navigation should feel seamless.

3. **Secondary section** (below, compact):
   - Single row of stat cards: Total policies, active policies, applications
   - Expiring policies list (next 90 days) — compact, max 5 items with "View all" link
   - Demo data banner (if applicable)

- [ ] **Step 3:** Remove old sections

Delete: agent card, coverage-by-type chart (moved to policies page in a future iteration), expiring quotes section (already removed in Task 2).

- [ ] **Step 4:** Verify build

Run: `npm run build`

- [ ] **Step 5:** Commit

```bash
git add app/page.tsx
git commit -m "feat: conversation-first dashboard with hero prompt input"
```

---

## Phase 6: Policy Detail Simplification

### Task 16: Refactor policy detail page to summary-first

**Files:**
- Rewrite: `app/policies/[id]/page.tsx` — slim down to shell + imports
- Create: `app/policies/[id]/policy-summary.tsx` — key facts card
- Create: `app/policies/[id]/extraction-panel.tsx` — collapsible extraction details
- Modify: `app/policies/[id]/loading.tsx` — ensure it matches new layout

- [ ] **Step 1:** Read the full `app/policies/[id]/page.tsx` (2,426 lines)

Understand the data flow: what Convex queries are used, what state is managed, how the tabs work, what the key facts are.

- [ ] **Step 2:** Create `app/policies/[id]/policy-summary.tsx`

A focused component showing the most important policy facts:
- Policy number, status badge (Active/Expired)
- Carrier name and logo (if available)
- Policy type (with color badge)
- Effective date → Expiration date
- Premium amount
- Key limits (per-occurrence, aggregate)
- Deductible
- Named insured

This should be a clean, scannable card — the user should understand the policy in 3 seconds.

- [ ] **Step 3:** Create `app/policies/[id]/extraction-panel.tsx`

A collapsible panel labeled "Extraction Details" (default collapsed) containing:
- The extracted document sections grouped into 3 categories:
  - Coverage & Limits (sections, endorsements, costs)
  - Exclusions & Conditions
  - Contacts & Regulatory
- Use the existing rendering logic but reorganized into these groups
- Accordion-style expand/collapse for each group

- [ ] **Step 4:** Rewrite `app/policies/[id]/page.tsx`

New structure:
1. Policy summary card (always visible)
2. PDF viewer (main content area, using existing PdfPanel/PdfViewer)
3. Extraction panel (collapsible, below PDF or as a side panel)

Keep the same Convex queries and data fetching. Just reorganize the presentation.

- [ ] **Step 5:** Update loading skeleton

Ensure `app/policies/[id]/loading.tsx` matches the new layout structure.

- [ ] **Step 6:** Verify build

Run: `npm run build`

- [ ] **Step 7:** Commit

```bash
git add app/policies/\[id\]/
git commit -m "refactor: policy detail — summary-first with collapsible extraction"
```

---

## Phase 7: Final Cleanup

### Task 17: Remove ask-prism-input and consolidate inputs

**Files:**
- Delete: `components/ask-prism-input.tsx`
- Review: `components/chat-input.tsx` — keep if used for email thread replies, otherwise delete
- Verify all remaining prompt input consumers work

- [ ] **Step 1:** Check what imports `ask-prism-input.tsx`

```bash
grep -r "ask-prism-input" --include="*.tsx" --include="*.ts"
```

Remove all imports and usages.

- [ ] **Step 2:** Check what imports `chat-input.tsx`

```bash
grep -r "chat-input" --include="*.tsx" --include="*.ts"
```

If only used in email thread UI, keep. If unused, delete.

- [ ] **Step 3:** Verify build

Run: `npm run build`

- [ ] **Step 4:** Commit

```bash
git add -A
git commit -m "refactor: remove unused input components"
```

---

### Task 18: Final build verification and lint

- [ ] **Step 1:** Run full build

```bash
npm run build
```

- [ ] **Step 2:** Run lint

```bash
npm run lint
```

- [ ] **Step 3:** Run TypeScript check

```bash
npx tsc --noEmit
```

- [ ] **Step 4:** Fix any errors found

- [ ] **Step 5:** Final commit

```bash
git add -A
git commit -m "chore: fix lint and type errors from visual refactor"
```

---

## Task Dependency Graph

```
Phase 1 (parallel):  Task 1, Task 2, Task 3, Task 4
Phase 2 (sequential): Task 5 → Task 6
Phase 3 (sequential): Task 7 → Task 8 → Tasks 9,10,11,12 (parallel) → Task 13
Phase 4:              Task 14 (depends on Task 13)
Phase 5:              Task 15 (depends on Task 14, Task 6)
Phase 6:              Task 16 (depends on Task 1)
Phase 7:              Task 17 → Task 18 (depends on all above)
```
