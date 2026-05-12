import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GlassClient } from "../client.js";

export function registerBrokerTools(server: McpServer, client: GlassClient) {
  server.tool(
    "list_clients",
    "List clients visible to the broker. Broker only.",
    { brokerOrgId: z.string().optional() },
    async ({ brokerOrgId }) => {
      const data = await client.get("/mcp/broker/clients/list", brokerOrgId ? { brokerOrgId } : {});
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "get_client",
    "Get client org summary and policy count. Broker only.",
    { clientOrgId: z.string() },
    async ({ clientOrgId }) => {
      const data = await client.get("/mcp/broker/clients/get", { clientOrgId });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "list_broker_activity",
    "List broker portfolio activity feed.",
    {
      clientOrgId: z.string().optional(),
      since: z.number().optional(),
      types: z.array(z.string()).optional(),
    },
    async (args) => {
      const data = await client.get("/mcp/broker/activity/list", args as Record<string, unknown>);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );
}
