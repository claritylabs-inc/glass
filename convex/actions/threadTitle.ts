"use node";

import { v } from "convex/values";
import { z } from "zod";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateObjectForOrg } from "../lib/models";
import { logAiError } from "../lib/aiUtils";
import { tokenizeSearchText } from "../lib/searchTokenizer";

export const TITLE_SYSTEM_PROMPT = `You are a thread title generator for an insurance work assistant.

Given the initial user request and any starting page context, output a short title that captures the user's actual work intent.

Rules:
- Return the title field only. Do not include analysis or explanation.
- Do not output analysis, reasoning, steps, headings, lists, or Markdown.
- Use title case.
- Use 2-4 words.
- Never begin with conversational framing such as "Can you", "Could you", "I need", or "Please".
- Prefer the action and deliverable/topic over contact names or email addresses.
- Use starting page context to disambiguate generic requests like "send this", "summarize this", or "what about exclusions?"
- Never include raw email addresses, email domains, usernames, file IDs, generated IDs, or local-part fragments.
- For certificate of insurance work, use a compact action title such as "Generate COI", "Update COI", "Draft COI", or "Send COI".
- Good examples: "Generate COI", "Send COI", "GL Coverage Limits", "Cyber Liability Policy", "Endorsement Follow Up", "Renewal Timeline".`;

const ThreadTitleOutputSchema = z.object({
  title: z.string().min(1).max(80),
});

type TitleContext = {
  userMessage: string;
  initialContext?: {
    pageType: string;
    entityId?: string;
    summary?: string;
  };
  attachments?: Array<{
    filename: string;
    contentType?: string;
  }>;
  assistantReply?: string;
};

function stripStructuredTitleNoise(input: string): string {
  return input
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/https?:\/\/\S+/giu, " ");
}

export function normalizeGeneratedTitle(raw: string): string | null {
  const trimmedRaw = raw.normalize("NFC").trim();
  if (
    !trimmedRaw ||
    trimmedRaw.includes("\n") ||
    /[\p{Cc}\p{Cf}]/u.test(trimmedRaw) ||
    /[*_`#>]/.test(trimmedRaw) ||
    /^\s*(?:[-+]\s|\d+[.)]\s)/.test(trimmedRaw) ||
    /@|https?:\/\//iu.test(trimmedRaw)
  ) {
    return null;
  }

  const cleaned = stripStructuredTitleNoise(trimmedRaw)
    .trim()
    .replace(/^["'“”‘’]|["'“”‘’]$/gu, "")
    .split("\n")[0]
    .replace(/[.!?]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;
  if (Array.from(cleaned).length > 40) return null;
  if (cleaned.split(/\s+/).length > 4) return null;
  if (!/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}\s&'’+/-]*$/u.test(cleaned)) {
    return null;
  }
  const words = tokenizeSearchText(cleaned);
  const conversationalOpening = words.slice(0, 2).join(" ");
  if (
    ["can you", "could you", "would you", "will you", "i need", "i want", "we need", "we want"]
      .includes(conversationalOpening) ||
    words[0] === "please"
  ) {
    return null;
  }
  if (
    words.some((word) =>
      ["analyze", "analyse", "understand", "identify", "determine"].includes(word),
    ) && words.some((word) => ["request", "intent"].includes(word))
  ) {
    return null;
  }
  return cleaned;
}

export function fallbackTitle(seed: string): string {
  const stopWords = new Set([
    "the", "and", "for", "with", "about", "of", "to", "this", "please", "can", "could",
    "would", "will", "you", "your", "our", "what", "when", "where",
    "which", "show", "tell", "need", "want", "does", "have", "new",
  ]);
  const words = tokenizeSearchText(stripStructuredTitleNoise(seed), {
    minimumLength: 2,
  })
    .filter((word) => !stopWords.has(word))
    .filter((word) => !/^\p{N}+$/u.test(word))
    .slice(0, 4);

  const fallbackWords = words.length
    ? words
    : tokenizeSearchText(seed, { minimumLength: 1 }).slice(0, 4);
  const titledWords = fallbackWords
    .map((word) => {
      const [first, ...rest] = Array.from(word);
      return `${first?.toLocaleUpperCase("und") ?? ""}${rest.join("")}`;
    });
  const boundedWords: string[] = [];
  for (const word of titledWords) {
    const candidate = [...boundedWords, word].join(" ");
    if (Array.from(candidate).length > 40) break;
    boundedWords.push(word);
  }
  const title = boundedWords.join(" ").trim();

  return title || "New Chat";
}

export function buildTitlePromptContent(context: TitleContext): string {
  const parts = [
    `Initial user request:\n${context.userMessage.trim().slice(0, 900)}`,
  ];

  if (context.initialContext) {
    const lines = [`Page type: ${context.initialContext.pageType}`];
    if (context.initialContext.summary) lines.push(`Page summary: ${context.initialContext.summary}`);
    parts.push(`Starting page context:\n${lines.join("\n")}`);
  }

  if (context.attachments?.length) {
    parts.push(
      `Initial attachments:\n${context.attachments
        .map((attachment) => `- ${attachment.filename}${attachment.contentType ? ` (${attachment.contentType})` : ""}`)
        .join("\n")}`,
    );
  }

  if (context.assistantReply?.trim()) {
    parts.push(`Assistant response summary:\n${context.assistantReply.trim().slice(0, 300)}`);
  }

  return parts.join("\n\n");
}

/**
 * Generate a short title for a thread from its first user message.
 * Scheduled from sendMessage so it runs independently of agent response streaming.
 */
export const generate = internalAction({
  args: {
    threadId: v.id("threads"),
    userMessageId: v.optional(v.id("threadMessages")),
  },
  handler: async (ctx, args) => {
    try {
      const thread = await ctx.runQuery(internal.threads.getInternal, {
        id: args.threadId,
      });
      if (!thread) return;
      if (thread.title && thread.title !== "New chat") return;

      const message = args.userMessageId
        ? await ctx.runQuery(internal.threads.getMessageInternal, {
            id: args.userMessageId,
          })
        : undefined;
      const seed = (message?.content ?? "").trim();
      if (!seed) return;
      const promptContent = buildTitlePromptContent({
        userMessage: seed,
        initialContext: thread.initialContext,
        attachments: message?.attachments
          ?.filter((attachment: { filename?: string }) => Boolean(attachment.filename))
          .map((attachment: { filename?: string; contentType?: string }) => ({
            filename: attachment.filename!,
            contentType: attachment.contentType,
          })),
      });

      let title = fallbackTitle(seed);
      try {
        const result = await generateObjectForOrg(ctx, thread.orgId, "summary", {
          schema: ThreadTitleOutputSchema,
          maxOutputTokens: 16,
          system: TITLE_SYSTEM_PROMPT,
          prompt: promptContent,
        });
        const generated = normalizeGeneratedTitle(result.object.title);
        if (generated) title = generated;
      } catch (err) {
        logAiError("threadTitle.generateText", err, { threadId: args.threadId });
      }

      // Re-check the title hasn't been manually changed in the meantime
      const latest = await ctx.runQuery(internal.threads.getInternal, {
        id: args.threadId,
      });
      if (!latest || (latest.title && latest.title !== "New chat")) return;

      await ctx.runMutation(internal.threads.updateTitleInternal, {
        threadId: args.threadId,
        title,
      });
    } catch (err) {
      logAiError("threadTitle.generate", err, { threadId: args.threadId });
    }
  },
});
