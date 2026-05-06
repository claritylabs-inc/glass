"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText } from "ai";
import { getModelForOrg, getProviderOptionsForTask } from "../lib/models";
import { buildDocumentContext, buildConversationMemoryContext } from "../lib/agentPrompts";
import {
  buildSystemPromptForContext,
  buildMessageHistory,
} from "../lib/aiUtils";
import { buildIntelligenceContext } from "../lib/agentPrompts";
import { classifyPromptInjection, enforceInputLimits } from "../lib/security";

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

    // ── Prompt injection guard ──
    const sanitizedMessage = enforceInputLimits(args.message);
    const injectionCheck = await classifyPromptInjection(sanitizedMessage);
    if (!injectionCheck.safe) {
      console.warn("[security] Prompt injection blocked in MCP chat", {
        orgId: args.orgId,
        reason: injectionCheck.reason,
      });
      return {
        threadId: args.threadId as string ?? "",
        response: "I can't process this request. Please rephrase your question about insurance policies or coverage.",
      };
    }

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
    const [policies, allMessages] = await Promise.all([
      ctx.runQuery(internal.policies.listAllInternal, { orgId: args.orgId }),
      ctx.runQuery(internal.threads.messagesInternal, { threadId }),
    ]);
    const siteUrl = process.env.SITE_URL ?? "https://glass.claritylabs.inc";

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

    // Load business intelligence (vector search, deduped against policy context)
    const orgMemoryBlock = await buildIntelligenceContext(
      ctx, args.orgId, args.message,
      relevantPolicyIds.map((id: unknown) => id as string),
    );

    const connectedVendors = await ctx.runQuery(
      (internal as any).connectedOrgs.listActiveVendorsInternal,
      { clientOrgId: args.orgId },
    ).catch(() => []);
    const connectedVendorBlock = Array.isArray(connectedVendors) && connectedVendors.length > 0
      ? `\n\nCONNECTED VENDOR ACCESS:\nThe caller's org has read-only access to these vendor organizations. When the user asks about vendor/client risk, vendor COIs, or vendor policies, tell them to use MCP vendor tools for exact policy lists and use this roster for disambiguation. Do not imply write access.\n${connectedVendors.map((row: any) => `- ${row.vendorOrg?.name ?? row.vendorOrgId} (vendorOrgId: ${row.vendorOrgId}, status: ${row.status})`).join("\n")}`
      : "";

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
      memoryContext +
      orgMemoryBlock +
      connectedVendorBlock;

    // Build message history (skip processing placeholders)
    const messageHistory = buildMessageHistory(allMessages);

    // Generate response (non-streaming)
    const { text: content } = await generateText({
      model: await getModelForOrg(ctx, args.orgId, "chat"),
      providerOptions: getProviderOptionsForTask("chat"),
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
    const userMessages = allMessages.filter((m: { role?: string }) => m.role === "user");
    if (userMessages.length <= 1) {
      try {
        const { text: titleText } = await generateText({
          model: await getModelForOrg(ctx, args.orgId, "summary"),
          providerOptions: getProviderOptionsForTask("summary"),
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
