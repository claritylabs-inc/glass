import type { ModelMessage } from "ai";
import { buildAgentSystemPrompt, type AgentContext } from "@claritylabs/cl-sdk";

export { buildConversationMemoryContext, buildConversationMemoryFromList, buildDocumentContext } from "./agentPrompts";

/* ── Markdown processing ── */

export function stripMarkdown(text: string): string {
  let result = text;
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "$1");
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)");
  result = result.replace(/\*\*(.+?)\*\*/g, "$1");
  result = result.replace(/\*(.+?)\*/g, "$1");
  return result;
}

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
}

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

  // Map mode to intent
  const intent = mode === "direct" ? "direct" : mode === "cc" ? "mediated" : "observed";

  const agentCtx: AgentContext = {
    platform: "email",
    intent,
    companyName: org.name,
    companyContext: safeContext,
    siteUrl,
    userName,
    coiHandling: org.coiHandling as string | undefined,
    brokerName: org.insuranceBroker,
    brokerContactName: org.brokerContactName,
    brokerContactEmail: org.brokerContactEmail,
    agentName: "Prism",
  };

  return buildAgentSystemPrompt(agentCtx);
}

/* ── Structured error logging ── */

export function logAiError(
  action: string,
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  const message = error instanceof Error ? error.message : String(error);
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
