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

export async function POST(req: NextRequest) {
  const convex = new ConvexHttpClient(convexUrl);

  // Extract Convex auth token from request
  const authToken = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!authToken) {
    return new Response("Unauthorized", { status: 401 });
  }
  convex.setAuth(authToken);

  // Validate user
  const user = await convex.query(api.users.viewer, {});
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const { messages: chatMessages, threadId } = body as {
    messages: Array<{ role: string; content: string }>;
    threadId?: string;
  };

  if (!threadId) {
    return new Response("threadId required", { status: 400 });
  }

  // Load thread
  const thread = await convex.query(api.threads.get, {
    id: threadId as any,
  });
  if (!thread) {
    return new Response("Thread not found", { status: 404 });
  }

  // Load org
  const orgData = await convex.query(api.orgs.viewerOrg, {});
  if (!orgData) {
    return new Response("Organization not found", { status: 404 });
  }
  const { org } = orgData;

  // Insert processing placeholder
  const agentMsgId = await convex.mutation(
    api.threads.insertProcessingMessage,
    { threadId: threadId as any },
  );

  try {
    // Load policies, quotes, and thread messages in parallel
    const [policies, quotes, threadMessages] = await Promise.all([
      convex.query(api.policies.list, {}),
      convex.query(api.quotes.list, {}),
      convex.query(api.threads.messages, { threadId: threadId as any }),
    ]);

    const userName = user.name?.split(/\s+/)[0];
    const siteUrl = process.env.SITE_URL ?? "https://prism.claritylabs.inc";

    // Build system prompt
    const systemPrompt = buildSystemPromptForContext({
      org,
      mode: "direct",
      userName,
      siteUrl,
    });

    // Find latest user message content for document context matching
    const latestUserContent =
      chatMessages?.filter((m: any) => m.role === "user").pop()?.content ?? "";

    // Build document context (maps Convex types to SDK interfaces)
    const policyDocs = policies.map((p: any) => ({
      ...p,
      id: p._id,
      type: "policy" as const,
    }));
    const quoteDocs = quotes.map((q: any) => ({
      ...q,
      id: q._id,
      type: "quote" as const,
    }));
    const { context: docContext, relevantPolicyIds, relevantQuoteIds } =
      buildDocumentContext(policyDocs, quoteDocs, latestUserContent);

    // Load org memory (public query, scoped to viewer's org)
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

    // Web chat addendum
    const hasEmailMessages = threadMessages.some(
      (m: any) => m.channel === "email",
    );
    const isMixedThread =
      hasEmailMessages || !!(thread as any).legacyConversationId;

    const webChatAddendum = isMixedThread
      ? `\n\nMIXED THREAD MODE:\n- This thread includes both web chat messages (visible only to the team) and email messages (visible to external participants).\n- Use markdown freely.\n- Multiple team members may participate. Their name appears in brackets before their message.\n- Do NOT include email-style sign-offs or greetings.`
      : `\n\nWEB CHAT MODE:\n- This is a web chat conversation, not email. Use markdown freely.\n- Keep the conversational style but you can use richer formatting.\n- Multiple team members may participate. Their name appears in brackets before their message.\n- Do NOT include email-style sign-offs or greetings.`;

    // Page context
    let pageContextBlock = "";
    if ((thread as any).initialContext) {
      const ic = (thread as any).initialContext;
      if (ic.summary) {
        pageContextBlock = `\n\nFOCUSED CONTEXT — The user started this chat from the ${ic.pageType} detail page:\n- ${ic.summary}\n- Prioritize answering questions about this specific ${ic.pageType}.\n`;
      } else if (ic.pageType) {
        pageContextBlock = `\n\nFOCUSED CONTEXT — The user started this chat from the ${ic.pageType} page.\n`;
      }
    }

    const fullSystemPrompt =
      systemPrompt + webChatAddendum + pageContextBlock + "\n\n" + docContext + orgMemoryBlock;

    // Stream response
    let result;
    try {
      result = streamText({
        model: getModel("chat"),
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
                model: getModel("summary"),
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logAiError("chatApiRoute", error, { threadId });

    // Mark the processing message as error
    try {
      await convex.mutation(api.threads.setMessageError, {
        messageId: agentMsgId,
        error: message,
      });
    } catch {
      // Best effort
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
