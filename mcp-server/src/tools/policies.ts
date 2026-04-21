import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GlassClient } from "../client.js";

export function registerPolicyTools(server: McpServer, client: GlassClient) {
  server.tool(
    "list_policies",
    "List insurance policies. Optionally filter by carrier, year, or policy type.",
    {
      carrier: z.string().optional().describe("Filter by carrier name"),
      year: z.string().optional().describe("Filter by policy year (e.g. '2024')"),
      type: z.string().optional().describe("Filter by policy type (e.g. 'general_liability', 'cyber')"),
    },
    async ({ carrier, year, type }) => {
      const result = await client.listPolicies({ carrier, year, type });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "get_policy",
    "Get full details of a specific insurance policy by ID, including coverages, document sections, and metadata.",
    {
      id: z.string().describe("The policy ID"),
    },
    async ({ id }) => {
      const result = await client.getPolicy(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "search_policies",
    "Search across policies by text query. Searches carrier, policy number, insured name, summary, and policy types.",
    {
      q: z.string().describe("Search query text"),
    },
    async ({ q }) => {
      const result = await client.searchPolicies(q);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "get_policy_stats",
    "Get dashboard statistics for policies: total count, breakdown by type, carrier, and year.",
    {},
    async () => {
      const result = await client.getPolicyStats();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
