"use node";

import { v } from "convex/values";
import { generateText } from "ai";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getModelForOrg, getProviderOptionsForTask } from "../lib/models";
import { logAiError } from "../lib/aiUtils";

function fallbackTitle(seed: string): string {
  const words = seed
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .filter((word) => !/^(the|and|for|with|about|please|what|when|where|which|show|tell|need|want|does|have)$/i.test(word))
    .slice(0, 4);

  const title = (words.length ? words : seed.split(/\s+/).slice(0, 4))
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
    .trim();

  return title.slice(0, 40) || "New Chat";
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

      let title = fallbackTitle(seed);
      try {
        const { text } = await generateText({
          model: await getModelForOrg(ctx, thread.orgId, "summary"),
          providerOptions: getProviderOptionsForTask("summary"),
          maxOutputTokens: 12,
          system:
            "You are a title generator. Given a user question, output a short 2-4 word title that captures the topic. Rules:\n- Output ONLY the title, no quotes, no punctuation, no explanation\n- Use title case\n- Examples: \"GL Coverage Limits\", \"Cyber Liability Quotes\", \"Workers Comp App\", \"Renewal Timeline\"",
          messages: [{ role: "user", content: seed.slice(0, 500) }],
        });
        const generated = text.trim().replace(/^["']|["']$/g, "").split("\n")[0];
        if (generated && generated.length <= 40) title = generated;
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
