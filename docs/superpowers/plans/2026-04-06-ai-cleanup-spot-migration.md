# AI Cleanup + Spot Feature Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix blank streaming responses and stuck application sessions, consolidate duplicated AI utilities, introduce multi-model architecture with fallback, add agentic tool use, per-org memory, proactive intelligence, AI-written emails, and COI generation.

**Architecture:** Interleaved cleanup + feature migration across 5 phases (0-4). Each phase ships independently. Phase 0 fixes critical bugs. Phase 1 builds the AI foundation (models + utils). Phase 2 adds tool use and unifies streaming. Phase 3 adds org memory and proactive analysis. Phase 4 adds AI emails and COI generation.

**Tech Stack:** Vercel AI SDK (`ai` v6), `@ai-sdk/anthropic`, `@ai-sdk/deepseek`, `@ai-sdk/moonshotai`, Convex (serverless DB + functions), `@claritylabs/cl-sdk` v1.4, pdfkit, pdf-lib

**Spec:** `docs/superpowers/specs/2026-04-06-ai-cleanup-spot-migration-design.md`

---

## Phase 0: Emergency Streaming Fix

### Task 1: Add `onError` to useChat and guard on auth token

**Files:**
- Modify: `app/agent/thread/[id]/page.tsx:617-636`

- [ ] **Step 1: Add onError callback and auth guard to useChat config**

In `app/agent/thread/[id]/page.tsx`, find the `useChat` block (lines 626-636):

```typescript
  const {
    messages: chatMessages,
    status: chatStatus,
    sendMessage: sendChatMessage,
    stop,
    setMessages: setChatMessages,
  } = useChat({
    transport: chatTransport,
    messages: [],
  });
```

Replace with:

```typescript
  const [chatError, setChatError] = useState<string | null>(null);

  const {
    messages: chatMessages,
    status: chatStatus,
    sendMessage: sendChatMessage,
    stop,
    setMessages: setChatMessages,
  } = useChat({
    transport: chatTransport,
    messages: [],
    onError: (error) => {
      console.error("Chat stream error:", error);
      setChatError(
        error.message.includes("Unauthorized")
          ? "Session expired. Please refresh the page."
          : "Failed to get a response. Please try again.",
      );
    },
  });
```

Add the `useState` import if not already present (it should be).

- [ ] **Step 2: Guard sendChatMessage on auth token readiness**

Find the `handleSend` callback (line 727). In the text-only streaming path (line 766-770):

```typescript
    // For text-only messages, use streaming via useChat
    // Persist user message to Convex but skip backend agent response
    // (the streaming API route will handle the response)
    await sendMessage({ threadId, content: text, skipAgentResponse: true });

    // Trigger streaming via useChat (the API route will handle the response)
    setChatMessages([]);
    await sendChatMessage({ text });
```

Replace with:

```typescript
    // For text-only messages, use streaming via useChat
    if (!authToken) {
      toast.error("Session expired. Please refresh the page.");
      return;
    }

    // Clear any previous error
    setChatError(null);

    // Persist user message to Convex but skip backend agent response
    await sendMessage({ threadId, content: text, skipAgentResponse: true });

    // Trigger streaming via useChat
    setChatMessages([]);
    await sendChatMessage({ text });
```

- [ ] **Step 3: Display chat error in the UI**

Find where the streaming message is rendered (search for `streamingText` in the JSX). Add error display near the streaming message area. Find the message list rendering section and add after the streaming message block:

```typescript
{chatError && !streamingMessage && (
  <div className="mx-4 mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
    {chatError}
  </div>
)}
```

- [ ] **Step 4: Run the dev server and verify**

