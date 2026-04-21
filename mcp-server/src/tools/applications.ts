import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GlassClient } from "../client.js";

export function registerApplicationTools(server: McpServer, client: GlassClient) {
  server.tool(
    "list_applications",
    "List insurance application sessions with their status and progress.",
    {},
    async () => {
      const result = await client.listApplications();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "get_application",
    "Get full details of an application session including extracted fields and question batches.",
    {
      id: z.string().describe("The application session ID"),
    },
    async ({ id }) => {
      const result = await client.getApplication(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
