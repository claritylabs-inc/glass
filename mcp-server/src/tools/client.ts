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

  server.tool(
    "list_insurance_requirements",
    "List the caller org's insurance compliance requirements, including source document provenance when available.",
    {},
    async () => {
      const data = await client.get("/api/v1/compliance/requirements", {});
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "create_insurance_requirement",
    "Create an insurance compliance requirement for contractors/vendors. Requires write scope and org admin role. Include sourceDocumentName/sourceExcerpt when creating extracted lease or contract requirements.",
    {
      title: z.string(),
      category: z.enum(["general_liability", "auto", "workers_comp", "umbrella", "professional", "cyber", "property", "other"]),
      requirementText: z.string(),
      sourceDocumentName: z.string().optional(),
      sourceExcerpt: z.string().optional(),
    },
    async ({ title, category, requirementText, sourceDocumentName, sourceExcerpt }) => {
      const data = await client.post("/api/v1/compliance/requirements", {
        title,
        category,
        requirement_text: requirementText,
        source_document_name: sourceDocumentName,
        source_excerpt: sourceExcerpt,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "list_vendor_compliance",
    "List connected vendor compliance status against the caller org's insurance requirements.",
    {},
    async () => {
      const data = await client.get("/api/v1/compliance/vendors", {});
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );
}