Run: `cd /Users/terrywang/Repos/prism && npm run build 2>&1 | tail -20`

Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add app/agent/thread/[id]/page.tsx
git commit -m "fix: add onError handler and auth guard to useChat streaming"
```

---

### Task 2: Fix streaming error handling in `/api/chat/route.ts`

**Files:**
- Modify: `app/api/chat/route.ts:164-243`

- [ ] **Step 1: Wrap streamText in try/catch with structured error response**

In `app/api/chat/route.ts`, the current code at line 164 calls `streamText()` inside a large try/catch. The problem is that if `streamText()` itself throws (before streaming starts), the error catch at line 224 returns a JSON response — but `useChat` expects a specific format. If `onFinish` fails, the persisted message is lost.

Replace the `streamText` call and its surrounding code (lines 163-223) with:

```typescript
    // Stream response
    let result;
    try {
      result = streamText({
        model: anthropic(HAIKU_MODEL),
        maxOutputTokens: 2048,
        system: fullSystemPrompt,
        messages: messageHistory,
        onFinish: async ({ text }) => {
          // Persist final message — retry once on failure
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              await convex.mutation(api.threads.updateAgentResponse, {
                messageId: agentMsgId,
                content: text,
                referencedPolicyIds:
                  relevantPolicyIds.length > 0
                    ? (relevantPolicyIds as any)
                    : undefined,
                referencedQuoteIds:
                  relevantQuoteIds.length > 0
                    ? (relevantQuoteIds as any)
                    : undefined,
              });
              break; // success
            } catch (persistErr) {
              if (attempt === 0) {
                console.warn("Failed to persist agent response, retrying:", persistErr);
                continue;
              }
              console.error("Failed to persist agent response after retry:", persistErr);
              // Mark the message as error so UI shows something
              try {
                await convex.mutation(api.threads.setMessageError, {
                  messageId: agentMsgId,
                  error: "Response generated but failed to save. Please try again.",
                });
              } catch {
                // Best effort
              }
            }
          }

          // Auto-title on first user message
          const userMessages = threadMessages.filter(
            (m: any) => m.role === "user",
          );
          if (userMessages.length <= 1) {
            try {
              const { text: titleText } = await generateText({
                model: anthropic(HAIKU_MODEL),
                maxOutputTokens: 12,
                system:
                  'You are a title generator. Given a user question and an assistant reply, output a short 2-4 word title that captures the topic. Rules:\n- Output ONLY the title, no quotes, no punctuation, no explanation\n- Use title case\n- Examples: "GL Coverage Limits", "Cyber Liability Quotes", "Workers Comp App", "Renewal Timeline"',
                messages: [
                  {
                    role: "user",
                    content: `User: ${latestUserContent}\n\nAssistant: ${text.slice(0, 200)}`,
                  },
                ],
              });
              const title = titleText
                .trim()
                .replace(/^["']|["']$/g, "")
                .split("\n")[0];
              if (title && title.length <= 40) {
                await convex.mutation(api.threads.updateTitle, {
                  id: threadId as any,
                  title,
                });
              }
            } catch {
              // Non-critical
            }
          }
        },
      });
    } catch (streamError) {
      // streamText setup failed (bad model config, auth issue, etc.)
      const msg = streamError instanceof Error ? streamError.message : String(streamError);
      console.error("streamText initialization failed:", msg);
      try {
        await convex.mutation(api.threads.setMessageError, {
          messageId: agentMsgId,
          error: "Failed to start response. Please try again.",
        });
      } catch {
        // Best effort
      }
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return result.toUIMessageStreamResponse();
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/terrywang/Repos/prism && npm run build 2>&1 | tail -20`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "fix: add retry on persist failure and structured error responses in chat API"
```

---

### Task 3: Add `failed` status to application sessions

**Files:**
- Modify: `convex/schema.ts:113-121`
- Modify: `convex/applicationSessions.ts:324-345`

- [ ] **Step 1: Add `failed` status and `failureReason` field to schema**

In `convex/schema.ts`, find the `applicationSessions` status union (lines 113-121):

```typescript
    status: v.union(
      v.literal("extracting_fields"),
      v.literal("filling_known"),
      v.literal("asking_questions"),
      v.literal("pending_confirmation"),
      v.literal("confirmed"),
      v.literal("complete"),
      v.literal("cancelled"),
    ),
```

Replace with:

```typescript
    status: v.union(
      v.literal("extracting_fields"),
      v.literal("filling_known"),
      v.literal("asking_questions"),
      v.literal("pending_confirmation"),
      v.literal("confirmed"),
      v.literal("complete"),
      v.literal("cancelled"),
      v.literal("failed"),
    ),
    failureReason: v.optional(v.string()),
    lastProgressAt: v.optional(v.number()),
```

- [ ] **Step 2: Update `updateStatus` mutation to include `failed`**

In `convex/applicationSessions.ts`, find the `updateStatus` mutation (lines 324-345). Replace the `status` arg validator:

```typescript
    status: v.union(
      v.literal("extracting_fields"),
      v.literal("filling_known"),
      v.literal("asking_questions"),
      v.literal("pending_confirmation"),
      v.literal("confirmed"),
      v.literal("complete"),
      v.literal("cancelled"),
    ),
```

With:

```typescript
    status: v.union(
      v.literal("extracting_fields"),
      v.literal("filling_known"),
      v.literal("asking_questions"),
      v.literal("pending_confirmation"),
      v.literal("confirmed"),
      v.literal("complete"),
      v.literal("cancelled"),
      v.literal("failed"),
    ),
```

- [ ] **Step 3: Add `markFailed` mutation**

In `convex/applicationSessions.ts`, after the `updateError` mutation (line 381), add:

```typescript
export const markFailed = internalMutation({
  args: {
    id: v.id("applicationSessions"),
    failureReason: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "failed",
      failureReason: args.failureReason,
    });
  },
});
```

- [ ] **Step 4: Add `updateProgress` mutation for tracking**

In `convex/applicationSessions.ts`, after the `markFailed` mutation, add:

```typescript
export const updateProgress = internalMutation({
  args: {
    id: v.id("applicationSessions"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { lastProgressAt: Date.now() });
  },
});
```

- [ ] **Step 5: Run `npx convex dev --typecheck=disable --once` to push schema**

Run: `cd /Users/terrywang/Repos/prism && npx convex dev --typecheck=disable --once 2>&1 | tail -10`

Expected: Schema pushed successfully (new fields are optional so no migration needed).

- [ ] **Step 6: Commit**

```bash
git add convex/schema.ts convex/applicationSessions.ts
git commit -m "feat: add failed status, failureReason, and lastProgressAt to application sessions"
```

---

### Task 4: Add stale session detection check

**Files:**
- Modify: `convex/applicationSessions.ts`

- [ ] **Step 1: Add `checkStaleAndFail` query + mutation**

In `convex/applicationSessions.ts`, add at the end of the file:

```typescript
/** Check for and mark stale application sessions (no progress for >5 minutes) */
export const checkStaleAndFail = internalMutation({
  args: {},
  handler: async (ctx) => {
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    const activeStatuses = ["extracting_fields", "filling_known"];

    let failedCount = 0;
    for (const status of activeStatuses) {
      const sessions = await ctx.db
        .query("applicationSessions")
        .withIndex("by_status", (q) => q.eq("status", status as any))
        .collect();

      for (const session of sessions) {
        const lastActivity = session.lastProgressAt ?? session._creationTime;
        if (now - lastActivity > staleThreshold) {
          await ctx.db.patch(session._id, {
            status: "failed",
            failureReason: `Processing timed out after ${Math.round((now - lastActivity) / 60000)} minutes in "${status}" phase. Use the retry button to try again.`,
          });
          failedCount++;
        }
      }
    }
    return failedCount;
  },
});
```

- [ ] **Step 2: Register cron for stale session detection**

Check if `convex/crons.ts` exists. If it does, add the stale check to it. If not, create it:

```typescript
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "check stale application sessions",
  { minutes: 2 },
  internal.applicationSessions.checkStaleAndFail,
);

export default crons;
```

If `convex/crons.ts` already exists, add the new cron entry to the existing `crons` object.

- [ ] **Step 3: Verify build**

Run: `cd /Users/terrywang/Repos/prism && npx convex dev --typecheck=disable --once 2>&1 | tail -10`

Expected: Pushed successfully.

- [ ] **Step 4: Commit**

```bash
git add convex/applicationSessions.ts convex/crons.ts
git commit -m "feat: add stale application session detection with 5-minute timeout"
```

---

## Phase 1: AI Foundation

### Task 5: Create `convex/lib/models.ts` — multi-model architecture

**Files:**
- Create: `convex/lib/models.ts`

- [ ] **Step 1: Install new AI SDK providers**

Run: `cd /Users/terrywang/Repos/prism && npm install @ai-sdk/deepseek @ai-sdk/moonshotai`

Expected: Packages installed successfully.

- [ ] **Step 2: Create the models file**

Create `convex/lib/models.ts`:

```typescript
"use node";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createMoonshotAI } from "@ai-sdk/moonshotai";
import { createDeepSeek } from "@ai-sdk/deepseek";

/**
 * Centralized model configuration for Prism.
 *
 * Maps each task type to a provider + model. Tune costs and quality from one place.
 * All models are accessed via Vercel AI SDK's provider-agnostic interface.
 *
 * Env vars needed:
 *   ANTHROPIC_API_KEY — Claude Haiku (classification), Claude Sonnet (extraction/fallback)
 *   DEEPSEEK_API_KEY — DeepSeek V3 (primary for chat/tool-calling Q&A)
 *   MOONSHOTAI_API_KEY — Kimi K2.5 (reasoning: analysis, email writing)
 */

// Lazy provider factories
let _anthropic: ReturnType<typeof createAnthropic> | null = null;
let _moonshot: ReturnType<typeof createMoonshotAI> | null = null;
let _deepseek: ReturnType<typeof createDeepSeek> | null = null;

function anthropic() {
  if (!_anthropic) _anthropic = createAnthropic();
  return _anthropic;
}

function moonshot() {
  if (!_moonshot) _moonshot = createMoonshotAI();
  return _moonshot;
}

function deepseek() {
  if (!_deepseek) _deepseek = createDeepSeek();
  return _deepseek;
}

/**
 * Task types used throughout the codebase.
 * Each maps to a specific model optimized for cost/quality.
 */
export type ModelTask =
  | "chat"              // Web chat Q&A
  | "chat_with_tools"   // Agentic chat with function calling
  | "email_draft"       // AI-generated email body
  | "email_reply"       // Inbound email agent response
  | "extraction"        // PDF policy/quote extraction (Sonnet required by cl-sdk)
  | "classification"    // Email classification, intent detection
  | "analysis"          // Policy/portfolio analysis
  | "summary";          // Summarization tasks

/**
 * Model configuration — change these to swap providers/models per task.
 *
 * Cost tiers (approximate $/1M tokens, input/output):
 *   DeepSeek V3:       $0.27 / $1.10   (cheapest with good tool calling)
 *   Kimi K2.5:         ~$0.60 / $2     (excellent value, 256K context)
 *   Claude Haiku:      $0.80 / $4      (fast, cheap)
 *   Claude Sonnet:     $3 / $15        (premium fallback)
 */
const MODEL_CONFIG: Record<ModelTask, () => any> = {
  // DeepSeek V3 — agentic Q&A with tool use
  chat:             () => deepseek()("deepseek-chat"),
  chat_with_tools:  () => deepseek()("deepseek-chat"),

  // Kimi K2.5 — reasoning tasks at low cost
  email_draft:      () => moonshot()("kimi-k2.5"),
  email_reply:      () => moonshot()("kimi-k2.5"),
  analysis:         () => moonshot()("kimi-k2.5"),
  summary:          () => deepseek()("deepseek-chat"),

  // Claude — classification + extraction
  classification:   () => anthropic()("claude-haiku-4-5-20251001"),
  extraction:       () => anthropic()("claude-sonnet-4-6"),
};

/**
 * Get the model for a given task.
 * Falls back to Claude Sonnet if the preferred provider isn't configured.
 */
export function getModel(task: ModelTask) {
  const factory = MODEL_CONFIG[task];
  if (!factory) {
    console.warn(`Unknown model task "${task}", falling back to chat`);
    return MODEL_CONFIG.chat();
  }
  try {
    return factory();
  } catch (err) {
    console.warn(`Provider for task "${task}" not available, falling back to Claude Sonnet`);
    return anthropic()("claude-sonnet-4-6");
  }
}

/**
 * generateText with automatic fallback.
 * Tries the primary model first. If it fails, retries with Claude Sonnet.
 */
export async function generateTextWithFallback(
  options: Parameters<typeof import("ai").generateText>[0],
): Promise<Awaited<ReturnType<typeof import("ai").generateText>>> {
  const { generateText } = await import("ai");
  try {
    return await generateText(options);
  } catch (err: any) {
    const modelId = (options.model as any)?.modelId || "unknown";
    if (modelId.includes("claude-sonnet")) throw err; // already on fallback
    console.warn(
      `Primary model (${modelId}) failed: ${err.message || err}. Retrying with Claude Sonnet.`,
    );
    return await generateText({
      ...options,
      model: anthropic()("claude-sonnet-4-6"),
    });
  }
}

/**
 * generateText with structured output and automatic fallback.
 * In AI SDK v6, generateObject was removed — use generateText with Output.object().
 *
 * Usage:
 *   import { Output } from "ai";
 *   const result = await generateStructuredWithFallback({
 *     model: getModel("analysis"),
 *     output: Output.object({ schema: myZodSchema }),
 *     ...
 *   });
 */
export async function generateStructuredWithFallback(
  options: Parameters<typeof import("ai").generateText>[0],
): Promise<Awaited<ReturnType<typeof import("ai").generateText>>> {
  const { generateText } = await import("ai");
  try {
    return await generateText(options);
  } catch (err: any) {
    const modelId = (options.model as any)?.modelId || "unknown";
    if (modelId.includes("claude-sonnet")) throw err;
    console.warn(
      `Primary model (${modelId}) failed for structured output: ${err.message || err}. Retrying with Claude Sonnet.`,
    );
    return await generateText({
      ...options,
      model: anthropic()("claude-sonnet-4-6"),
    });
  }
}

/**
 * Check which providers are available based on env vars.
 */
export function availableProviders(): string[] {
  const providers: string[] = [];
  if (process.env.ANTHROPIC_API_KEY) providers.push("anthropic");
  if (process.env.DEEPSEEK_API_KEY) providers.push("deepseek");
  if (process.env.MOONSHOTAI_API_KEY) providers.push("moonshot");
  return providers;
}
```

- [ ] **Step 3: Commit**

```bash
git add convex/lib/models.ts package.json package-lock.json
git commit -m "feat: add multi-model architecture with task-based routing and fallback"
```

---

### Task 6: Create `convex/lib/aiUtils.ts` — centralized utilities

**Files:**
- Create: `convex/lib/aiUtils.ts`

- [ ] **Step 1: Create the centralized utilities file**

Create `convex/lib/aiUtils.ts`:

```typescript
import type { ModelMessage } from "ai";
import {
  buildSystemPrompt,
  buildConversationMemoryContext,
} from "@claritylabs/cl-sdk";

// Re-export for convenience
export { buildConversationMemoryContext };

/* ── Markdown processing ── */

/** Strip markdown formatting to plain text (for email plaintext bodies). */
export function stripMarkdown(text: string): string {
  let result = text;
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "$1");
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)");
  result = result.replace(/\*\*(.+?)\*\*/g, "$1");
  result = result.replace(/\*(.+?)\*/g, "$1");
  return result;
}

/** Convert markdown to simple inline HTML (for email HTML bodies). */
export function markdownToHtml(text: string): string {
  const linkStyle = 'style="color:#2563eb;text-decoration:underline"';
  let result = text;
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "<strong>$1</strong>");
  result = result.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    `<a href="$2" ${linkStyle}>$1</a>`,
  );
  result = result.replace(
    /(?<!href=")(https?:\/\/[^\s<)]+)/g,
    `<a href="$1" ${linkStyle}>$1</a>`,
  );
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  return result;
}

/* ── Email signature ── */

/** Build the "sent with Prism" signature in both text and HTML. */
export function buildSignature(): { text: string; html: string } {
  const siteUrl = process.env.SITE_URL ?? "https://prism.claritylabs.inc";
  const text = "\n\nsent with Prism";
  const html = `<p style="font-size:12px;color:#999;margin:24px 0 0"><a href="${siteUrl}" style="color:#999;text-decoration:none">sent with Prism</a></p>`;
  return { text, html };
}

/* ── Message history ── */

interface ThreadMessage {
  role: string;
  content: string;
  status?: string;
  userName?: string;
  channel?: string;
}

/** Build ModelMessage[] from thread messages, skipping processing placeholders. */
export function buildMessageHistory(messages: ThreadMessage[]): ModelMessage[] {
  const history: ModelMessage[] = [];
  for (const msg of messages) {
    if (msg.status === "processing") continue;
    if (msg.role === "user") {
      history.push({
        role: "user",
        content: msg.userName
          ? `[${msg.userName}]: ${msg.content}`
          : msg.content,
      });
    } else if (msg.role === "agent" && msg.content) {
      history.push({ role: "assistant", content: msg.content });
    }
  }
  return history;
}

/* ── System prompt ── */

interface OrgContext {
  name: string;
  context?: string;
  coiHandling?: string;
  insuranceBroker?: string;
  brokerContactName?: string;
  brokerContactEmail?: string;
}

/**
 * Build the full system prompt for a given mode.
 * Wraps cl-sdk's buildSystemPrompt with consistent field handling.
 * User-controlled fields (org.context, org.name) are fenced to mitigate prompt injection.
 */
export function buildSystemPromptForContext(params: {
  org: OrgContext;
  mode: "direct" | "cc" | "forward";
  userName?: string;
  siteUrl?: string;
}): string {
  const { org, mode, userName } = params;
  const siteUrl = params.siteUrl ?? process.env.SITE_URL ?? "https://prism.claritylabs.inc";

  // Fence user-controlled org context to prevent prompt injection
  const safeContext = org.context
    ? `<org_context>${org.context}</org_context>`
    : undefined;

  return buildSystemPrompt(
    mode,
    safeContext,
    siteUrl,
    org.name,
    userName,
    org.coiHandling as any,
    org.insuranceBroker,
    org.brokerContactName,
    org.brokerContactEmail,
  );
}

/* ── Structured error logging ── */

/** Log AI errors with structured context. Redacts known secret patterns. */
export function logAiError(
  action: string,
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  const message = error instanceof Error ? error.message : String(error);
  // Redact API keys from error messages
  const safeMessage = message
    .replace(/Bearer\s+[a-zA-Z0-9_-]+/g, "Bearer [REDACTED]")
    .replace(/re_[a-zA-Z0-9_]+/g, "[RESEND_KEY_REDACTED]")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[API_KEY_REDACTED]");

  console.error(`[${action}] ${safeMessage}`, {
    action,
    ...context,
    timestamp: new Date().toISOString(),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add convex/lib/aiUtils.ts
git commit -m "feat: add centralized AI utilities (markdown, signatures, message history, system prompts)"
```

---

### Task 7: Update `convex/lib/ai.ts` to delegate to models

**Files:**
- Modify: `convex/lib/ai.ts`

- [ ] **Step 1: Update ai.ts to delegate**

Replace the entire contents of `convex/lib/ai.ts`:

```typescript
import { getModel } from "./models";
import { HAIKU_MODEL, SONNET_MODEL } from "./extraction";

// Re-export model constants for backward compat
export { HAIKU_MODEL, SONNET_MODEL };

/**
 * @deprecated Use `getModel("classification")` from `./models` instead.
 * Kept for backward compat during Phase 1 migration.
 */
export const haikuModel = getModel("classification");

/**
 * @deprecated Use `getModel("extraction")` from `./models` instead.
 */
export const sonnetModel = getModel("extraction");
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/terrywang/Repos/prism && npx convex dev --typecheck=disable --once 2>&1 | tail -10`

Expected: No errors — all existing callsites that import `haikuModel`/`sonnetModel` still work.

- [ ] **Step 3: Commit**

```bash
git add convex/lib/ai.ts
git commit -m "refactor: delegate haikuModel/sonnetModel to new getModel() router"
```

---

### Task 8: Migrate `processThreadChat.ts` to new models + utils

**Files:**
- Modify: `convex/actions/processThreadChat.ts:1-43` (imports and helpers)
- Modify: `convex/actions/processThreadChat.ts:124-134` (system prompt)
- Modify: `convex/actions/processThreadChat.ts:166-179` (message history)
- Modify: `convex/actions/processThreadChat.ts:278-283` (model usage)

- [ ] **Step 1: Replace imports and remove duplicated helpers**

In `convex/actions/processThreadChat.ts`, replace lines 1-43:

```typescript
"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { streamText, generateText, type ModelMessage } from "ai";
import { haikuModel } from "../lib/ai";
import {
  buildSystemPrompt,
  buildDocumentContext,
  buildConversationMemoryContext,
} from "../lib/agentPrompts";

/* ── Email helpers (shared with handleInboundEmail) ── */

function buildSignature(): { text: string; html: string } {
  const siteUrl = process.env.SITE_URL ?? "https://prism.claritylabs.inc";
  const text = "\n\nsent with Prism";
  const html = `<p style="font-size:12px;color:#999;margin:24px 0 0"><a href="${siteUrl}" style="color:#999;text-decoration:none">sent with Prism</a></p>`;
  return { text, html };
}

function stripMarkdown(text: string) {
  let result = text;
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "$1");
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)");
  result = result.replace(/\*\*(.+?)\*\*/g, "$1");
  result = result.replace(/\*(.+?)\*/g, "$1");
  return result;
}

function markdownToHtml(text: string) {
  const linkStyle = 'style="color:#2563eb;text-decoration:underline"';
  let result = text;
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "<strong>$1</strong>");
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    `<a href="$2" ${linkStyle}>$1</a>`);
  result = result.replace(/(?<!href=")(https?:\/\/[^\s<)]+)/g,
    `<a href="$1" ${linkStyle}>$1</a>`);
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  return result;
}
```

With:

```typescript
"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { streamText, generateText } from "ai";
import { getModel } from "../lib/models";
import { buildDocumentContext } from "../lib/agentPrompts";
import {
  buildSystemPromptForContext,
  buildMessageHistory,
  buildSignature,
  stripMarkdown,
  markdownToHtml,
  buildConversationMemoryContext,
  logAiError,
} from "../lib/aiUtils";
```

- [ ] **Step 2: Replace system prompt building**

Find the system prompt building block (around original line 124-134):

```typescript
      const systemPrompt = buildSystemPrompt(
        "direct",
        org.context,
        siteUrl,
        org.name,
        userName,
        org.coiHandling as any,
        org.insuranceBroker,
        org.brokerContactName,
        org.brokerContactEmail,
      );
```

Replace with:

```typescript
      const systemPrompt = buildSystemPromptForContext({
        org,
        mode: "direct",
        userName,
        siteUrl,
      });
```

- [ ] **Step 3: Replace message history building**

Find the manual message history loop (around original lines 166-179):

```typescript
      const messageHistory: ModelMessage[] = [];
      for (const msg of allMessages) {
        if (msg.status === "processing") continue;
        if (msg.role === "user") {
          messageHistory.push({
            role: "user",
            content: msg.userName
              ? `[${msg.userName}]: ${msg.content}`
              : msg.content,
          });
        } else if (msg.role === "agent" && msg.content) {
          messageHistory.push({ role: "assistant", content: msg.content });
        }
      }
```

Replace with:

```typescript
      const messageHistory = buildMessageHistory(allMessages);
```

- [ ] **Step 4: Replace model in streamText call**

Find `model: haikuModel` in the `streamText` call (around original line 279). Replace with:

```typescript
        model: getModel("chat"),
```

Also replace `model: haikuModel` in the auto-title `generateText` call (around original line 466-467) with:

```typescript
          model: getModel("summary"),
```

- [ ] **Step 5: Replace error logging**

Find `console.error("Thread chat agent error:", message)` (around original line 495). Replace with:

```typescript
      logAiError("processThreadChat", error, { threadId: args.threadId, orgId: args.orgId });
```

Also find `console.error("Failed to send email from chat:", err)` (around original line 451). Replace with:

```typescript
            logAiError("processThreadChat.sendEmail", err, { threadId: args.threadId });
```

- [ ] **Step 6: Verify build**

Run: `cd /Users/terrywang/Repos/prism && npx convex dev --typecheck=disable --once 2>&1 | tail -10`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add convex/actions/processThreadChat.ts
git commit -m "refactor: migrate processThreadChat to centralized models and utilities"
```

---

### Task 9: Migrate `mcpChat.ts` to new models + utils

**Files:**
- Modify: `convex/actions/mcpChat.ts`

- [ ] **Step 1: Replace imports**

In `convex/actions/mcpChat.ts`, replace lines 1-12:

```typescript
"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText, type ModelMessage } from "ai";
import { haikuModel } from "../lib/ai";
import {
  buildSystemPrompt,
  buildDocumentContext,
  buildConversationMemoryContext,
} from "../lib/agentPrompts";
```

With:

```typescript
"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText } from "ai";
import { getModel } from "../lib/models";
import { buildDocumentContext } from "../lib/agentPrompts";
import {
  buildSystemPromptForContext,
  buildMessageHistory,
  buildConversationMemoryContext,
  logAiError,
} from "../lib/aiUtils";
```

- [ ] **Step 2: Replace system prompt building (lines 64-74)**

```typescript
    const systemPrompt = buildSystemPrompt(
      "direct",
      org.context,
      siteUrl,
      org.name,
      userName,
      org.coiHandling as any,
      org.insuranceBroker,
      org.brokerContactName,
      org.brokerContactEmail,
    );
```

With:

```typescript
    const systemPrompt = buildSystemPromptForContext({
      org,
      mode: "direct",
      userName,
      siteUrl,
    });
```

- [ ] **Step 3: Replace message history building (lines 117-130)**

```typescript
    const messageHistory: ModelMessage[] = [];
    for (const msg of allMessages) {
      if (msg.status === "processing") continue;
      if (msg.role === "user") {
        messageHistory.push({
          role: "user",
          content: msg.userName
            ? `[${msg.userName}]: ${msg.content}`
            : msg.content,
        });
      } else if (msg.role === "agent" && msg.content) {
        messageHistory.push({ role: "assistant", content: msg.content });
      }
    }
```

With:

```typescript
    const messageHistory = buildMessageHistory(allMessages);
```

- [ ] **Step 4: Replace model references**

Replace `model: haikuModel` in both `generateText` calls (lines 134 and 158) with:

```typescript
      model: getModel("chat"),
```

And for the title generation call:

```typescript
          model: getModel("summary"),
```

- [ ] **Step 5: Verify build**

Run: `cd /Users/terrywang/Repos/prism && npx convex dev --typecheck=disable --once 2>&1 | tail -10`

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add convex/actions/mcpChat.ts
git commit -m "refactor: migrate mcpChat to centralized models and utilities"
```

---

### Task 10: Migrate `app/api/chat/route.ts` to new models + utils

**Files:**
- Modify: `app/api/chat/route.ts`

- [ ] **Step 1: Replace imports and remove local model constant**

In `app/api/chat/route.ts`, replace lines 1-14:

```typescript
import { NextRequest } from "next/server";
import { streamText, generateText, type ModelMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import {
  buildSystemPrompt,
  buildDocumentContext,
} from "@claritylabs/cl-sdk";

export const maxDuration = 60;

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;
```

With:

```typescript
import { NextRequest } from "next/server";
import { streamText, generateText } from "ai";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { buildDocumentContext } from "@claritylabs/cl-sdk";
import { getModel } from "@/convex/lib/models";
import {
  buildSystemPromptForContext,
  buildMessageHistory,
  logAiError,
} from "@/convex/lib/aiUtils";

export const maxDuration = 60;

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;
```

**Note:** The `app/api/chat/route.ts` runs in the Next.js edge/Node runtime, not in Convex. Importing from `convex/lib/models.ts` should work since those are pure TypeScript modules. If the `"use node"` directive causes issues, it can be removed from `models.ts` since the directive is Convex-specific and Next.js ignores it.

- [ ] **Step 2: Replace system prompt building (lines 75-85)**

```typescript
    const systemPrompt = buildSystemPrompt(
      "direct",
      org.context,
      siteUrl,
      org.name,
      userName,
      org.coiHandling as any,
      org.insuranceBroker,
      org.brokerContactName,
      org.brokerContactEmail,
    );
```

With:

```typescript
    const systemPrompt = buildSystemPromptForContext({
      org,
      mode: "direct",
      userName,
      siteUrl,
    });
```

- [ ] **Step 3: Replace message history building (lines 106-136)**

Replace the entire message history block (including the "add latest user message" logic) with:

```typescript
    // Build message history from thread messages
    const messageHistory = buildMessageHistory(threadMessages);

    // Add the latest user message from useChat if not already in thread
    const lastChat = chatMessages?.[chatMessages.length - 1];
    if (lastChat?.role === "user") {
      const lastThreadMsg = threadMessages[threadMessages.length - 1];
      if (
        !lastThreadMsg ||
        lastThreadMsg.content !== lastChat.content ||
        lastThreadMsg.role !== "user"
      ) {
        messageHistory.push({
          role: "user",
          content: `[${user.name ?? "User"}]: ${lastChat.content}`,
        });
      }
    }
```

- [ ] **Step 4: Replace all `anthropic(HAIKU_MODEL)` with `getModel()`**

Find all occurrences of `anthropic(HAIKU_MODEL)` and replace:
- In `streamText` call: `model: getModel("chat")`
- In title `generateText` call: `model: getModel("summary")`

- [ ] **Step 5: Replace error logging**

Find `console.error("Chat API error:", message)` and replace with:

```typescript
    logAiError("chatApiRoute", error, { threadId });
```

- [ ] **Step 6: Verify build**

Run: `cd /Users/terrywang/Repos/prism && npm run build 2>&1 | tail -20`

Expected: Build succeeds. If there's an import issue with `convex/lib/models` from Next.js, create a thin re-export at `lib/models.ts` (app-side) or adjust the import path.

- [ ] **Step 7: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "refactor: migrate chat API route to centralized models and utilities"
```

---

## Phase 2: Chat Architecture

### Task 11: Create `convex/lib/chatTools.ts` — tool definitions

**Files:**
- Create: `convex/lib/chatTools.ts`

- [ ] **Step 1: Create the chat tools file**

Create `convex/lib/chatTools.ts`:

```typescript
import { tool } from "ai";
import { z } from "zod";

/**
 * Tool definitions for agentic chat.
 * These are AI SDK tool schemas — the execute functions are wired up
 * in the actions that use them (processThreadChat, chat route).
 */

export const lookupPolicy = tool({
  description:
    "Search for insurance policies by carrier name, policy number, policy type, or date range. Returns matching policy summaries.",
  parameters: z.object({
    query: z.string().describe("Search query — carrier name, policy number, or keywords"),
    policyType: z.string().optional().describe("Filter by policy type (e.g., general_liability, commercial_auto)"),
    carrier: z.string().optional().describe("Filter by carrier/insurer name"),
  }),
});

export const compareCoverages = tool({
  description:
    "Compare two policies side by side — coverage types, limits, deductibles, exclusions, and premium.",
  parameters: z.object({
    policyId1: z.string().describe("ID of the first policy to compare"),
    policyId2: z.string().describe("ID of the second policy to compare"),
  }),
});

export const sendEmail = tool({
  description:
    "Draft and send an email on behalf of the team. Respects the organization's email settings (auto-send vs draft-first).",
  parameters: z.object({
    to: z.string().describe("Recipient email address"),
    subject: z.string().describe("Email subject line"),
    body: z.string().describe("Email body content (plain text, will be formatted)"),
    cc: z.array(z.string()).optional().describe("CC email addresses"),
  }),
});

export const checkApplicationStatus = tool({
  description:
    "Look up the progress of an insurance application session — current status, filled fields, pending questions.",
  parameters: z.object({
    applicationId: z.string().optional().describe("Application session ID (if known)"),
    query: z.string().optional().describe("Search by application title or source file name"),
  }),
});

export const saveNote = tool({
  description:
    "Save an observation or note about a policy, quote, or the organization. Stored in org memory for future reference.",
  parameters: z.object({
    content: z.string().describe("The observation or note to save"),
    type: z.enum(["fact", "preference", "risk_note", "observation"]).describe("Type of memory"),
    policyId: z.string().optional().describe("Related policy ID (if applicable)"),
  }),
});

export const generateCoi = tool({
  description:
    "Generate a Certificate of Insurance (COI) PDF for a specific policy. Returns a download link.",
  parameters: z.object({
    policyId: z.string().describe("The policy ID to generate the COI for"),
    certificateHolder: z.string().optional().describe("Name/address of the certificate holder"),
  }),
});
```

- [ ] **Step 2: Commit**

```bash
git add convex/lib/chatTools.ts
git commit -m "feat: add AI tool definitions for agentic chat (lookup, compare, email, COI, etc.)"
```

---

### Task 12: Add tool execution to `processThreadChat.ts`

**Files:**
- Modify: `convex/actions/processThreadChat.ts`

- [ ] **Step 1: Add tool imports**

At the top of `processThreadChat.ts`, after the existing imports, add:

```typescript
import {
  lookupPolicy,
  compareCoverages,
  checkApplicationStatus,
  saveNote,
  generateCoi,
} from "../lib/chatTools";
```

- [ ] **Step 2: Add tool execution wrappers**

After the imports, before the `export const run = internalAction({` line, add:

```typescript
/** Build executable tools with Convex context for this action. */
function buildTools(ctx: any, args: { orgId: any; threadId: any }) {
  return {
    lookup_policy: {
      ...lookupPolicy,
      execute: async (params: { query: string; policyType?: string; carrier?: string }) => {
        const policies = await ctx.runQuery(
          internal.policies.listAllInternal,
          { orgId: args.orgId },
        );
        const q = params.query.toLowerCase();
        const matches = policies.filter((p: any) => {
          const matchesQuery =
            p.insuredName?.toLowerCase().includes(q) ||
            p.security?.toLowerCase().includes(q) ||
            p.policyNumber?.toLowerCase().includes(q) ||
            p.policyTypes?.some((t: string) => t.toLowerCase().includes(q));
          const matchesType = !params.policyType || p.policyTypes?.includes(params.policyType);
          const matchesCarrier = !params.carrier || p.security?.toLowerCase().includes(params.carrier.toLowerCase());
          return matchesQuery && matchesType && matchesCarrier;
        });
        if (matches.length === 0) return "No matching policies found.";
        return matches.slice(0, 5).map((p: any) => ({
          id: p._id,
          insured: p.insuredName,
          carrier: p.security,
          type: p.policyTypes?.join(", "),
          number: p.policyNumber,
          effective: p.effectiveDate,
          expiration: p.expirationDate,
          premium: p.premium,
        }));
      },
    },
    compare_coverages: {
      ...compareCoverages,
      execute: async (params: { policyId1: string; policyId2: string }) => {
        const [p1, p2] = await Promise.all([
          ctx.runQuery(internal.policies.getInternal, { id: params.policyId1 }),
          ctx.runQuery(internal.policies.getInternal, { id: params.policyId2 }),
        ]);
        if (!p1 || !p2) return "One or both policies not found.";
        return {
          policy1: { id: p1._id, carrier: p1.security, type: p1.policyTypes, limits: p1.limits, deductibles: p1.deductibles, premium: p1.premium },
          policy2: { id: p2._id, carrier: p2.security, type: p2.policyTypes, limits: p2.limits, deductibles: p2.deductibles, premium: p2.premium },
        };
      },
    },
    check_application_status: {
      ...checkApplicationStatus,
      execute: async (params: { applicationId?: string; query?: string }) => {
        const apps = await ctx.runQuery(
          internal.applicationSessions.listAllInternal,
          { orgId: args.orgId },
        );
        if (params.applicationId) {
          const match = apps.find((a: any) => a._id === params.applicationId);
          return match ?? "Application not found.";
        }
        if (params.query) {
          const q = params.query.toLowerCase();
          const matches = apps.filter((a: any) =>
            a.applicationTitle?.toLowerCase().includes(q) ||
            a.sourceFileName?.toLowerCase().includes(q),
          );
          return matches.length > 0 ? matches : "No matching applications found.";
        }
        return apps.slice(0, 5);
      },
    },
    save_note: {
      ...saveNote,
      execute: async (_params: { content: string; type: string; policyId?: string }) => {
        // Phase 3 will implement orgMemory — return placeholder for now
        return "Note saved. (Memory system will be available in a future update.)";
      },
    },
    generate_coi: {
      ...generateCoi,
      execute: async (_params: { policyId: string; certificateHolder?: string }) => {
        // Phase 4 will implement COI generation — return placeholder for now
        return "COI generation will be available in a future update.";
      },
    },
  };
}
```

- [ ] **Step 3: Add intent detection and tool routing**

In the `run` handler, find the `streamText` call (around the line with `const result = streamText({`). Replace the streaming block (from `let content = ""` through the final message update) with:

```typescript
      // Detect if user message needs tools (action keywords)
      const actionKeywords = /\b(look\s*up|find|search|compare|send\s*email|check\s*application|check\s*status|generate\s*coi|create\s*coi|save\s*note|remember)\b/i;
      const needsTools = actionKeywords.test(latestUserContent);

      let content: string;

      if (needsTools) {
        // Agentic mode — generateText with tools
        const { stepCountIs } = await import("ai");
        const tools = buildTools(ctx, { orgId: args.orgId, threadId: args.threadId });
        const { text } = await generateTextWithFallback({
          model: getModel("chat_with_tools"),
          maxOutputTokens: 2048,
          system: fullSystemPrompt,
          messages: messageHistory,
          tools,
          stopWhen: stepCountIs(5),
        });
        content = text;

        // Update message with final content
        await ctx.runMutation(internal.threads.updateAgentMessage, {
          id: agentMsgId,
          content,
          referencedPolicyIds: relevantPolicyIds.length > 0 ? relevantPolicyIds : undefined,
          referencedQuoteIds: relevantQuoteIds.length > 0 ? relevantQuoteIds : undefined,
        });
      } else {
        // Q&A mode — streamText for smooth UX
        content = "";
        let lastFlush = 0;
        const FLUSH_INTERVAL = 150;

        const result = streamText({
          model: getModel("chat"),
          maxOutputTokens: 2048,
          system: fullSystemPrompt,
          messages: messageHistory,
        });

        for await (const chunk of result.textStream) {
          content += chunk;
          const now = Date.now();
          if (now - lastFlush >= FLUSH_INTERVAL) {
            lastFlush = now;
            await ctx.runMutation(internal.threads.streamAgentMessage, {
              id: agentMsgId,
              content,
            });
          }
        }

        // Final update
        await ctx.runMutation(internal.threads.updateAgentMessage, {
          id: agentMsgId,
          content,
          referencedPolicyIds: relevantPolicyIds.length > 0 ? relevantPolicyIds : undefined,
          referencedQuoteIds: relevantQuoteIds.length > 0 ? relevantQuoteIds : undefined,
        });
      }

      await ctx.runMutation(internal.threads.touchThread, {
        threadId: args.threadId,
      });
```

Also add the import for `generateTextWithFallback`:

```typescript
import { getModel, generateTextWithFallback } from "../lib/models";
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/terrywang/Repos/prism && npx convex dev --typecheck=disable --once 2>&1 | tail -10`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add convex/actions/processThreadChat.ts
git commit -m "feat: add agentic tool use to chat with intent detection routing"
```

---

## Phase 3: Memory + Intelligence

### Task 13: Add `orgMemory` table to schema

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add orgMemory table definition**

In `convex/schema.ts`, after the `orgBusinessContext` table definition (after line 102), add:

```typescript
  // Org memory — persistent AI knowledge (facts, preferences, risk notes, observations)
  orgMemory: defineTable({
    orgId: v.id("organizations"),
    type: v.union(
      v.literal("fact"),
      v.literal("preference"),
      v.literal("risk_note"),
      v.literal("observation"),
    ),
    content: v.string(),
    source: v.union(
      v.literal("extraction"),
      v.literal("analysis"),
      v.literal("chat"),
      v.literal("email"),
    ),
    policyId: v.optional(v.id("policies")),
    quoteId: v.optional(v.id("policies")),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_type", ["orgId", "type"]),
```

- [ ] **Step 2: Add analysis fields to policies and organizations tables**

In `convex/schema.ts`, find the `organizations` table definition. Add before the closing `}).index(`:

```typescript
    portfolioAnalysis: v.optional(v.any()),
```

For the policies table, find the appropriate spot and add:

```typescript
    analysis: v.optional(v.any()),
```

- [ ] **Step 3: Push schema**

Run: `cd /Users/terrywang/Repos/prism && npx convex dev --typecheck=disable --once 2>&1 | tail -10`

Expected: Schema pushed successfully.

- [ ] **Step 4: Commit**

```bash
git add convex/schema.ts
git commit -m "feat: add orgMemory table and analysis fields to schema"
```

---

### Task 14: Create `convex/orgMemory.ts` — CRUD

**Files:**
- Create: `convex/orgMemory.ts`

- [ ] **Step 1: Create the orgMemory CRUD file**

Create `convex/orgMemory.ts`:

```typescript
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";

// ── Internal queries (for use by actions) ──

export const listByOrg = internalQuery({
  args: {
    orgId: v.id("organizations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const memories = await ctx.db
      .query("orgMemory")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    // Filter expired
    const now = Date.now();
    const active = memories.filter((m) => !m.expiresAt || m.expiresAt > now);
    // Sort by updatedAt descending
    active.sort((a, b) => b.updatedAt - a.updatedAt);
    return active.slice(0, args.limit || 50);
  },
});

export const listByType = internalQuery({
  args: {
    orgId: v.id("organizations"),
    type: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("orgMemory")
      .withIndex("by_org_type", (q) =>
        q.eq("orgId", args.orgId).eq("type", args.type as any),
      )
      .collect();
  },
});

// ── Internal mutations (for use by actions) ──

export const upsert = internalMutation({
  args: {
    orgId: v.id("organizations"),
    type: v.union(
      v.literal("fact"),
      v.literal("preference"),
      v.literal("risk_note"),
      v.literal("observation"),
    ),
    content: v.string(),
    source: v.union(
      v.literal("extraction"),
      v.literal("analysis"),
      v.literal("chat"),
      v.literal("email"),
    ),
    policyId: v.optional(v.id("policies")),
    quoteId: v.optional(v.id("policies")),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    // Dedup by content
    const existing = await ctx.db
      .query("orgMemory")
      .withIndex("by_org_type", (q) =>
        q.eq("orgId", args.orgId).eq("type", args.type),
      )
      .collect();
    const duplicate = existing.find((m) => m.content === args.content);
    if (duplicate) {
      await ctx.db.patch(duplicate._id, { updatedAt: now });
      return duplicate._id;
    }
    return await ctx.db.insert("orgMemory", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const bulkInsert = internalMutation({
  args: {
    items: v.array(
      v.object({
        orgId: v.id("organizations"),
        type: v.union(
          v.literal("fact"),
          v.literal("preference"),
          v.literal("risk_note"),
          v.literal("observation"),
        ),
        content: v.string(),
        source: v.union(
          v.literal("extraction"),
          v.literal("analysis"),
          v.literal("chat"),
          v.literal("email"),
        ),
        policyId: v.optional(v.id("policies")),
        quoteId: v.optional(v.id("policies")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const inserted: string[] = [];
    for (const item of args.items) {
      // Dedup check
      const existing = await ctx.db
        .query("orgMemory")
        .withIndex("by_org_type", (q) =>
          q.eq("orgId", item.orgId).eq("type", item.type),
        )
        .collect();
      if (existing.some((m) => m.content === item.content)) continue;
      const id = await ctx.db.insert("orgMemory", {
        ...item,
        createdAt: now,
        updatedAt: now,
      });
      inserted.push(id);
    }
    return inserted;
  },
});

export const deleteExpired = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const memories = await ctx.db
      .query("orgMemory")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    let cleaned = 0;
    for (const m of memories) {
      if (m.expiresAt && m.expiresAt <= now) {
        await ctx.db.delete(m._id);
        cleaned++;
      }
    }
    return cleaned;
  },
});

// ── Public query (for settings UI) ──

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!membership) return [];
    const memories = await ctx.db
      .query("orgMemory")
      .withIndex("by_org", (q) => q.eq("orgId", membership.orgId))
      .collect();
    const now = Date.now();
    return memories
      .filter((m) => !m.expiresAt || m.expiresAt > now)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add convex/orgMemory.ts
git commit -m "feat: add orgMemory CRUD with dedup, expiry, and bulk insert"
```

---

### Task 15: Create `convex/lib/orgMemoryContext.ts` and wire into chat

**Files:**
- Create: `convex/lib/orgMemoryContext.ts`
- Modify: `convex/actions/processThreadChat.ts`
- Modify: `convex/actions/mcpChat.ts`
- Modify: `app/api/chat/route.ts`

- [ ] **Step 1: Create the memory context builder**

Create `convex/lib/orgMemoryContext.ts`:

```typescript
/**
 * Format org memories into a context block for system prompts.
 * Groups by type with human-readable labels.
 */
export function buildMemoryContext(
  memories: Array<{
    type: string;
    content: string;
    source: string;
    updatedAt: number;
  }>,
): string {
  if (!memories || memories.length === 0) return "";

  const grouped: Record<string, string[]> = {};
  for (const m of memories) {
    if (!grouped[m.type]) grouped[m.type] = [];
    grouped[m.type].push(m.content);
  }

  const typeLabels: Record<string, string> = {
    fact: "Known facts",
    preference: "Client preferences",
    risk_note: "Risk observations",
    observation: "General observations",
  };

  const sections: string[] = [];
  for (const [type, items] of Object.entries(grouped)) {
    const label = typeLabels[type] || type;
    sections.push(`${label}:\n${items.map((i) => `- ${i}`).join("\n")}`);
  }

  return `\n\nORG KNOWLEDGE:\n${sections.join("\n\n")}`;
}
```

- [ ] **Step 2: Wire org memory into processThreadChat.ts**

In `convex/actions/processThreadChat.ts`, after the cross-thread memory context loading block (where `memoryContext` is set), add:

```typescript
      // Load org memory
      const orgMemories = await ctx.runQuery(
        internal.orgMemory.listByOrg,
        { orgId: args.orgId, limit: 30 },
      );
```

Add the import at the top:

```typescript
import { buildMemoryContext } from "../lib/orgMemoryContext";
```

Then where `fullSystemPrompt` is assembled, add the org memory context:

```typescript
      const orgMemoryBlock = buildMemoryContext(orgMemories);
```

And include it in the concatenation:

```typescript
      const fullSystemPrompt =
        systemPrompt +
        webChatAddendum +
        pageContextBlock +
        "\n\n" +
        docContext +
        applicationContext +
        memoryContext +
        orgMemoryBlock;
```

- [ ] **Step 3: Wire org memory into mcpChat.ts**

Apply the same pattern to `convex/actions/mcpChat.ts`:

Add import:
```typescript
import { buildMemoryContext } from "../lib/orgMemoryContext";
```

After loading past conversations (around line 85), add:
```typescript
    const orgMemories = await ctx.runQuery(
      internal.orgMemory.listByOrg,
      { orgId: args.orgId, limit: 30 },
    );
    const orgMemoryBlock = buildMemoryContext(orgMemories);
```

Include in the fullSystemPrompt concatenation:
```typescript
    const fullSystemPrompt =
      systemPrompt +
      mcpAddendum +
      "\n\n" +
      docContext +
      applicationContext +
      memoryContext +
      orgMemoryBlock;
```

- [ ] **Step 4: Wire org memory into app/api/chat/route.ts**

In `app/api/chat/route.ts`, the web chat route doesn't have access to internal queries directly (it uses the Convex HTTP client with public queries). Add a public query to `orgMemory.ts` that can be called from the API route, then load it alongside the other parallel queries:

After the parallel data load:
```typescript
    const [policies, quotes, threadMessages] = await Promise.all([...]);
```

Add below:
```typescript
    // Load org memory (uses public query, scoped to viewer's org)
    let orgMemoryBlock = "";
    try {
      const memories = await convex.query(api.orgMemory.list, {});
      if (memories.length > 0) {
        const grouped: Record<string, string[]> = {};
        for (const m of memories) {
          if (!grouped[m.type]) grouped[m.type] = [];
          grouped[m.type].push(m.content);
        }
        const typeLabels: Record<string, string> = {
          fact: "Known facts",
          preference: "Client preferences",
          risk_note: "Risk observations",
          observation: "General observations",
        };
        const sections: string[] = [];
        for (const [type, items] of Object.entries(grouped)) {
          const label = typeLabels[type] || type;
          sections.push(`${label}:\n${items.map((i: string) => `- ${i}`).join("\n")}`);
        }
        orgMemoryBlock = `\n\nORG KNOWLEDGE:\n${sections.join("\n\n")}`;
      }
    } catch {
      // Non-critical — proceed without memory
    }
```

Include in fullSystemPrompt:
```typescript
    const fullSystemPrompt =
      systemPrompt + webChatAddendum + pageContextBlock + "\n\n" + docContext + orgMemoryBlock;
```

- [ ] **Step 5: Verify build**

Run: `cd /Users/terrywang/Repos/prism && npm run build 2>&1 | tail -20`

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add convex/lib/orgMemoryContext.ts convex/actions/processThreadChat.ts convex/actions/mcpChat.ts app/api/chat/route.ts
git commit -m "feat: wire org memory into all chat pathways (web, thread, MCP)"
```

---

### Task 16: Create `convex/actions/proactiveAnalysis.ts`

**Files:**
- Create: `convex/actions/proactiveAnalysis.ts`

- [ ] **Step 1: Create the proactive analysis actions**

Create `convex/actions/proactiveAnalysis.ts`:

```typescript
"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getModel, generateTextWithFallback } from "../lib/models";
import { logAiError } from "../lib/aiUtils";
import { buildMemoryContext } from "../lib/orgMemoryContext";

// Commercial lines analysis guidance
const POLICY_TYPE_GUIDANCE: Record<string, string> = {
  general_liability: `GL policy analysis:
- Per-occurrence vs aggregate limits — check if aggregate is at least 2x per-occurrence
- Products/completed operations — should have separate aggregate
- Defense cost treatment: inside vs outside limits (outside is better)
- Additional insured provisions and blanket endorsements
- Contractual liability coverage — verify inclusion
- Personal and advertising injury — check sublimits`,

  workers_comp: `Workers' Compensation analysis:
- Experience modification rate — below 1.0 is favorable
- Employer's liability limits — standard is $100K/$500K/$100K, recommend $1M
- State-specific requirements — verify compliance
- Voluntary compensation endorsement if needed
- USL&H / Jones Act coverage if maritime exposure
- Stop-gap coverage in monopolistic states`,

  commercial_property: `Commercial Property analysis:
- Coinsurance adequacy — 80% or 90% clause, verify insured values
- Business income / extra expense — adequate period of indemnity (12+ months)
- Equipment breakdown — increasingly critical, check inclusion
- Flood/earthquake sublimits if applicable
- Replacement cost vs ACV — replacement cost preferred
- Ordinance or law coverage for older buildings`,

  professional_liability: `Professional Liability analysis:
- Claims-made vs occurrence — claims-made needs retroactive date review
- Extended reporting period (tail) options and cost
- Prior acts coverage — retroactive date should cover full practice history
- Definition of "professional services" — ensure it covers all activities
- Defense cost treatment and settlement consent clause`,

  cyber: `Cyber Liability analysis:
- First-party vs third-party coverage scope
- Sublimits on specific coverages (ransomware, business interruption, notification)
- Social engineering / funds transfer fraud coverage
- Retroactive date for claims-made trigger
- Regulatory proceedings and PCI fines coverage
- Waiting period / retention for business interruption`,

  commercial_auto: `Commercial Auto analysis:
- Combined single limit vs split limits — CSL is simpler
- Hired and non-owned auto — essential for businesses using employee vehicles
- Motor carrier filing if applicable (MCS-90)
- Uninsured/underinsured motorist — match liability limits
- Cargo coverage if hauling goods`,

  umbrella: `Umbrella/Excess analysis:
- Following form vs stand-alone — following form is broader
- Drop-down provision when underlying is exhausted
- Self-insured retention for claims not covered by underlying
- Scheduling all underlying policies — verify no gaps
- Defense obligation — duty to defend vs indemnity only`,

  directors_officers: `D&O analysis:
- Side A (individual directors) — most critical
- Side B (company reimbursement) and Side C (entity coverage)
- Insured vs Insured exclusion — watch for overly broad version
- Prior acts coverage and retroactive date
- Securities claim definition breadth`,
};

function getGuidance(policyTypes?: string[]): string {
  if (!policyTypes?.length) return "General commercial insurance — check for adequate limits, reasonable deductibles, and notable exclusions.";
  const sections: string[] = [];
  for (const pt of policyTypes) {
    if (POLICY_TYPE_GUIDANCE[pt]) {
      sections.push(POLICY_TYPE_GUIDANCE[pt]);
    }
  }
  return sections.length > 0
    ? sections.join("\n\n")
    : "General commercial insurance — check for adequate limits, reasonable deductibles, and notable exclusions.";
}

/** Tier 1: Post-extraction policy health check */
export const analyzePolicy = internalAction({
  args: {
    policyId: v.id("policies"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    try {
      const [policy, orgMemories] = await Promise.all([
        ctx.runQuery(internal.policies.getInternal, { id: args.policyId }),
        ctx.runQuery(internal.orgMemory.listByOrg, { orgId: args.orgId, limit: 20 }),
      ]);

      if (!policy || policy.status !== "ready") return;
      if (policy.analysis) return; // already analyzed

      const guidance = getGuidance(policy.policyTypes);
      const memoryBlock = buildMemoryContext(orgMemories);

      const prompt = `Analyze this insurance policy and provide a structured health check.

${guidance}

Policy data:
- Insured: ${policy.insuredName}
- Carrier: ${policy.security}
- Type: ${policy.policyTypes?.join(", ")}
- Policy Number: ${policy.policyNumber}
- Effective: ${policy.effectiveDate} to ${policy.expirationDate}
- Premium: ${policy.premium}
- Limits: ${JSON.stringify(policy.limits ?? {})}
- Deductibles: ${JSON.stringify(policy.deductibles ?? {})}
- Summary: ${policy.summary ?? "N/A"}
${memoryBlock}

Respond with a JSON object:
{
  "overallScore": "good" | "adequate" | "needs_attention" | "concerning",
  "strengths": ["...", "..."],
  "gaps": ["...", "..."],
  "recommendations": ["...", "..."],
  "limitAssessment": "brief assessment of limit adequacy",
  "deductibleAssessment": "brief assessment of deductible levels",
  "notableExclusions": ["...", "..."]
}`;

      const { text } = await generateTextWithFallback({
        model: getModel("analysis"),
        maxOutputTokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      // Parse the analysis
      let analysis;
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: text };
      } catch {
        analysis = { raw: text };
      }

      // Save analysis to policy
      await ctx.runMutation(internal.policies.updateAnalysis, {
        id: args.policyId,
        analysis,
      });

      // Save key facts to org memory
      const facts: Array<{ content: string; type: "fact" | "risk_note" }> = [];
      if (analysis.gaps?.length) {
        for (const gap of analysis.gaps.slice(0, 3)) {
          facts.push({ content: `Coverage gap (${policy.security} ${policy.policyTypes?.[0]}): ${gap}`, type: "risk_note" });
        }
      }
      if (analysis.strengths?.length) {
        facts.push({ content: `${policy.security} ${policy.policyTypes?.[0]}: ${analysis.overallScore} — ${analysis.strengths[0]}`, type: "fact" });
      }

      if (facts.length > 0) {
        await ctx.runMutation(internal.orgMemory.bulkInsert, {
          items: facts.map((f) => ({
            orgId: args.orgId,
            type: f.type,
            content: f.content,
            source: "analysis" as const,
            policyId: args.policyId,
          })),
        });
      }
    } catch (err) {
      logAiError("analyzePolicy", err, { policyId: args.policyId });
    }
  },
});

/** Tier 2: Cross-policy portfolio analysis */
export const analyzePortfolio = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    try {
      const [policies, org, orgMemories] = await Promise.all([
        ctx.runQuery(internal.policies.listAllInternal, { orgId: args.orgId }),
        ctx.runQuery(internal.orgs.getInternal, { id: args.orgId }),
        ctx.runQuery(internal.orgMemory.listByOrg, { orgId: args.orgId, limit: 30 }),
      ]);

      if (policies.length < 2) return; // need at least 2 policies
      if (org?.portfolioAnalysis) return; // already analyzed

      const memoryBlock = buildMemoryContext(orgMemories);

      const policySummaries = policies.map((p: any) => ({
        carrier: p.security,
        type: p.policyTypes?.join(", "),
        limits: p.limits,
        premium: p.premium,
        effective: p.effectiveDate,
        expiration: p.expirationDate,
      }));

      const prompt = `Analyze this insurance portfolio for ${org?.name ?? "this organization"}.

Policies (${policies.length}):
${JSON.stringify(policySummaries, null, 2)}
${memoryBlock}

Provide a portfolio-level assessment as JSON:
{
  "overallHealth": "strong" | "adequate" | "gaps_identified" | "needs_review",
  "coverageGaps": ["missing coverage types or inadequate limits"],
  "overlaps": ["areas where coverage overlaps across policies"],
  "recommendations": ["actionable recommendations"],
  "totalPremium": number,
  "keyRisks": ["top risks not adequately addressed"]
}`;

      const { text } = await generateTextWithFallback({
        model: getModel("analysis"),
        maxOutputTokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      let analysis;
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: text };
      } catch {
        analysis = { raw: text };
      }

      await ctx.runMutation(internal.orgs.updatePortfolioAnalysis, {
        id: args.orgId,
        portfolioAnalysis: analysis,
      });
    } catch (err) {
      logAiError("analyzePortfolio", err, { orgId: args.orgId });
    }
  },
});

/** Tier 3: Renewal comparison */
export const compareRenewal = internalAction({
  args: {
    newPolicyId: v.id("policies"),
    priorPolicyId: v.id("policies"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    try {
      const [newPolicy, priorPolicy] = await Promise.all([
        ctx.runQuery(internal.policies.getInternal, { id: args.newPolicyId }),
        ctx.runQuery(internal.policies.getInternal, { id: args.priorPolicyId }),
      ]);

      if (!newPolicy || !priorPolicy) return;

      const prompt = `Compare this insurance policy renewal:

PRIOR POLICY:
- Carrier: ${priorPolicy.security}
- Type: ${priorPolicy.policyTypes?.join(", ")}
- Premium: ${priorPolicy.premium}
- Limits: ${JSON.stringify(priorPolicy.limits ?? {})}
- Deductibles: ${JSON.stringify(priorPolicy.deductibles ?? {})}
- Period: ${priorPolicy.effectiveDate} to ${priorPolicy.expirationDate}

RENEWAL POLICY:
- Carrier: ${newPolicy.security}
- Type: ${newPolicy.policyTypes?.join(", ")}
- Premium: ${newPolicy.premium}
- Limits: ${JSON.stringify(newPolicy.limits ?? {})}
- Deductibles: ${JSON.stringify(newPolicy.deductibles ?? {})}
- Period: ${newPolicy.effectiveDate} to ${newPolicy.expirationDate}

Provide a comparison as JSON:
{
  "premiumChange": { "amount": number, "percentage": number, "direction": "increase" | "decrease" | "unchanged" },
  "limitChanges": ["description of each limit change"],
  "deductibleChanges": ["description of each deductible change"],
  "coverageChanges": ["added or removed coverages"],
  "overallAssessment": "brief overall assessment",
  "actionItems": ["things the broker should review or discuss with the client"]
}`;

      const { text } = await generateTextWithFallback({
        model: getModel("analysis"),
        maxOutputTokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      let comparison;
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        comparison = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: text };
      } catch {
        comparison = { raw: text };
      }

      // Save as org memory
      const summaryNote = `Renewal comparison: ${newPolicy.security} ${newPolicy.policyTypes?.[0]} — ${comparison.overallAssessment ?? "see details"}`;
      await ctx.runMutation(internal.orgMemory.upsert, {
        orgId: args.orgId,
        type: "observation",
        content: summaryNote,
        source: "analysis",
        policyId: args.newPolicyId,
      });
    } catch (err) {
      logAiError("compareRenewal", err, {
        newPolicyId: args.newPolicyId,
        priorPolicyId: args.priorPolicyId,
      });
    }
  },
});
```

- [ ] **Step 2: Add `updateAnalysis` mutation to policies**

In `convex/policies.ts`, add an internal mutation:

```typescript
export const updateAnalysis = internalMutation({
  args: {
    id: v.id("policies"),
    analysis: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { analysis: args.analysis });
  },
});
```

- [ ] **Step 3: Add `updatePortfolioAnalysis` mutation to orgs**

In `convex/orgs.ts`, add an internal mutation:

```typescript
export const updatePortfolioAnalysis = internalMutation({
  args: {
    id: v.id("organizations"),
    portfolioAnalysis: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { portfolioAnalysis: args.portfolioAnalysis });
  },
});
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/terrywang/Repos/prism && npx convex dev --typecheck=disable --once 2>&1 | tail -10`

Expected: Pushed successfully.

- [ ] **Step 5: Commit**

```bash
git add convex/actions/proactiveAnalysis.ts convex/policies.ts convex/orgs.ts
git commit -m "feat: add proactive analysis — policy health check, portfolio analysis, renewal comparison"
```

---

### Task 17: Trigger analysis after policy extraction

**Files:**
- Modify: `convex/actions/extractPolicy.ts`

- [ ] **Step 1: Schedule analysis after successful extraction**

In `convex/actions/extractPolicy.ts`, find the successful extraction completion point (where the policy status is set to "ready" after extraction succeeds). After that point, add:

```typescript
      // Schedule proactive analysis
      if (args.orgId) {
        await ctx.scheduler.runAfter(
          0,
          internal.actions.proactiveAnalysis.analyzePolicy,
          { policyId: /* the policy ID */, orgId: args.orgId },
        );

        // Also check if portfolio analysis should run
        const orgPolicies = await ctx.runQuery(
          internal.policies.listAllInternal,
          { orgId: args.orgId },
        );
        if (orgPolicies.length >= 2) {
          await ctx.scheduler.runAfter(
            5000, // 5s delay to let the policy analysis complete first
            internal.actions.proactiveAnalysis.analyzePortfolio,
            { orgId: args.orgId },
          );
        }
      }
```

Adapt the variable names to match the actual code in `extractPolicy.ts`. The policy ID and org ID will be available in the handler context.

- [ ] **Step 2: Schedule renewal comparison when priorPolicyNumber matches**

After the analysis scheduling, add:

```typescript
      // Check for renewal match
      if (args.orgId && /* the extracted policy has priorPolicyNumber */) {
        const orgPolicies = await ctx.runQuery(
          internal.policies.listAllInternal,
          { orgId: args.orgId },
        );
        const priorMatch = orgPolicies.find(
          (p: any) => p.policyNumber === /* priorPolicyNumber */ && p._id !== /* this policyId */,
        );
        if (priorMatch) {
          await ctx.scheduler.runAfter(
            0,
            internal.actions.proactiveAnalysis.compareRenewal,
            {
              newPolicyId: /* this policyId */,
              priorPolicyId: priorMatch._id,
              orgId: args.orgId,
            },
          );
        }
      }
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/terrywang/Repos/prism && npx convex dev --typecheck=disable --once 2>&1 | tail -10`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add convex/actions/extractPolicy.ts
git commit -m "feat: trigger proactive analysis after policy extraction"
```

---

## Phase 4: Email + COI

### Task 18: Create `convex/actions/generateEmailBody.ts`

**Files:**
- Create: `convex/actions/generateEmailBody.ts`

- [ ] **Step 1: Create the email body generation action**

Create `convex/actions/generateEmailBody.ts`:

```typescript
"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getModel, generateTextWithFallback } from "../lib/models";
import { buildMemoryContext } from "../lib/orgMemoryContext";
import { logAiError } from "../lib/aiUtils";

/**
 * AI-generated email body. Replaces fixed inline body construction
 * with context-aware, natural email writing.
 */
export const run = internalAction({
  args: {
    orgId: v.id("organizations"),
    intent: v.string(),
    policyContext: v.optional(v.any()),
    recipientContext: v.optional(v.string()),
    tone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ subject: string; body: string }> => {
    const [org, orgMemories] = await Promise.all([
      ctx.runQuery(internal.orgs.getInternal, { id: args.orgId }),
      ctx.runQuery(internal.orgMemory.listByOrg, { orgId: args.orgId, limit: 20 }),
    ]);

    if (!org) throw new Error("Organization not found");

    const memoryBlock = buildMemoryContext(orgMemories);
    const tone = args.tone ?? "professional";

    const prompt = `Write an email for a commercial insurance context.

Organization: ${org.name}
Industry: ${org.industry ?? "N/A"}
Broker: ${org.insuranceBroker ?? "N/A"} (Contact: ${org.brokerContactName ?? "N/A"})
Tone: ${tone}

Intent: ${args.intent}

${args.recipientContext ? `Recipient context: ${args.recipientContext}` : ""}
${args.policyContext ? `Policy context:\n${JSON.stringify(args.policyContext, null, 2)}` : ""}
${memoryBlock}

Write the email as Prism on behalf of ${org.name}. Be professional and concise.
Do NOT include a sign-off — the "sent with Prism" signature is added automatically.

Respond with JSON:
{
  "subject": "email subject line",
  "body": "email body text"
}`;

    try {
      const { text } = await generateTextWithFallback({
        model: getModel("email_draft"),
        maxOutputTokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          subject: parsed.subject ?? "Update from Prism",
          body: parsed.body ?? text,
        };
      }
      return { subject: "Update from Prism", body: text };
    } catch (err) {
      logAiError("generateEmailBody", err, { orgId: args.orgId });
      throw err;
    }
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add convex/actions/generateEmailBody.ts
git commit -m "feat: add AI email body generation action"
```

---

### Task 19: Create `convex/lib/coiGenerator.ts`

**Files:**
- Create: `convex/lib/coiGenerator.ts`

- [ ] **Step 1: Create the COI generator**

Create `convex/lib/coiGenerator.ts`:

```typescript
import PDFDocument from "pdfkit";

/**
 * COI data interface — maps from Prism's rich policy fields
 * to ACORD 25-style COI layout.
 */
export interface CoiData {
  // Producer (Broker)
  producerName: string;
  producerAgency?: string;
  producerContact?: string;
  producerLicense?: string;
  producerAddress?: string;
  producerPhone?: string;
  producerEmail?: string;

  // Insured
  insuredName: string;
  insuredDba?: string;
  insuredAddress?: string;
  insuredFein?: string;

  // Insurer
  insurerName: string;
  insurerNaic?: string;
  insurerAmBest?: string;
  insurerAdmitted?: string;

  // Policy
  policyNumber: string;
  policyType: string;
  effectiveDate: string;
  expirationDate: string;

  // Limits (key-value pairs)
  limits: Record<string, string>;

  // Optional
  certificateHolder?: string;
  description?: string;
}

/**
 * Map a Prism policy document to CoiData.
 */
export function policyToCoiData(policy: any, org?: any): CoiData {
  return {
    producerName: org?.brokerContactName ?? policy.brokerContactName ?? "N/A",
    producerAgency: org?.insuranceBroker ?? policy.brokerAgency ?? policy.broker,
    producerContact: org?.brokerContactName ?? policy.brokerContactName,
    producerLicense: policy.brokerLicenseNumber,
    producerEmail: org?.brokerContactEmail ?? policy.brokerContactEmail,
    insuredName: policy.insuredName ?? "N/A",
    insuredDba: policy.insuredDba,
    insuredAddress: policy.insuredAddress,
    insuredFein: policy.insuredFein,
    insurerName: policy.carrierLegalName ?? policy.security ?? "N/A",
    insurerNaic: policy.carrierNaicNumber,
    insurerAmBest: policy.carrierAmBestRating,
    insurerAdmitted: policy.carrierAdmittedStatus,
    policyNumber: policy.policyNumber ?? "N/A",
    policyType: policy.policyTypes?.join(", ") ?? "N/A",
    effectiveDate: policy.effectiveDate ?? "N/A",
    expirationDate: policy.expirationDate ?? "N/A",
    limits: flattenLimits(policy.limits),
  };
}

function flattenLimits(limits: any): Record<string, string> {
  if (!limits) return {};
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(limits)) {
    if (value != null && value !== "") {
      flat[key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim()] =
        String(value);
    }
  }
  return flat;
}

/**
 * Generate a COI PDF using pdfkit.
 * Returns a Buffer of the PDF.
 */
export async function generateCoiPdf(data: CoiData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const blue = "#1a365d";
    const gray = "#666666";
    const lightGray = "#f5f5f5";

    // Header
    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .fillColor(blue)
      .text("CERTIFICATE OF LIABILITY INSURANCE", { align: "center" });
    doc.moveDown(0.5);
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(gray)
      .text(`DATE (MM/DD/YYYY): ${new Date().toLocaleDateString("en-US")}`, { align: "right" });
    doc.moveDown(1);

    // Producer section
    sectionHeader(doc, "PRODUCER");
    doc.font("Helvetica-Bold").fontSize(10).fillColor("black");
    if (data.producerAgency) doc.text(data.producerAgency);
    doc.font("Helvetica").fontSize(9).fillColor(gray);
    if (data.producerContact) doc.text(`Contact: ${data.producerContact}`);
    if (data.producerLicense) doc.text(`License: ${data.producerLicense}`);
    if (data.producerEmail) doc.text(`Email: ${data.producerEmail}`);
    doc.moveDown(0.5);

    // Insured section
    sectionHeader(doc, "INSURED");
    doc.font("Helvetica-Bold").fontSize(10).fillColor("black");
    doc.text(data.insuredName);
    doc.font("Helvetica").fontSize(9).fillColor(gray);
    if (data.insuredDba) doc.text(`DBA: ${data.insuredDba}`);
    if (data.insuredAddress) doc.text(data.insuredAddress);
    if (data.insuredFein) doc.text(`FEIN: ${data.insuredFein}`);
    doc.moveDown(0.5);

    // Insurer section
    sectionHeader(doc, "INSURER");
    doc.font("Helvetica-Bold").fontSize(10).fillColor("black");
    doc.text(data.insurerName);
    doc.font("Helvetica").fontSize(9).fillColor(gray);
    if (data.insurerNaic) doc.text(`NAIC #: ${data.insurerNaic}`);
    if (data.insurerAmBest) doc.text(`A.M. Best: ${data.insurerAmBest}`);
    if (data.insurerAdmitted) doc.text(`Status: ${data.insurerAdmitted}`);
    doc.moveDown(0.5);

    // Coverage section
    sectionHeader(doc, "COVERAGES");
    doc.font("Helvetica").fontSize(9).fillColor("black");
    doc.text(`Type: ${data.policyType}`);
    doc.text(`Policy Number: ${data.policyNumber}`);
    doc.text(`Effective: ${data.effectiveDate} — Expiration: ${data.expirationDate}`);
    doc.moveDown(0.5);

    // Limits table
    if (Object.keys(data.limits).length > 0) {
      sectionHeader(doc, "LIMITS");
      for (const [key, value] of Object.entries(data.limits)) {
        doc.font("Helvetica").fontSize(9);
        doc.fillColor(gray).text(key, 50, doc.y, { continued: true, width: 250 });
        doc.fillColor("black").text(`  ${value}`, { align: "right" });
      }
      doc.moveDown(0.5);
    }

    // Certificate holder
    if (data.certificateHolder) {
      sectionHeader(doc, "CERTIFICATE HOLDER");
      doc.font("Helvetica").fontSize(9).fillColor("black").text(data.certificateHolder);
      doc.moveDown(0.5);
    }

    // Description
    if (data.description) {
      sectionHeader(doc, "DESCRIPTION OF OPERATIONS");
      doc.font("Helvetica").fontSize(8).fillColor(gray).text(data.description);
    }

    // Footer
    doc.moveDown(2);
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor(gray)
      .text(
        "THIS CERTIFICATE IS ISSUED AS A MATTER OF INFORMATION ONLY AND CONFERS NO RIGHTS UPON THE CERTIFICATE HOLDER.",
        { align: "center" },
      );
    doc.text("Generated by Prism — claritylabs.inc", { align: "center" });

    doc.end();
  });
}

