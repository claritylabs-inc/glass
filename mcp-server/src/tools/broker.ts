import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PrismClient } from "../client.js";

export function registerBrokerTools(server: McpServer, client: PrismClient) {
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
    "Get passport summary and policy count for a client org. Broker only.",
    { clientOrgId: z.string() },
    async ({ clientOrgId }) => {
      const data = await client.get("/mcp/broker/clients/get", { clientOrgId });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "list_applications_for_client",
    "List applications for a specific client. Broker only.",
    { clientOrgId: z.string(), status: z.string().optional() },
    async ({ clientOrgId, status }) => {
      const data = await client.get("/mcp/broker/applications/list", { clientOrgId, ...(status ? { status } : {}) });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "create_application_draft",
    "Create a new application draft for a client. Broker only. Write scope required.",
    {
      clientOrgId: z.string(),
      creationPath: z.enum(["blank", "template", "upload"]),
      title: z.string(),
      lineOfBusiness: z.string().optional(),
    },
    async (args) => {
      const data = await client.post("/mcp/broker/applications/create", args as Record<string, unknown>);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "add_application_question",
    "Add a question to a draft application. Broker only. Write scope required.",
    {
      applicationId: z.string(),
      intentKey: z.string().optional(),
      customPrompt: z.string().optional(),
      answerType: z.enum(["text", "boolean", "number", "date", "multiselect"]).optional(),
      required: z.boolean().optional(),
    },
    async (args) => {
      const data = await client.post("/mcp/broker/applications/add-question", args as Record<string, unknown>);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "send_application",
    "Send an application to a client. Broker only. Write scope required.",
    { applicationId: z.string() },
    async ({ applicationId }) => {
      const data = await client.post("/mcp/broker/applications/send", { applicationId });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "raise_passport_flag",
    "Raise a flag on a client passport field. Broker only. Write scope required.",
    { clientOrgId: z.string(), fieldPath: z.string(), message: z.string() },
    async (args) => {
      const data = await client.post("/mcp/broker/passport/raise-flag", args as Record<string, unknown>);
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
