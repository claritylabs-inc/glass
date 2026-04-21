"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { streamText, generateText, type ModelMessage } from "ai";
import { haikuModel } from "../lib/ai";
import {
  buildDocumentContext,
  buildConversationMemoryContext,
} from "../lib/agentPrompts";
import { buildSystemPromptForContext } from "../lib/aiUtils";
import { classifyPromptInjection, enforceInputLimits } from "../lib/security";

export const run = internalAction({
  args: {
    chatId: v.id("webChats"),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    userMessageId: v.id("webChatMessages"),
  },
  handler: async (ctx, args) => {
    // Insert processing placeholder
    const agentMsgId = await ctx.runMutation(
      internal.webChats.insertAgentMessage,
      { chatId: args.chatId, orgId: args.orgId },
    );

    try {
      // Load org
      const org = await ctx.runQuery(internal.orgs.getInternal, {
        id: args.orgId,
      });
      if (!org) throw new Error("Organization not found");

      // ── Prompt injection guard ──
      const userMsgForGuard = await ctx.runQuery(internal.webChats.getMessageInternal, {
        id: args.userMessageId,
      });
      if (userMsgForGuard?.content) {
        const sanitizedContent = enforceInputLimits(userMsgForGuard.content);
        const injectionCheck = await classifyPromptInjection(sanitizedContent);
        if (!injectionCheck.safe) {
          await ctx.runMutation(internal.webChats.updateAgentMessage, {
            id: agentMsgId,
            content: "I can't process this request. Please rephrase your question about insurance policies or coverage.",
          });
          console.warn("[security] Prompt injection blocked in web chat", {
            chatId: args.chatId,
            reason: injectionCheck.reason,
          });
          return;
        }
      }

      // Load policies, quotes, and applications
      const policies = await ctx.runQuery(
        internal.policies.listAllInternal,
        { orgId: args.orgId },
      );
      // applicationSessions retired
      const applications: Array<Record<string, unknown>> = [];

      // Get sender name
      const user = await ctx.runQuery(internal.users.getInternal, {
        id: args.userId,
      });
      const userName = user?.name?.split(/\s+/)[0];

      const siteUrl =
        process.env.SITE_URL ?? "https://prism.claritylabs.inc";

      // Build system prompt (reuse direct mode)
      const systemPrompt = buildSystemPromptForContext({
        org,
        mode: "direct",
        userName,
        siteUrl,
      });

      // Load chat messages for history
      const allMessages = await ctx.runQuery(
        internal.webChats.messagesInternal,
        { chatId: args.chatId },
      );

      // Find the latest user message for context
      const latestUserMsg = allMessages
        .filter((m: Record<string, unknown>) => m.role === "user")
        .pop();
      const latestUserContent = latestUserMsg?.content ?? "";

      // Build document context (vector search with fallback)
      const { context: docContext, relevantPolicyIds, relevantQuoteIds } = await buildDocumentContext(
        ctx,
        args.orgId,
        policies,
        [],
        latestUserContent,
      );

      // Cross-thread conversation memory (vector search)
      const memoryContext = await buildConversationMemoryContext(ctx, args.orgId, latestUserContent);

      // Build message history (skip processing placeholders)
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

      // Web chat addendum
      const webChatAddendum = `

WEB CHAT MODE:
- This is a web chat conversation, not email. Use markdown freely -- **bold**, *italic*, headers, bullet points, code blocks are all rendered properly.
- Keep the conversational style but you can use richer formatting.
- Multiple team members may participate in the same chat. Their name appears in brackets before their message.
- Do NOT include email-style sign-offs or greetings.`;

      // Page context: if the chat was started from a specific page, inject focused context
      let pageContextBlock = "";
      const chat = await ctx.runQuery(internal.webChats.getInternal, { id: args.chatId });
      if (chat?.initialContext) {
        const ic = chat.initialContext;
        if (ic.summary) {
          pageContextBlock = `\n\nFOCUSED CONTEXT — The user started this chat from the ${ic.pageType} detail page:\n- ${ic.summary}\n- Prioritize answering questions about this specific ${ic.pageType}. Reference it directly without the user needing to specify which one.\n`;
        } else if (ic.pageType) {
          pageContextBlock = `\n\nFOCUSED CONTEXT — The user started this chat from the ${ic.pageType} page.\n`;
        }
      }

      // Build application context
      let applicationContext = "";
      if (applications.length > 0) {
        const appLines = applications.map((a: Record<string, unknown>) => {
          const title = a.applicationTitle ?? a.sourceFileName;
          const progress = a.totalFields
            ? `${a.filledFields ?? 0}/${a.totalFields} fields filled`
            : "";
          return `- ${title} | Status: ${a.status}${progress ? ` | ${progress}` : ""} | ID: ${a._id}`;
        });
        applicationContext = `\n\nAPPLICATION SESSIONS (${applications.length}):\n${appLines.join("\n")}`;
      }

      const fullSystemPrompt =
        systemPrompt +
        webChatAddendum +
        pageContextBlock +
        "\n\n" +
        docContext +
        applicationContext +
        memoryContext;

      // Call Claude with streaming
      let content = "";
      let lastFlush = 0;
      const FLUSH_INTERVAL = 150; // ms between DB updates

      const result = streamText({
        model: haikuModel,
        maxOutputTokens: 2048,
        system: fullSystemPrompt,
        messages: messageHistory,
      });

      for await (const chunk of result.textStream) {
        content += chunk;
        const now = Date.now();
        if (now - lastFlush >= FLUSH_INTERVAL) {
          lastFlush = now;
          await ctx.runMutation(internal.webChats.streamAgentMessage, {
            id: agentMsgId,
            content,
          });
        }
      }

      // Final update — clears processing status, saves provenance
      await ctx.runMutation(internal.webChats.updateAgentMessage, {
        id: agentMsgId,
        content,
        referencedPolicyIds: relevantPolicyIds.length > 0 ? relevantPolicyIds : undefined,
        referencedQuoteIds: relevantQuoteIds.length > 0 ? relevantQuoteIds : undefined,
      });
      await ctx.runMutation(internal.webChats.touchChat, {
        chatId: args.chatId,
      });

      // Auto-title: if this is the first user message, generate a title
      const userMessages = allMessages.filter((m: Record<string, unknown>) => m.role === "user");
      if (userMessages.length === 1) {
        try {
          const { text: titleText } = await generateText({
            model: haikuModel,
            maxOutputTokens: 12,
            system:
              "You are a title generator. Given a user question and an assistant reply, output a short 2-4 word title that captures the topic. Rules:\n- Output ONLY the title, no quotes, no punctuation, no explanation\n- Use title case\n- Examples: \"GL Coverage Limits\", \"Cyber Liability Quotes\", \"Workers Comp App\", \"Renewal Timeline\"",
            messages: [
              {
                role: "user",
                content: `User: ${userMessages[0].content}\n\nAssistant: ${content.slice(0, 200)}`,
              },
            ],
          });
          const title = titleText
            .trim()
            .replace(/^["']|["']$/g, "")
            .split("\n")[0]; // take only first line
          if (title && title.length <= 40) {
            await ctx.runMutation(internal.webChats.updateTitleInternal, {
              chatId: args.chatId,
              title,
            });
          }
        } catch {
          // Non-critical — title stays as "New chat"
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      console.error("Web chat agent error:", message);
      await ctx.runMutation(internal.webChats.updateAgentError, {
        id: agentMsgId,
        error: message,
      });
    }
  },
});
