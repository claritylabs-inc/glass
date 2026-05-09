"use node";

import { v } from "convex/values";
import { generateText } from "ai";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getModelForOrg, getProviderOptionsForTask } from "../lib/models";
import { logAiError } from "../lib/aiUtils";

/**
 * Generate a short title for a thread from its first user message.
 * Scheduled from sendMessage so it runs independently of agent response streaming.
 */
export const generate = internalAction({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    try {
      const thread = await ctx.runQuery(internal.threads.getInternal, {
        id: args.threadId,
      });
      if (!thread) return;
      if (thread.title && thread.title !== "New chat") return;

      const messages = await ctx.runQuery(internal.threads.messagesInternal, {
        threadId: args.threadId,
      });
      const userMessages = messages.filter(
        (m: Record<string, unknown>) => m.role === "user",
      );
      if (userMessages.length === 0) return;
      const first = userMessages[0] as { content?: string };
      const seed = (first.content ?? "").trim();
      if (!seed) return;

      const { text } = await generateText({
        model: await getModelForOrg(ctx, thread.orgId, "summary"),
        providerOptions: getProviderOptionsForTask("summary"),
        maxOutputTokens: 12,
        system:
          "You are a title generator. Given a user question, output a short 2-4 word title that captures the topic. Rules:\n- Output ONLY the title, no quotes, no punctuation, no explanation\n- Use title case\n- Examples: \"GL Coverage Limits\", \"Cyber Liability Quotes\", \"Workers Comp App\", \"Renewal Timeline\"",
        messages: [{ role: "user", content: seed.slice(0, 500) }],
      });
      const title = text.trim().replace(/^["']|["']$/g, "").split("\n")[0];
      if (!title || title.length > 40) return;

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
