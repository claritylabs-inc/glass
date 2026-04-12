"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText } from "ai";
import { getModel } from "../lib/models";
import { buildDocumentContext, buildConversationMemoryContext } from "../lib/agentPrompts";
import {
  buildSystemPromptForContext,
  buildMessageHistory,
  logAiError,
} from "../lib/aiUtils";
import { buildMemoryContext } from "../lib/orgMemoryContext";

/**
 * Simplified chat action for MCP — no streaming, no email sending.
 * Creates/reuses a thread, generates a response, persists it, and returns.
 */
export const run = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    message: v.string(),
    threadId: v.optional(v.id("threads")),
  },
  handler: async (ctx, args): Promise<{ threadId: string; response: string }> => {
    // Load org
    const org = await ctx.runQuery(internal.orgs.getInternal, { id: args.orgId });
    if (!org) throw new Error("Organization not found");

    // Get or create thread
    let threadId = args.threadId;
    if (!threadId) {
      threadId = await ctx.runMutation(internal.threads.createInternal, {
        orgId: args.orgId,
        userId: args.userId,
        title: "MCP Chat",
      });
    }

    // Get user info
    const user = await ctx.runQuery(internal.users.getInternal, { id: args.userId });
    const userName = user?.name?.split(/\s+/)[0];

    // Insert user message
    await ctx.runMutation(internal.threads.insertUserMessageInternal, {
      threadId,
      orgId: args.orgId,
      userId: args.userId,
      userName: user?.name ?? user?.email ?? "User",
      content: args.message,
    });

    // Load data for context
    const [policies, applications, allMessages] = await Promise.all([
      ctx.runQuery(internal.policies.listAllInternal, { orgId: args.orgId }),
      ctx.runQuery(internal.applicationSessions.listAllInternal, { orgId: args.orgId }),
      ctx.runQuery(internal.threads.messagesInternal, { threadId }),
    ]);

    const siteUrl = process.env.SITE_URL ?? "https://prism.claritylabs.inc";

    // Build system prompt
    const systemPrompt = buildSystemPromptForContext({
      org,
      mode: "direct",
      userName,
      siteUrl,
    });

    // Document context (vector search with fallback)
    const { context: docContext, relevantPolicyIds, relevantQuoteIds } =
      await buildDocumentContext(ctx, args.orgId, policies, [], args.message);

    // Cross-thread conversation memory (vector search)
    const memoryContext = await buildConversationMemoryContext(ctx, args.orgId, args.message);

    // Load org memory
    const orgMemories = await ctx.runQuery(
      internal.orgMemory.listByOrg,
      { orgId: args.orgId, limit: 30 },
    );
    const orgMemoryBlock = buildMemoryContext(orgMemories);

    // Application context
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

    const mcpAddendum = `

MCP MODE:
- This is a programmatic query from an MCP-connected AI agent, not a human chat.
- Be concise and structured in your responses.
- Use markdown for formatting.
- Do NOT include email-style sign-offs or greetings.`;

    const fullSystemPrompt =
      systemPrompt +
      mcpAddendum +
      "\n\n" +
      docContext +
      applicationContext +
      memoryContext +
      orgMemoryBlock;

    // Build message history (skip processing placeholders)
    const messageHistory = buildMessageHistory(allMessages);

    // Generate response (non-streaming)
    const { text: content } = await generateText({
      model: getModel("chat"),
      maxOutputTokens: 2048,
      system: fullSystemPrompt,
      messages: messageHistory,
    });

    // Insert agent message
    const agentMsgId = await ctx.runMutation(internal.threads.insertAgentMessage, {
      threadId,
      orgId: args.orgId,
    });
    await ctx.runMutation(internal.threads.updateAgentMessage, {
      id: agentMsgId,
      content,
      referencedPolicyIds: relevantPolicyIds.length > 0 ? relevantPolicyIds : undefined,
      referencedQuoteIds: relevantQuoteIds.length > 0 ? relevantQuoteIds : undefined,
    });
    await ctx.runMutation(internal.threads.touchThread, { threadId });

    // Auto-title if this is a new thread (only 1 user message)
    const userMessages = allMessages.filter((m) => m.role === "user");
    if (userMessages.length <= 1) {
      try {
        const { text: titleText } = await generateText({
          model: getModel("summary"),
          maxOutputTokens: 12,
          system:
            "You are a title generator. Given a user question and an assistant reply, output a short 2-4 word title that captures the topic. Rules:\n- Output ONLY the title, no quotes, no punctuation, no explanation\n- Use title case\n- Examples: \"GL Coverage Limits\", \"Cyber Liability Quotes\", \"Workers Comp App\", \"Renewal Timeline\"",
          messages: [
            {
              role: "user",
              content: `User: ${args.message}\n\nAssistant: ${content.slice(0, 200)}`,
            },
          ],
        });
        const title = titleText
          .trim()
          .replace(/^["']|["']$/g, "")
          .split("\n")[0];
        if (title && title.length <= 40) {
          await ctx.runMutation(internal.threads.updateTitleInternal, {
            threadId,
            title,
          });
        }
      } catch {
        // Non-critical
      }
    }

    return { threadId: threadId as string, response: content };
  },
});
