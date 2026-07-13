"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateTextForOrg } from "../lib/models";
import { logAiError } from "../lib/aiUtils";

export const TITLE_SYSTEM_PROMPT = `You are a thread title generator for an insurance work assistant.

Given the initial user request and any starting page context, output a short title that captures the user's actual work intent.

Rules:
- Output ONLY the title, no quotes, no punctuation, no explanation.
- Use title case.
- Use 2-4 words.
- Never begin with conversational framing such as "Can you", "Could you", "I need", or "Please".
- Prefer the action and deliverable/topic over contact names or email addresses.
- Use starting page context to disambiguate generic requests like "send this", "summarize this", or "what about exclusions?"
- Never include raw email addresses, email domains, usernames, file IDs, generated IDs, or local-part fragments.
- For certificate of insurance work, use a compact action title such as "Generate COI", "Update COI", "Draft COI", or "Send COI".
- Good examples: "Generate COI", "Send COI", "GL Coverage Limits", "Cyber Liability Policy", "Endorsement Follow Up", "Renewal Timeline".`;

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

function stripEmailNoise(input: string): string {
  return input
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/\b(?:gmail|icloud|outlook|hotmail|yahoo|aol|protonmail|com|net|org|inc)\b/gi, " ")
    .replace(/\b[a-z]+[a-z0-9._%+-]*\d{2,}[a-z0-9._%+-]*\b/gi, " ");
}

export function normalizeGeneratedTitle(raw: string): string | null {
  if (
    /@|https?:\/\//i.test(raw) ||
    /\b(?:gmail|icloud|outlook|hotmail|yahoo|aol|protonmail)\b/i.test(raw) ||
    /\b[a-z]+[a-z0-9._%+-]*\d{2,}[a-z0-9._%+-]*\b/i.test(raw)
  ) {
    return null;
  }

  const cleaned = stripEmailNoise(raw)
    .trim()
    .replace(/^["']|["']$/g, "")
    .split("\n")[0]
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;
  if (cleaned.length > 40) return null;
  if (cleaned.split(/\s+/).length > 4) return null;
  if (/^(?:can|could|would|will)\s+you\b|^(?:i|we)\s+(?:need|want)\b|^please\b/i.test(cleaned)) {
    return null;
  }
  if (/@|https?:\/\//i.test(cleaned)) return null;
  return cleaned;
}

function certificateTitle(seed: string): string | null {
  if (!/\b(?:coi|certificates?)\b/i.test(seed)) return null;
  if (/\b(?:update|revise|reissue|correct|change|edit|modify)\b/i.test(seed)) {
    return "Update COI";
  }
  if (/\b(?:send|email|forward|share|deliver)\b/i.test(seed)) {
    return "Send COI";
  }
  if (/\b(?:draft|prepare)\b/i.test(seed)) return "Draft COI";
  if (/\b(?:generate|create|issue|make|produce)\b/i.test(seed)) {
    return "Generate COI";
  }
  return "COI Request";
}

export function fallbackTitle(seed: string): string {
  const normalizedSeed = stripEmailNoise(seed);
  const lower = normalizedSeed.toLowerCase();

  const certificate = certificateTitle(normalizedSeed);
  if (certificate) return certificate;

  const words = normalizedSeed
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .filter((word) => !/^(a|an|the|and|for|with|about|please|can|could|would|will|you|your|we|our|what|when|where|which|show|tell|need|want|does|have|new)$/i.test(word))
    .filter((word) => !/^\d+$/.test(word))
    .slice(0, 4);

  const title = (words.length ? words : seed.split(/\s+/).slice(0, 4))
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
    .trim();

  if (!title && lower.includes("email")) return "Email Request";
  return title.slice(0, 40) || "New Chat";
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
        const { text } = await generateTextForOrg(ctx, thread.orgId, "summary", {
          maxOutputTokens: 16,
          system: TITLE_SYSTEM_PROMPT,
          messages: [{ role: "user", content: promptContent }],
        });
        const generated = normalizeGeneratedTitle(text);
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
