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
    "get_policy_pdf",
    "Get a temporary download URL for the original full policy PDF document by policy ID.",
    {
      id: z.string().describe("The policy ID"),
    },
    async ({ id }) => {
      const result = await client.getPolicyPdf(id);
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

  server.tool(
    "list_policy_certificates",
    "List generated informational Certificates of Insurance for a policy, including download URLs and request metadata.",
    {
      policyId: z.string().describe("The policy ID"),
    },
    async ({ policyId }) => {
      const result = await client.listPolicyCertificates(policyId);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "generate_policy_certificate",
    "Generate or retrieve an informational Certificate of Insurance PDF for a policy. Same holder/current policy version returns an existing certificate unless explicitReissue is true. Additional-insured requests generate only when policy evidence supports them; otherwise they create a broker follow-up. Requires write scope.",
    {
      policyId: z.string().describe("The policy ID"),
      holderName: z.string().describe("Certificate holder name"),
      holderEmail: z.string().optional().describe("Certificate holder email for renewal delivery"),
      holderPhone: z.string().optional().describe("Certificate holder phone for renewal delivery"),
      addressLine1: z.string().optional().describe("Certificate holder street address"),
      addressLine2: z.string().optional().describe("Suite, floor, or attention line"),
      city: z.string().optional().describe("Certificate holder city"),
      state: z.string().optional().describe("Certificate holder state"),
      postalCode: z.string().optional().describe("Certificate holder ZIP or postal code"),
      requestText: z.string().optional().describe("Full certificate request, including endorsement or special wording language"),
      requestedEndorsements: z.array(z.string()).optional().describe("Requested certificate endorsements or special wording"),
      additionalInsuredName: z.string().optional().describe("Requested additional insured name when applicable"),
      explicitReissue: z.boolean().optional().describe("Force a new certificate version when an active one already exists for this holder/current policy version"),
    },
    async (input) => {
      const result = await client.generatePolicyCertificate(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "list_certificate_holders",
    "List/search the organization certificate holder registry.",
    { query: z.string().optional().describe("Optional holder name, email, or address search text") },
    async ({ query }) => {
      const result = await client.listCertificateHolders(query);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "list_policy_versions",
    "List policy document-event versions. Use only when the user explicitly asks for history; current policy answers should use get_policy/list_policies by default.",
    { policyId: z.string().optional().describe("Optional policy ID") },
    async ({ policyId }) => {
      const result = await client.listPolicyVersions(policyId);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "list_certificate_versions",
    "List certificate issue/reissue versions by policy, certificate parent, or holder.",
    {
      policyId: z.string().optional().describe("Optional policy ID"),
      certificateId: z.string().optional().describe("Optional policy certificate parent ID"),
      holderId: z.string().optional().describe("Optional certificate holder ID"),
      certificateHolderId: z.string().optional().describe("Optional alias for holderId"),
    },
    async (filters) => {
      const result = await client.listCertificateVersions(filters);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "list_certificate_review_jobs",
    "List certificate renewal/post-endorsement/manual review jobs.",
    {
      policyId: z.string().optional().describe("Optional policy ID"),
      status: z.string().optional().describe("Optional review job status"),
    },
    async (filters) => {
      const result = await client.listCertificateReviewJobs(filters);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
