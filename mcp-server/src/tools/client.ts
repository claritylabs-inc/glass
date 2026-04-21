import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PrismClient } from "../client.js";

export function registerClientTools(server: McpServer, client: PrismClient) {
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
    "list_my_policies",
    "List policies for the caller's client org. Client only.",
    {},
    async () => {
      const data = await client.get("/mcp/policies/list", {});
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );
}
