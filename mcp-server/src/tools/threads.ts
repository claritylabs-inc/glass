import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PrismClient } from "../client.js";

export function registerThreadTools(server: McpServer, client: PrismClient) {
  server.tool(
    "list_threads",
    "List recent conversation threads (up to 50, newest first).",
    {},
    async () => {
      const result = await client.listThreads();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "get_thread_messages",
    "Get all messages in a conversation thread.",
    {
      threadId: z.string().describe("The thread ID"),
    },
    async ({ threadId }) => {
      const result = await client.getThreadMessages(threadId);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
