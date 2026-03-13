# Plan: Chat UX Improvements + Context Reference Cards

## 1. Auto-focus chat input on "New Chat"
**File**: `app/agent/thread/[id]/page.tsx`

The `UnifiedThreadContent` already has `useEffect(() => { inputRef.current?.focus(); }, [threadId])` (line 340-342). The issue is that when a new thread is created, the page navigates and the input focuses correctly. However, the textarea placeholder says "Reply to this thread..." which doesn't feel like a fresh chat.

**Change**: Update placeholder to "Ask Clarity anything..." when messages are empty, keep "Reply to this thread..." otherwise. The auto-focus already works — verified.

## 2. Restore example prompts to unified thread empty state
**File**: `app/agent/thread/[id]/page.tsx`

The `EXAMPLE_PROMPTS` array exists (line 702) but is only used in the legacy `WebChatContent` (line 859). The unified `UnifiedThreadContent` empty state (lines 411-421) just shows a heading and subtitle with no prompt suggestions.

**Change**: Move `EXAMPLE_PROMPTS` above the unified thread section and add the same grid to `UnifiedThreadContent`'s empty state. Wire the onClick to set input + focus, same as the legacy view.

## 3. Enhanced Context Reference Cards with Sidebar Preview

### 3a. Fix link paths — strip `localhost:3000` prefix
**File**: `components/context-reference-card.tsx`

The agent generates links like `http://localhost:3000/policies/abc123?page=1`. The markdown renderer sees the full URL, but `extractIdAndType` only matches paths starting with `/policies/` or `/quotes/`. Need to also handle full URLs by extracting the pathname.

**Change**: Update `extractIdAndType` to parse full URLs and extract the pathname portion before matching.

### 3b. Move cards below the message bubble (not inline in markdown)
**Files**: `app/agent/thread/[id]/page.tsx`, `components/chat-message-bubble.tsx`, `components/context-reference-card.tsx`

Currently `ContextReferenceCard` is rendered inline inside markdown via custom `a` component. This is awkward — the cards are inside the text bubble. Better UX: collect all internal links from the message content, render normal styled text for the link inside the markdown, then show cards below the bubble.

**Approach**:
1. Create a `extractInternalLinks(content: string)` helper that finds all markdown links matching `/policies/` or `/quotes/` patterns (including full URLs) and returns `{ id, type, href, page? }[]`
2. In `UnifiedMessageBubble` and `ChatMessageBubble` agent messages: call this helper, render cards below the bubble
3. Change the markdown `a` component to render internal links as styled inline text (not a card) — e.g. bold text with a subtle indicator
4. The cards below the bubble show carrier, policy number, type tags, and a page reference

### 3c. Context preview sidebar
**Files**: New `components/context-preview-panel.tsx`, update `components/app-shell.tsx`, update `components/context-reference-card.tsx`

When clicking a reference card, instead of navigating away, open a sidebar panel (similar to PDF panel) that shows key policy/quote details with a "View full page" button.

**Approach**:
1. Create a new React context `ContextPreviewProvider` (similar to `PdfProvider`) with state: `{ isOpen, entityId, entityType, page?, open(), close() }`
2. Add `ContextPreviewPanel` component — a right sidebar (same position/style as PDF panel) that:
   - Fetches policy/quote data via `useQuery`
   - Shows: carrier, policy number, dates, coverage types, premium, key coverages table
   - Has a toolbar with: close button, "Open full page" link (opens in same tab), "View PDF" button (opens PDF panel)
   - For quotes: shows similar data (carrier, premium, expiry, coverage summary)
3. Update `AppShell` to include `ContextPreviewProvider` and render `ContextPreviewPanel` alongside (or instead of) `PdfPanel`
4. Update `ContextReferenceCard` (the below-bubble card) onClick to call `contextPreview.open(id, type, page)` instead of navigating

**Preview panel data** (for policies):
- Carrier + policy number
- Policy types (tags)
- Effective/expiry dates
- Premium
- Insured name
- Key entities (broker, MGA, underwriter)
- Coverage limits summary (first 5-6 items from the document sections)
- "View PDF" and "View Full Details" buttons

**Preview panel data** (for quotes):
- Carrier + quote reference
- Coverage types
- Quote date / expiry
- Premium
- Key terms summary
- "View PDF" and "View Full Details" buttons

## Implementation Order
1. Fix #1 (auto-focus placeholder) — trivial
2. Fix #2 (example prompts) — small
3. Fix #3a (link path parsing) — small
4. Fix #3b (cards below bubble) — medium
5. Fix #3c (context preview sidebar) — larger, new component + context
