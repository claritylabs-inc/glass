import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GlassClient } from "../client.js";

export function registerClientTools(server: McpServer, client: GlassClient) {
  server.tool(
    "list_connected_vendors",
    "List vendor organizations that approved read-only insurance access for the caller's org.",
    {},
    async () => {
      const data = await client.get("/api/v1/vendors", {});
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "get_connected_vendor",
    "Get a connected vendor org profile and policy count.",
    { vendorOrgId: z.string() },
    async ({ vendorOrgId }) => {
      const data = await client.get(`/api/v1/vendors/${vendorOrgId}`, {});
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "list_connected_vendor_policies",
    "List policies for a connected vendor org that approved access.",
    { vendorOrgId: z.string() },
    async ({ vendorOrgId }) => {
      const data = await client.get(`/api/v1/vendors/${vendorOrgId}/policies`, {});
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "list_my_policies",
    "List policies for the caller's client org. Client only.",
    {},
    async () => {
      const data = await client.get("/mcp/policies/list", {});
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );
}
