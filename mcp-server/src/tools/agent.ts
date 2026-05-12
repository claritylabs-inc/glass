import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GlassClient } from "../client.js";

export function registerAgentTools(server: McpServer, client: GlassClient) {
  const askHandler = async ({ message, threadId }: { message: string; threadId?: string }) => {
    const result = await client.ask(message, threadId);
    const text = `**Thread:** ${result.threadId}\n\n${result.response}`;
    return { content: [{ type: "text" as const, text }] };
  };

  server.tool(
    "ask_glass",
    "Ask the Glass AI assistant a question about the organization's insurance portfolio, policies, quotes, or coverage details. Glass has full context about all policies and quotes and can answer complex insurance questions. Optionally pass a threadId to continue an existing conversation.",
    {
      message: z.string().describe("The question or message to send to Glass"),
      threadId: z
        .string()
        .optional()
        .describe("Optional thread ID to continue an existing conversation"),
    },
    askHandler,
  );

  server.tool(
    "list_email_drafts",
    "List durable outbound email drafts. Optionally filter by threadId.",
    {
      threadId: z.string().optional().describe("Optional thread ID"),
    },
    async ({ threadId }: { threadId?: string }) => {
      const result = await client.listEmailDrafts(threadId);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "draft_email",
    "Create a durable outbound email draft using Glass's shared email artifact. Returns a draft ID that can be updated, sent, or cancelled.",
    {
      threadId: z.string().optional().describe("Optional thread ID to attach the draft to"),
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Plain text email body"),
      cc: z.array(z.string()).optional().describe("CC email addresses"),
      bcc: z.array(z.string()).optional().describe("BCC email addresses"),
    },
    async (input: {
      threadId?: string;
      to: string;
      subject: string;
      body: string;
      cc?: string[];
      bcc?: string[];
    }) => {
      const result = await client.upsertEmailDraft(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "update_email_draft",
    "Update an existing durable outbound email draft in place.",
    {
      draftId: z.string().describe("Draft ID returned by draft_email or list_email_drafts"),
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Plain text email body"),
      cc: z.array(z.string()).optional().describe("CC email addresses"),
      bcc: z.array(z.string()).optional().describe("BCC email addresses"),
    },
    async (input: {
      draftId: string;
      to: string;
      subject: string;
      body: string;
      cc?: string[];
      bcc?: string[];
    }) => {
      const result = await client.upsertEmailDraft(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "send_email_draft",
    "Send a durable outbound email draft.",
    {
      draftId: z.string().describe("Draft ID returned by draft_email or list_email_drafts"),
    },
    async ({ draftId }: { draftId: string }) => {
      const result = await client.sendEmailDraft(draftId);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "cancel_email_draft",
    "Cancel a durable outbound email draft.",
    {
      draftId: z.string().describe("Draft ID returned by draft_email or list_email_drafts"),
    },
    async ({ draftId }: { draftId: string }) => {
      const result = await client.cancelEmailDraft(draftId);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Legacy alias
  server.tool(
    "ask_glass",
    "Alias for ask_glass (legacy name). Ask the Glass AI assistant a question.",
    {
      message: z.string().describe("The question or message to send to Glass"),
      threadId: z
        .string()
        .optional()
        .describe("Optional thread ID to continue an existing conversation"),
    },
    askHandler,
  );
}
