import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PrismClient } from "../client.js";

export function registerAgentTools(server: McpServer, client: PrismClient) {
  server.tool(
    "ask_prism",
    "Ask the Prism AI assistant a question about the organization's insurance portfolio, policies, quotes, applications, or coverage details. Prism has full context about all policies and quotes and can answer complex insurance questions. Optionally pass a threadId to continue an existing conversation.",
    {
      message: z.string().describe("The question or message to send to Prism"),
      threadId: z
        .string()
        .optional()
        .describe("Optional thread ID to continue an existing conversation"),
    },
    async ({ message, threadId }) => {
      const result = await client.ask(message, threadId);
      const text = `**Thread:** ${result.threadId}\n\n${result.response}`;
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