function sectionHeader(doc: PDFKit.PDFDocument, title: string) {
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor("#1a365d")
    .text(title)
    .moveTo(50, doc.y)
    .lineTo(562, doc.y)
    .strokeColor("#cccccc")
    .stroke();
  doc.moveDown(0.3);
}
```

- [ ] **Step 2: Commit**

```bash
git add convex/lib/coiGenerator.ts
git commit -m "feat: add COI PDF generator with ACORD-style layout"
```

---

### Task 20: Wire COI generation as a Convex action

**Files:**
- Create: `convex/actions/generateCoi.ts`

- [ ] **Step 1: Create the COI generation action**

Create `convex/actions/generateCoi.ts`:

```typescript
"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateCoiPdf, policyToCoiData } from "../lib/coiGenerator";
import { logAiError } from "../lib/aiUtils";

/**
 * Generate a COI PDF for a policy and store it in file storage.
 * Returns the storage ID for download.
 */
export const run = internalAction({
  args: {
    policyId: v.id("policies"),
    orgId: v.id("organizations"),
    certificateHolder: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string | null> => {
    try {
      const [policy, org] = await Promise.all([
        ctx.runQuery(internal.policies.getInternal, { id: args.policyId }),
        ctx.runQuery(internal.orgs.getInternal, { id: args.orgId }),
      ]);

      if (!policy) throw new Error("Policy not found");

      const coiData = policyToCoiData(policy, org);
      if (args.certificateHolder) {
        coiData.certificateHolder = args.certificateHolder;
      }

      const pdfBuffer = await generateCoiPdf(coiData);

      // Store in Convex file storage
      const blob = new Blob([pdfBuffer], { type: "application/pdf" });
      const storageId = await ctx.storage.store(blob);

      return storageId as string;
    } catch (err) {
      logAiError("generateCoi", err, { policyId: args.policyId });
      return null;
    }
  },
});
```

- [ ] **Step 2: Update the `generate_coi` tool in chatTools to reference this action**

In `convex/actions/processThreadChat.ts`, find the `generate_coi` tool in `buildTools`. Update its execute function:

```typescript
    generate_coi: {
      ...generateCoi,
      execute: async (params: { policyId: string; certificateHolder?: string }) => {
        try {
          const storageId = await ctx.scheduler.runAfter(
            0,
            internal.actions.generateCoi.run,
            {
              policyId: params.policyId as any,
              orgId: args.orgId,
              certificateHolder: params.certificateHolder,
            },
          );
          return `COI generation started. It will be available for download shortly.`;
        } catch (err) {
          return `Failed to generate COI: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
```

- [ ] **Step 3: Also update the `save_note` tool to use orgMemory (now that Phase 3 is done)**

```typescript
    save_note: {
      ...saveNote,
      execute: async (params: { content: string; type: string; policyId?: string }) => {
        await ctx.runMutation(internal.orgMemory.upsert, {
          orgId: args.orgId,
          type: params.type as any,
          content: params.content,
          source: "chat",
          policyId: params.policyId as any,
        });
        return "Note saved to organization memory.";
      },
    },
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/terrywang/Repos/prism && npx convex dev --typecheck=disable --once 2>&1 | tail -10`

Expected: Pushed successfully.

- [ ] **Step 5: Commit**

```bash
git add convex/actions/generateCoi.ts convex/actions/processThreadChat.ts
git commit -m "feat: add COI generation action and wire save_note/generate_coi tools"
```

---

### Task 21: Final verification and AGENTS.md update

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Run full build**

Run: `cd /Users/terrywang/Repos/prism && npm run build 2>&1 | tail -30`

Expected: Build succeeds.

- [ ] **Step 2: Run Convex push**

Run: `cd /Users/terrywang/Repos/prism && npx convex dev --typecheck=disable --once 2>&1 | tail -10`

Expected: All functions and schema pushed.

- [ ] **Step 3: Run lint**

Run: `cd /Users/terrywang/Repos/prism && npm run lint 2>&1 | tail -20`

Expected: No critical errors (warnings are OK).

- [ ] **Step 4: Update AGENTS.md with new architecture**

Add or update these sections in `AGENTS.md`:

Under "### Key Backend Files (convex/)":
```
- `lib/models.ts` — Multi-model architecture: task-based model routing with DeepSeek, Kimi, Claude + automatic fallback
- `lib/aiUtils.ts` — Centralized AI utilities: markdown processing, email signatures, message history, system prompt building, structured error logging
- `lib/chatTools.ts` — AI SDK tool definitions for agentic chat (lookup_policy, compare_coverages, send_email, check_application, save_note, generate_coi)
- `lib/orgMemoryContext.ts` — Org memory context builder for system prompts
- `lib/coiGenerator.ts` — COI PDF generator (ACORD-style layout using pdfkit)
- `orgMemory.ts` — Org memory CRUD (facts, preferences, risk notes, observations) with dedup and expiry
- `actions/proactiveAnalysis.ts` — Post-extraction policy health check, portfolio analysis, renewal comparison
- `actions/generateEmailBody.ts` — AI-generated email content
- `actions/generateCoi.ts` — COI generation action (stores PDF in file storage)
```

Under "### Data Flow":
Add a new section:
```
### Data Flow — Proactive Intelligence

1. Policy extracted successfully → `analyzePolicy` scheduled (uses `getModel("analysis")`)
2. Analysis produces structured health check (score, gaps, recommendations) → stored on `policies.analysis`
3. Key facts/risk notes saved to `orgMemory` table
4. If org has 2+ policies → `analyzePortfolio` scheduled (5s delay)
5. Portfolio analysis identifies cross-policy gaps → stored on `organizations.portfolioAnalysis`
6. If `priorPolicyNumber` matches existing policy → `compareRenewal` scheduled
7. All analysis uses `generateTextWithFallback` for automatic model fallback
```

Under "### Schema Notes":
Add:
```
- `orgMemory` stores org-scoped AI knowledge (facts, preferences, risk_notes, observations) with source tracking and optional expiry
- `policies.analysis` stores AI-generated health check (structured JSON)
- `organizations.portfolioAnalysis` stores cross-policy analysis
- `applicationSessions.status` includes `"failed"` for timeout/error cases, with `failureReason` field
- `applicationSessions.lastProgressAt` tracks when status last changed (for stale detection)
```

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md with new AI architecture, models, tools, and memory system"
```
