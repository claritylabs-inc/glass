import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GlassClient } from "../client.js";

export function registerClientTools(server: McpServer, client: GlassClient) {
  server.tool(
    "get_passport",
    "Get the full passport for the caller's client org. Client only.",
    {},
    async () => {
      const data = await client.get("/mcp/client/passport/get", {});
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "update_passport",
    "Update passport fields. Client only. Write scope required.",
    { patch: z.record(z.string(), z.any()) },
    async ({ patch }) => {
      const data = await client.post("/mcp/client/passport/update", { patch });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "answer_application_question",
    "Upsert an answer to an application question. Client only. Write scope required.",
    {
      applicationId: z.string(),
      questionId: z.string(),
      rowKey: z.string().optional(),
      value: z.unknown(),
    },
    async (args) => {
      const data = await client.post("/mcp/client/applications/answer", args as Record<string, unknown>);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "submit_application_section",
    "Submit a section of an application for broker review. Client only. Write scope required.",
    { applicationId: z.string(), groupId: z.string() },
    async (args) => {
      const data = await client.post("/mcp/client/applications/submit-section", args as Record<string, unknown>);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

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
