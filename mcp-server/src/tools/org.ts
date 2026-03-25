import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PrismClient } from "../client.js";

export function registerOrgTools(server: McpServer, client: PrismClient) {
  server.tool(
    "get_org_info",
    "Get organization profile information including name, industry, website, and broker details.",
    {},
    async () => {
      const result = await client.getOrgInfo();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
