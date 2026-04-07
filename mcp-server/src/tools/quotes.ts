import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PrismClient } from "../client.js";

export function registerQuoteTools(server: McpServer, client: PrismClient) {
  server.tool(
    "list_quotes",
    "List insurance quotes. Optionally filter by carrier or year.",
    {
      carrier: z.string().optional().describe("Filter by carrier name"),
      year: z.string().optional().describe("Filter by quote year (e.g. '2024')"),
    },
    async ({ carrier, year }) => {
      const result = await client.listQuotes({ carrier, year });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "get_quote",
    "Get full details of a specific insurance quote by ID, including proposed coverages and terms. Quotes are stored in the policies table with documentType='quote'.",
    {
      id: z.string().describe("The quote ID (a policies table ID)"),
    },
    async ({ id }) => {
      const result = await client.getQuote(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
