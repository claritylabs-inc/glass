import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GlassClient } from "../client.js";

export function registerContextTools(server: McpServer, client: GlassClient) {
  server.tool(
    "get_business_context",
    "Get the organization's stored business context entries used for auto-filling applications.",
    {},
    async () => {
      const result = await client.listBusinessContext();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "update_business_context",
    "Create or update a business context entry. Used to store reusable company data for application auto-fill.",
    {
      category: z
        .string()
        .describe("Category: company_info, operations, financial, coverage, loss_history, or custom"),
      key: z.string().describe("Normalized field name (e.g. 'annual_revenue', 'employee_count')"),
      value: z.string().describe("The value to store"),
    },
    async ({ category, key, value }) => {
      await client.upsertBusinessContext(category, key, value);
      return {
        content: [{ type: "text" as const, text: `Updated business context: ${category}/${key}` }],
      };
    },
  );
}
