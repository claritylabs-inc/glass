"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildSystemPrompt,
  buildDocumentContext,
  buildConversationMemoryContext,
} from "../lib/agentPrompts";

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

      // Load policies, quotes, and applications
      const policies = await ctx.runQuery(
        internal.policies.listAllInternal,
        { orgId: args.orgId },
      );
      const quotes = await ctx.runQuery(
        internal.quotes.listAllInternal,
        { orgId: args.orgId },
      );
      const applications = await ctx.runQuery(
        internal.applicationSessions.listAllInternal,
        { orgId: args.orgId },
      );

      // Get sender name
      const user = await ctx.runQuery(internal.users.getInternal, {
        id: args.userId,
      });
      const userName = user?.name?.split(/\s+/)[0];

      const siteUrl =
        process.env.SITE_URL ?? "https://email.claritylabs.inc";

      // Build system prompt (reuse direct mode)
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

      // Load chat messages for history
      const allMessages = await ctx.runQuery(
        internal.webChats.messagesInternal,
        { chatId: args.chatId },
      );

      // Find the latest user message for context
      const latestUserMsg = allMessages
        .filter((m) => m.role === "user")
        .pop();
      const latestUserContent = latestUserMsg?.content ?? "";

      // Build document context
      const { context: docContext, relevantPolicyIds, relevantQuoteIds } = buildDocumentContext(
        policies,
        quotes,
        latestUserContent,
      );

      // Cross-thread conversation memory
      const pastConversations = await ctx.runQuery(
        internal.agentConversations.searchOrgConversations,
        {
          orgId: args.orgId,
          queryText: latestUserContent,
        },
      );
      const memoryContext = buildConversationMemoryContext(pastConversations);

      // Build message history (skip processing placeholders)
      const messageHistory: Anthropic.MessageParam[] = [];
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
        const appLines = applications.map((a) => {
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
      const client = new Anthropic();
      let content = "";
      let lastFlush = 0;
      const FLUSH_INTERVAL = 150; // ms between DB updates

      const stream = await client.messages.stream({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: fullSystemPrompt,
        messages: messageHistory,
      });

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          content += event.delta.text;
          const now = Date.now();
          if (now - lastFlush >= FLUSH_INTERVAL) {
            lastFlush = now;
            await ctx.runMutation(internal.webChats.streamAgentMessage, {
              id: agentMsgId,
              content,
            });
          }
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
      const userMessages = allMessages.filter((m) => m.role === "user");
      if (userMessages.length === 1) {
        try {
          const titleResponse = await client.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 12,
            system:
              "You are a title generator. Given a user question and an assistant reply, output a short 2-4 word title that captures the topic. Rules:\n- Output ONLY the title, no quotes, no punctuation, no explanation\n- Use title case\n- Examples: \"GL Coverage Limits\", \"Cyber Liability Quotes\", \"Workers Comp App\", \"Renewal Timeline\"",
            messages: [
              {
                role: "user",
                content: `User: ${userMessages[0].content}\n\nAssistant: ${content.slice(0, 200)}`,
              },
            ],
          });
          const title = titleResponse.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("")
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
