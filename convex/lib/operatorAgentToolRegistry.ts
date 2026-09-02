import { z } from "zod";
import {
  GENERATE_COI_DESCRIPTION,
  generateCoiInputSchema,
  LOOKUP_ADDRESS_DESCRIPTION,
  lookupAddressInputSchema,
} from "./chatTools";

export type OperatorToolEffect =
  | "read"
  | "reversible_write"
  | "external_send"
  | "access_change"
  | "global_change"
  | "destructive";

export type OperatorToolRole = "operator" | "owner";
export type OperatorToolExecution = "mutation" | "action";

export type OperatorToolTarget = {
  kind?: string;
  id?: string;
};

type OperatorToolSpec<TSchema extends z.ZodType> = {
  version: number;
  description: string;
  inputSchema: TSchema;
  capability: string;
  effect: OperatorToolEffect;
  requiredRole: OperatorToolRole;
  confirmation: "none" | "exact";
  execution?: OperatorToolExecution;
  target: (input: z.infer<TSchema>) => OperatorToolTarget;
  summarize: (input: z.infer<TSchema>) => string;
};

function defineOperatorTool<TSchema extends z.ZodType>(
  spec: OperatorToolSpec<TSchema>,
) {
  return { ...spec, execution: spec.execution ?? "mutation" };
}

const organizationId = z.string().min(1).describe("Exact organization ID");
const policyId = z.string().min(1).describe("Exact policy ID");
const clientFileId = z.string().min(1).describe("Exact client file ID");
const orgMemoryId = z.string().min(1).describe("Exact company memory ID");
const procurementMemoryId = z
  .string()
  .min(1)
  .describe("Exact procurement memory ID");
const procurementRequestId = z
  .string()
  .min(1)
  .describe("Exact procurement request ID");
const procurementOutreachId = z
  .string()
  .min(1)
  .describe("Exact procurement broker outreach ID");
const procurementFileItemId = z
  .string()
  .min(1)
  .describe("Exact procurement file item ID");
const procurementEmailThreadId = z
  .string()
  .min(1)
  .describe("Exact procurement email thread ID");
const procurementProposalId = z
  .string()
  .min(1)
  .describe("Exact private procurement proposal ID");
const procurementProposalReviewId = z
  .string()
  .min(1)
  .describe("Exact procurement proposal review ID");
const procurementRequestStatus = z.enum([
  "draft",
  "submitted",
  "gathering_information",
  "marketing",
  "proposal_review",
  "binding",
  "completed",
  "cancelled",
]);
const procurementProposalConclusion = z.enum([
  "meets_requirements",
  "has_gaps",
  "insufficient_evidence",
]);
const brokerNetworkStatus = z.enum(["prospect", "active", "inactive"]);
const brokerOfficeAddress = z.object({
  street1: z.string().max(300).optional(),
  street2: z.string().max(300).optional(),
  city: z.string().max(200).optional(),
  state: z.string().max(100).optional(),
  postalCode: z.string().max(40).optional(),
  country: z.string().max(100).optional(),
});
const procurementOutreachStatus = z.enum([
  "request_sent",
  "can_handle",
  "cannot_handle",
  "quote_received",
  "quote_accepted",
  "quote_rejected",
]);
const procurementFilePurpose = z.enum([
  "requirements",
  "application",
  "requested_document",
  "quote",
  "correspondence",
  "other",
]);
const procurementFileStatus = z.enum([
  "requested",
  "available",
  "sent",
  "received",
]);
const procurementEmailCategory = z.enum([
  "broker",
  "client",
  "internal",
  "mixed",
  "other",
]);
const procurementMemoryKind = z.enum([
  "placement_preference",
  "broker_appetite",
  "submission_requirement",
  "market_observation",
]);

export const OPERATOR_AGENT_TOOL_REGISTRY = {
  search_organizations: defineOperatorTool({
    version: 1,
    description:
      "Search Spot customer and broker organizations. Use this to resolve an exact organization ID before any organization write.",
    inputSchema: z.object({
      query: z.string().max(200).optional(),
      type: z.enum(["broker", "client"]).optional(),
      limit: z.number().int().min(1).max(25).optional(),
    }),
    capability: "operator.organizations.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: () => ({}),
    summarize: (input) =>
      `Search organizations${input.query ? ` for “${input.query}”` : ""}`,
  }),
  get_organization: defineOperatorTool({
    version: 1,
    description:
      "Get current organization profile, lifecycle, feature flags, membership count, and policy count by exact organization ID.",
    inputSchema: z.object({ orgId: organizationId }),
    capability: "operator.organizations.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) => `Read organization ${input.orgId}`,
  }),
  get_operator_overview: defineOperatorTool({
    version: 1,
    description:
      "Get a compact platform overview with organization, policy, extraction, and operator-agent run counts.",
    inputSchema: z.object({}),
    capability: "operator.platform.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: () => ({ kind: "platform", id: "spot" }),
    summarize: () => "Read the operator platform overview",
  }),
  list_policies: defineOperatorTool({
    version: 1,
    description:
      "List or search policies for one exact organization, including extraction stage and operational status.",
    inputSchema: z.object({
      orgId: organizationId,
      query: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(25).optional(),
      includeArchived: z.boolean().optional(),
    }),
    capability: "operator.policies.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) => `List policies for organization ${input.orgId}`,
  }),
  lookup_policy: defineOperatorTool({
    version: 1,
    description:
      "Look up rich, current policy summaries for one exact client organization by exact IDs, carrier, policy number, line of business, keywords, or expiration window.",
    inputSchema: z.object({
      orgId: organizationId,
      query: z.string().max(200).optional(),
      policyIds: z.array(policyId).max(5).optional(),
      expiringWithinDays: z.number().int().min(1).max(365).optional(),
      lineOfBusiness: z.string().max(200).optional(),
      carrier: z.string().max(200).optional(),
    }),
    capability: "operator.policies.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) => `Look up policies for organization ${input.orgId}`,
  }),
  compare_coverages: defineOperatorTool({
    version: 1,
    description:
      "Compare two policies in one exact client organization side by side, including lines of business, limits, deductibles, and premium.",
    inputSchema: z.object({
      orgId: organizationId,
      policyId1: policyId,
      policyId2: policyId,
    }),
    capability: "operator.policies.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) =>
      `Compare policies ${input.policyId1} and ${input.policyId2}`,
  }),
  lookup_policy_section: defineOperatorTool({
    version: 1,
    description:
      "Search one final policy's source-native outline and original PDF evidence for exact wording, forms, endorsements, exclusions, conditions, definitions, or declarations.",
    inputSchema: z.object({
      orgId: organizationId,
      policyId,
      query: z.string().min(1).max(500),
    }),
    capability: "operator.policies.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: (input) => ({ kind: "policy", id: input.policyId }),
    summarize: (input) => `Search source evidence for policy ${input.policyId}`,
  }),
  attach_policy_document: defineOperatorTool({
    version: 1,
    description:
      "Attach the original full PDF for one exact final policy to the operator conversation.",
    inputSchema: z.object({ orgId: organizationId, policyId }),
    capability: "operator.policies.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: (input) => ({ kind: "policy", id: input.policyId }),
    summarize: (input) => `Attach original policy ${input.policyId}`,
  }),
  confirm_policy_fact: defineOperatorTool({
    version: 1,
    description:
      "Confirm a policy fact from exact original-PDF source span IDs and optionally update the supported top-level extracted fields.",
    inputSchema: z.object({
      orgId: organizationId,
      policyId,
      fact: z.string().min(1).max(2_000),
      sourceSpanIds: z.array(z.string().min(1)).min(1).max(50),
      fieldUpdates: z
        .object({
          carrier: z.string().optional(),
          security: z.string().optional(),
          generalAgentName: z.string().optional(),
          broker: z.string().optional(),
          policyNumber: z.string().optional(),
          effectiveDate: z.string().optional(),
          expirationDate: z.string().optional(),
          insuredName: z.string().optional(),
          premium: z.string().optional(),
          totalCost: z.string().optional(),
          minPremium: z.string().optional(),
          depositPremium: z.string().optional(),
          summary: z.string().optional(),
        })
        .optional(),
    }),
    capability: "operator.policies.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    execution: "action",
    target: (input) => ({ kind: "policy", id: input.policyId }),
    summarize: (input) =>
      `Confirm source-backed fact for policy ${input.policyId}`,
  }),
  lookup_compliance_requirements: defineOperatorTool({
    version: 1,
    description:
      "Look up saved insurance coverage requirements for one exact client organization, including requirement and source IDs usable for certificate generation.",
    inputSchema: z.object({
      orgId: organizationId,
      query: z.string().max(500).optional(),
      scope: z.enum(["vendors", "own_org", "all"]).optional(),
    }),
    capability: "operator.compliance.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) =>
      `Look up compliance requirements for organization ${input.orgId}`,
  }),
  search_thread_history: defineOperatorTool({
    version: 1,
    description:
      "Search older messages in this exact operator conversation when relevant context is outside the recent prompt window.",
    inputSchema: z.object({
      query: z.string().min(2).max(500),
      limit: z.number().int().min(1).max(8).optional(),
    }),
    capability: "operator.threads.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: () => ({ kind: "operator_thread" }),
    summarize: (input) =>
      `Search this operator thread for ${JSON.stringify(input.query)}`,
  }),
  read_thread_attachment: defineOperatorTool({
    version: 1,
    description:
      "Reopen one attachment from an older message in this exact operator conversation using the exact message ID and filename returned by search_thread_history.",
    inputSchema: z.object({
      messageId: z.string().min(1),
      filename: z.string().min(1).max(500),
    }),
    capability: "operator.threads.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: (input) => ({ kind: "operator_message", id: input.messageId }),
    summarize: (input) =>
      `Read ${JSON.stringify(input.filename)} from operator history`,
  }),
  list_client_files: defineOperatorTool({
    version: 1,
    description:
      "List the files held for one exact client organization, including provenance, client visibility, and optional policy association.",
    inputSchema: z.object({
      orgId: organizationId,
      limit: z.number().int().min(1).max(100).optional(),
    }),
    capability: "operator.client_files.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) => `List client files for organization ${input.orgId}`,
  }),
  read_client_file: defineOperatorTool({
    version: 1,
    description:
      "Read bounded extracted text from one exact client file, including private operator-only files.",
    inputSchema: z.object({ clientFileId }),
    capability: "operator.client_files.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: (input) => ({ kind: "client_file", id: input.clientFileId }),
    summarize: (input) => `Read client file ${input.clientFileId}`,
  }),
  attach_client_file: defineOperatorTool({
    version: 1,
    description:
      "Attach one exact client file to the operator conversation, including private operator-only files.",
    inputSchema: z.object({ clientFileId }),
    capability: "operator.client_files.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: (input) => ({ kind: "client_file", id: input.clientFileId }),
    summarize: (input) => `Attach client file ${input.clientFileId}`,
  }),
  lookup_client_memory: defineOperatorTool({
    version: 1,
    description:
      "Look up durable company-profile facts for one exact client organization. Never use this for policy or workflow facts.",
    inputSchema: z.object({
      orgId: organizationId,
      query: z.string().max(500).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    capability: "operator.memory.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) =>
      `Look up company memory for organization ${input.orgId}`,
  }),
  create_client_memory: defineOperatorTool({
    version: 1,
    description:
      "Create one durable stable company-profile fact for an exact client. Policy, certificate, email, and workflow facts are rejected.",
    inputSchema: z.object({
      orgId: organizationId,
      content: z.string().min(1).max(280),
    }),
    capability: "operator.memory.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) =>
      `Create company memory for organization ${input.orgId}`,
  }),
  update_client_memory: defineOperatorTool({
    version: 1,
    description: "Update one exact durable company-memory fact.",
    inputSchema: z.object({
      memoryId: orgMemoryId,
      content: z.string().min(1).max(280),
    }),
    capability: "operator.memory.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({ kind: "organization_memory", id: input.memoryId }),
    summarize: (input) => `Update company memory ${input.memoryId}`,
  }),
  delete_client_memory: defineOperatorTool({
    version: 1,
    description: "Permanently delete one exact durable company-memory fact.",
    inputSchema: z.object({ memoryId: orgMemoryId }),
    capability: "operator.memory.write",
    effect: "destructive",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({ kind: "organization_memory", id: input.memoryId }),
    summarize: (input) => `Delete company memory ${input.memoryId}`,
  }),
  lookup_procurement_memory: defineOperatorTool({
    version: 1,
    description:
      "Look up durable procurement learnings for one exact client, optionally filtered by request, kind, or text.",
    inputSchema: z.object({
      orgId: organizationId,
      procurementRequestId: procurementRequestId.optional(),
      kind: procurementMemoryKind.optional(),
      query: z.string().max(500).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    capability: "operator.procurement.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) =>
      `Look up procurement memory for organization ${input.orgId}`,
  }),
  create_procurement_memory: defineOperatorTool({
    version: 1,
    description:
      "Create one durable client-scoped procurement learning with optional request, outreach, and broker provenance.",
    inputSchema: z.object({
      orgId: organizationId,
      kind: procurementMemoryKind,
      content: z.string().min(1).max(2_000),
      procurementRequestId: procurementRequestId.optional(),
      procurementOutreachId: procurementOutreachId.optional(),
      brokerOrgId: organizationId.optional(),
      sourceRef: z.string().max(500).optional(),
      confidence: z.number().min(0).max(1).optional(),
    }),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) =>
      `Create procurement memory for organization ${input.orgId}`,
  }),
  update_procurement_memory: defineOperatorTool({
    version: 1,
    description:
      "Update one exact procurement learning and its optional provenance links.",
    inputSchema: z
      .object({
        procurementMemoryId,
        kind: procurementMemoryKind.optional(),
        content: z.string().min(1).max(2_000).optional(),
        procurementRequestId: procurementRequestId.nullable().optional(),
        procurementOutreachId: procurementOutreachId.nullable().optional(),
        brokerOrgId: organizationId.nullable().optional(),
        confidence: z.number().min(0).max(1).nullable().optional(),
      })
      .refine(
        (input) =>
          Object.keys(input).some((key) => key !== "procurementMemoryId"),
        "At least one procurement memory field is required",
      ),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_memory",
      id: input.procurementMemoryId,
    }),
    summarize: (input) =>
      `Update procurement memory ${input.procurementMemoryId}`,
  }),
  delete_procurement_memory: defineOperatorTool({
    version: 1,
    description: "Permanently delete one exact procurement learning.",
    inputSchema: z.object({ procurementMemoryId }),
    capability: "operator.procurement.write",
    effect: "destructive",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_memory",
      id: input.procurementMemoryId,
    }),
    summarize: (input) =>
      `Delete procurement memory ${input.procurementMemoryId}`,
  }),
  list_procurement_requests: defineOperatorTool({
    version: 1,
    description:
      "List new-policy procurement requests for one exact client organization, including requirements, request-specific forwarding addresses, policy links, broker progress, files, and imported-email counts.",
    inputSchema: z.object({
      orgId: organizationId,
      query: z.string().max(200).optional(),
      status: procurementRequestStatus.optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    capability: "operator.procurement.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) =>
      `List procurement requests for organization ${input.orgId}`,
  }),
  get_procurement_request: defineOperatorTool({
    version: 1,
    description:
      "Get one exact procurement request with client requirements, replacement/result policy links, request forwarding address, broker outreach/application/quote state, requested files, linked client files with upload or procurement-email provenance, and imported email threads.",
    inputSchema: z.object({ procurementRequestId }),
    capability: "operator.procurement.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `Read procurement request ${input.procurementRequestId}`,
  }),
  list_procurement_proposals: defineOperatorTool({
    version: 1,
    description:
      "List every operator-private proposal for one exact procurement request, including broker, documents, extracted offer facts, revision lineage, and reviews. Never expose this output to a client or broker.",
    inputSchema: z.object({ procurementRequestId }),
    capability: "operator.procurement.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `List private proposals for procurement request ${input.procurementRequestId}`,
  }),
  get_procurement_proposal: defineOperatorTool({
    version: 1,
    description:
      "Read one exact operator-private proposal with its broker, outreach, documents, extracted offer, source-backed reviews, and revision lineage.",
    inputSchema: z.object({ procurementProposalId }),
    capability: "operator.procurement.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({
      kind: "procurement_proposal",
      id: input.procurementProposalId,
    }),
    summarize: (input) =>
      `Read private procurement proposal ${input.procurementProposalId}`,
  }),
  get_broker_network_profile: defineOperatorTool({
    version: 1,
    description:
      "Read one exact supplier-network broker profile, including neutral organization identity, office, writing states, exact ACORD LOBCd values, portal contacts, last outreach, and proposal count.",
    inputSchema: z.object({ brokerOrgId: organizationId }),
    capability: "operator.organizations.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({ kind: "organization", id: input.brokerOrgId }),
    summarize: (input) => `Read broker network profile ${input.brokerOrgId}`,
  }),
  list_broker_network_profiles: defineOperatorTool({
    version: 1,
    description:
      "Search the supplier-network broker directory by neutral identity, status, USPS writing state, or exact ACORD LOBCd value.",
    inputSchema: z.object({
      query: z.string().max(200).optional(),
      status: brokerNetworkStatus.optional(),
      writingState: z.string().min(2).max(2).optional(),
      lineOfBusinessCode: z.string().min(1).max(40).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    capability: "operator.organizations.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: () => ({ kind: "platform", id: "broker-network" }),
    summarize: (input) =>
      `Search broker network${input.query ? ` for ${JSON.stringify(input.query)}` : ""}`,
  }),
  get_procurement_forwarding_address: defineOperatorTool({
    version: 1,
    description:
      "Get the unique forwarding address for one exact procurement request. Email forwarded to this address imports into that request without invoking the client email agent.",
    inputSchema: z.object({ procurementRequestId }),
    capability: "operator.procurement.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `Read the forwarding address for procurement request ${input.procurementRequestId}`,
  }),
  list_procurement_email_threads: defineOperatorTool({
    version: 1,
    description:
      "List imported forwarding-email threads for one exact procurement request, including recipient-based category, original addressed request, current request, participants, and message counts.",
    inputSchema: z.object({
      procurementRequestId,
      limit: z.number().int().min(1).max(100).optional(),
    }),
    capability: "operator.procurement.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `List email threads for procurement request ${input.procurementRequestId}`,
  }),
  get_procurement_email_thread: defineOperatorTool({
    version: 1,
    description:
      "Get one imported procurement email thread with bounded message bodies, envelope and forwarded participants, recipient category, original request address, and linked client-file attachments.",
    inputSchema: z.object({ procurementEmailThreadId }),
    capability: "operator.procurement.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({
      kind: "procurement_email_thread",
      id: input.procurementEmailThreadId,
    }),
    summarize: (input) =>
      `Read procurement email thread ${input.procurementEmailThreadId}`,
  }),
  get_policy_status: defineOperatorTool({
    version: 1,
    description:
      "Get one policy's current extraction, source-tree, reconciliation, and archive status by exact policy ID.",
    inputSchema: z.object({ policyId }),
    capability: "operator.policies.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({ kind: "policy", id: input.policyId }),
    summarize: (input) => `Read policy status ${input.policyId}`,
  }),
  lookup_address: defineOperatorTool({
    version: 1,
    description: LOOKUP_ADDRESS_DESCRIPTION,
    inputSchema: lookupAddressInputSchema,
    capability: "operator.addresses.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: () => ({ kind: "address" }),
    summarize: (input) => `Validate address ${JSON.stringify(input.query)}`,
  }),
  list_extraction_issues: defineOperatorTool({
    version: 1,
    description:
      "List bounded policy extraction failures, paused runs, or active queue work, optionally scoped to one exact organization.",
    inputSchema: z.object({
      orgId: organizationId.optional(),
      status: z
        .enum(["error", "paused", "running", "queued", "leased"])
        .optional(),
      limit: z.number().int().min(1).max(25).optional(),
    }),
    capability: "operator.extractions.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) =>
      input.orgId
        ? { kind: "organization", id: input.orgId }
        : { kind: "platform", id: "extractions" },
    summarize: (input) =>
      `List ${input.status ?? "problematic"} extraction work${input.orgId ? ` for organization ${input.orgId}` : ""}`,
  }),
  get_routing_status: defineOperatorTool({
    version: 1,
    description:
      "Get a bounded operational summary of recent model routing outcomes, fallbacks, errors, and configured route freshness without returning provider secrets.",
    inputSchema: z.object({
      task: z.string().min(1).max(100).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    capability: "operator.routing.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: () => ({ kind: "platform", id: "model-routing" }),
    summarize: (input) =>
      `Read recent model routing status${input.task ? ` for ${input.task}` : ""}`,
  }),
  get_channel_health: defineOperatorTool({
    version: 1,
    description:
      "Get bounded Slack and connected-email configuration health without returning credentials or message contents. Omit orgId for platform-wide health, or provide one exact organization ID for a client-scoped result.",
    inputSchema: z.object({
      orgId: organizationId
        .optional()
        .describe(
          "Omit for platform-wide health; provide an exact organization ID to scope the result",
        ),
    }),
    capability: "operator.channels.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) =>
      input.orgId
        ? { kind: "organization", id: input.orgId }
        : { kind: "platform", id: "channels" },
    summarize: (input) =>
      `Read channel health${input.orgId ? ` for organization ${input.orgId}` : ""}`,
  }),
  retry_failed_policy_extraction: defineOperatorTool({
    version: 1,
    description:
      "Queue a fresh full extraction for one exact failed or idle policy. Refuses policies with running or paused extraction work.",
    inputSchema: z.object({ policyId }),
    capability: "operator.extractions.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({ kind: "policy", id: input.policyId }),
    summarize: (input) =>
      `Queue a fresh full extraction for policy ${input.policyId}`,
  }),
  generate_coi: defineOperatorTool({
    version: 1,
    description: GENERATE_COI_DESCRIPTION,
    inputSchema: generateCoiInputSchema,
    capability: "operator.certificates.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    execution: "action",
    target: (input) =>
      input.policyId
        ? { kind: "policy", id: input.policyId }
        : input.requirementSourceDocumentId
          ? {
              kind: "requirement_source",
              id: input.requirementSourceDocumentId,
            }
          : { kind: "requirement", id: input.requirementId },
    summarize: (input) => {
      const holder = input.certificateHolder?.split(/\r?\n/)[0]?.trim();
      const source = input.policyId
        ? `policy ${input.policyId}`
        : input.requirementSourceDocumentId
          ? `requirements source ${input.requirementSourceDocumentId}`
          : `requirement ${input.requirementId ?? "unknown"}`;
      return `Generate COI${holder ? ` for ${JSON.stringify(holder)}` : ""} from ${source}`;
    },
  }),
  add_client_file: defineOperatorTool({
    version: 1,
    description:
      "File one attachment from this operator thread in an exact client organization's shared dropbox, hidden from the client. Use the exact attachment file ID shown in attachment metadata. Infer a concise factual name from the parsed file contents and the operator's prompt, while preserving the original extension. Filing runs immediately; use update_client_file when the operator asks to show a filed document to the client.",
    inputSchema: z.object({
      orgId: organizationId,
      attachmentFileId: z
        .string()
        .min(1)
        .describe(
          "Exact storage ID from this operator thread's attachment metadata, or the exact filename of one attachment in this thread",
        ),
      name: z
        .string()
        .min(1)
        .max(220)
        .describe(
          "Concise factual document name inferred from the file contents and operator prompt",
        ),
      policyId: policyId.nullable().optional(),
    }),
    capability: "operator.client_files.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) =>
      `Add ${JSON.stringify(input.name)} to organization ${input.orgId}${input.policyId ? ` for policy ${input.policyId}` : ""} hidden from the client`,
  }),
  update_client_file: defineOperatorTool({
    version: 1,
    description:
      "Rename a filed client document, change whether the client can see it, or change its optional policy association. Only supplied fields change; null removes a policy association.",
    inputSchema: z
      .object({
        clientFileId,
        name: z.string().min(1).max(220).optional(),
        clientVisible: z.boolean().optional(),
        policyId: policyId.nullable().optional(),
      })
      .refine(
        (input) =>
          input.name !== undefined ||
          input.clientVisible !== undefined ||
          input.policyId !== undefined,
        "At least one client file field is required",
      ),
    capability: "operator.client_files.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({ kind: "client_file", id: input.clientFileId }),
    summarize: (input) => {
      const fields = [
        input.name !== undefined ? `name=${JSON.stringify(input.name)}` : null,
        input.clientVisible !== undefined
          ? `clientVisible=${input.clientVisible}`
          : null,
        input.policyId !== undefined
          ? `policyId=${input.policyId ?? "none"}`
          : null,
      ].filter(Boolean);
      return `Update client file ${input.clientFileId}: ${fields.join(", ")}`;
    },
  }),
  create_procurement_request: defineOperatorTool({
    version: 1,
    description:
      "Create a new-policy procurement request for an exact client and generate its unique forwarding address. Resolve exact policy IDs first when linking a policy being replaced or a resulting policy.",
    inputSchema: z.object({
      orgId: organizationId,
      title: z.string().min(1).max(200),
      requestSummary: z.string().min(1).max(20_000),
      requirements: z.string().min(1).max(20_000),
      targetEffectiveDate: z.string().max(10).optional(),
      status: procurementRequestStatus.optional(),
      clientVisible: z.boolean().optional(),
      replacingPolicyId: policyId
        .describe(
          "Exact existing policy ID returned by a policy read tool. Omit for a new purchase or when no policy is being replaced; never use an organization ID.",
        )
        .optional(),
      resultingPolicyId: policyId
        .describe(
          "Exact bound policy ID returned by a policy read tool. Omit until this procurement request has produced a policy; never use an organization ID.",
        )
        .optional(),
    }),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) => {
      const policyLinks = [
        input.replacingPolicyId
          ? `replacing policy ${input.replacingPolicyId}`
          : null,
        input.resultingPolicyId
          ? `resulting policy ${input.resultingPolicyId}`
          : null,
      ].filter(Boolean);
      return `Create procurement request ${JSON.stringify(input.title)} for organization ${input.orgId}${policyLinks.length ? ` with ${policyLinks.join(" and ")}` : ""}`;
    },
  }),
  update_procurement_request: defineOperatorTool({
    version: 1,
    description:
      "Update supplied fields on one exact procurement request. Null clears an effective date or policy link; omitted fields stay unchanged.",
    inputSchema: z
      .object({
        procurementRequestId,
        title: z.string().min(1).max(200).optional(),
        requestSummary: z.string().min(1).max(20_000).optional(),
        requirements: z.string().min(1).max(20_000).optional(),
        targetEffectiveDate: z.string().max(10).nullable().optional(),
        status: procurementRequestStatus.optional(),
        clientVisible: z.boolean().optional(),
        replacingPolicyId: policyId.nullable().optional(),
        resultingPolicyId: policyId.nullable().optional(),
      })
      .refine(
        (input) =>
          Object.keys(input).some((key) => key !== "procurementRequestId"),
        "At least one procurement request field is required",
      ),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `Update procurement request ${input.procurementRequestId}`,
  }),
  create_procurement_proposal: defineOperatorTool({
    version: 1,
    description:
      "Create one operator-private proposal for an exact procurement request, broker organization, and matching outreach. A revision may reference the exact superseded proposal.",
    inputSchema: z.object({
      procurementRequestId,
      brokerOrgId: organizationId,
      procurementOutreachId,
      supersedesProposalId: procurementProposalId.optional(),
    }),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `Create a private proposal for procurement request ${input.procurementRequestId} from broker ${input.brokerOrgId}`,
  }),
  confirm_procurement_proposal_review: defineOperatorTool({
    version: 1,
    description:
      "Confirm or override only the overall conclusion of one exact current source-backed proposal review. Findings and evidence remain model-authored and auditable.",
    inputSchema: z.object({
      procurementProposalReviewId,
      conclusion: procurementProposalConclusion,
    }),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_proposal_review",
      id: input.procurementProposalReviewId,
    }),
    summarize: (input) =>
      `Confirm proposal review ${input.procurementProposalReviewId} as ${input.conclusion}`,
  }),
  select_procurement_proposal: defineOperatorTool({
    version: 1,
    description:
      "Select one exact private proposal only after revalidating a current staff-confirmed review that meets every requirement; prior selected proposals on the request are cleared atomically.",
    inputSchema: z.object({ procurementProposalId }),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_proposal",
      id: input.procurementProposalId,
    }),
    summarize: (input) =>
      `Select procurement proposal ${input.procurementProposalId}`,
  }),
  update_broker_network_profile: defineOperatorTool({
    version: 1,
    description:
      "Update supplied fields on one exact supplier-network broker profile. Writing states use USPS abbreviations and lines use exact ACORD LOBCd values; omitted fields remain unchanged.",
    inputSchema: z
      .object({
        brokerOrgId: organizationId,
        networkStatus: brokerNetworkStatus.optional(),
        officeAddress: brokerOfficeAddress.optional(),
        writingStates: z.array(z.string().min(2).max(2)).max(60).optional(),
        lineOfBusinessCodes: z
          .array(z.string().min(1).max(40))
          .max(100)
          .optional(),
        name: z.string().min(1).max(200).optional(),
        website: z.string().max(2_000).nullable().optional(),
      })
      .refine(
        (input) => Object.keys(input).some((key) => key !== "brokerOrgId"),
        "At least one broker profile field is required",
      ),
    capability: "operator.organizations.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({ kind: "organization", id: input.brokerOrgId }),
    summarize: (input) => `Update broker network profile ${input.brokerOrgId}`,
  }),
  create_procurement_broker_outreach: defineOperatorTool({
    version: 1,
    description:
      "Add a real broker-network organization to an exact procurement request and preserve the selected contact snapshot and application context.",
    inputSchema: z.object({
      procurementRequestId,
      brokerOrgId: organizationId,
      contactName: z.string().max(200).optional(),
      contactEmail: z.string().max(320).optional(),
      contactPhone: z.string().max(100).optional(),
      status: procurementOutreachStatus.optional(),
      applicationUrl: z.string().max(2_000).optional(),
      applicationQuestions: z.array(z.string().max(1_000)).max(100).optional(),
      notes: z.string().max(20_000).optional(),
    }),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `Add broker ${input.brokerOrgId} to procurement request ${input.procurementRequestId}`,
  }),
  update_procurement_broker_outreach: defineOperatorTool({
    version: 1,
    description:
      "Update supplied broker outreach fields, including its exact workflow status, broker/contact snapshot, application link/questions, and notes. File quote documents as private proposals instead of writing quote fields on outreach.",
    inputSchema: z
      .object({
        procurementOutreachId,
        brokerOrgId: organizationId.optional(),
        contactName: z.string().max(200).nullable().optional(),
        contactEmail: z.string().max(320).nullable().optional(),
        contactPhone: z.string().max(100).nullable().optional(),
        status: procurementOutreachStatus.optional(),
        applicationUrl: z.string().max(2_000).nullable().optional(),
        applicationQuestions: z
          .array(z.string().max(1_000))
          .max(100)
          .optional(),
        notes: z.string().max(20_000).nullable().optional(),
      })
      .refine(
        (input) =>
          Object.keys(input).some((key) => key !== "procurementOutreachId"),
        "At least one broker outreach field is required",
      ),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_broker_outreach",
      id: input.procurementOutreachId,
    }),
    summarize: (input) =>
      `Update procurement broker outreach ${input.procurementOutreachId}`,
  }),
  create_procurement_file_item: defineOperatorTool({
    version: 1,
    description:
      "Track an application, outstanding broker-requested document, quote, requirements file, or other procurement file. A client file ID is optional so requested documents can be tracked before they are available.",
    inputSchema: z.object({
      procurementRequestId,
      procurementOutreachId: procurementOutreachId.optional(),
      clientFileId: clientFileId.optional(),
      purpose: procurementFilePurpose,
      label: z.string().min(1).max(300),
      status: procurementFileStatus.optional(),
      notes: z.string().max(20_000).optional(),
    }),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `Add ${input.purpose} ${JSON.stringify(input.label)} to procurement request ${input.procurementRequestId}`,
  }),
  update_procurement_file_item: defineOperatorTool({
    version: 1,
    description:
      "Update a procurement file requirement or link. Null removes the linked outreach, shared client file, or notes without deleting the underlying client file.",
    inputSchema: z
      .object({
        procurementFileItemId,
        procurementOutreachId: procurementOutreachId.nullable().optional(),
        clientFileId: clientFileId.nullable().optional(),
        purpose: procurementFilePurpose.optional(),
        label: z.string().min(1).max(300).optional(),
        status: procurementFileStatus.optional(),
        notes: z.string().max(20_000).nullable().optional(),
      })
      .refine(
        (input) =>
          Object.keys(input).some((key) => key !== "procurementFileItemId"),
        "At least one procurement file field is required",
      ),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_file_item",
      id: input.procurementFileItemId,
    }),
    summarize: (input) =>
      `Update procurement file item ${input.procurementFileItemId}`,
  }),
  update_procurement_email_thread: defineOperatorTool({
    version: 1,
    description:
      "Correct the recipient-based category or assigned request for an imported procurement email thread. Request moves are limited to another request for the same client; the originally addressed request remains immutable.",
    inputSchema: z
      .object({
        procurementEmailThreadId,
        category: procurementEmailCategory.optional(),
        procurementRequestId: procurementRequestId.optional(),
      })
      .refine(
        (input) =>
          input.category !== undefined ||
          input.procurementRequestId !== undefined,
        "A category or procurement request is required",
      ),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_email_thread",
      id: input.procurementEmailThreadId,
    }),
    summarize: (input) =>
      `Update procurement email thread ${input.procurementEmailThreadId}`,
  }),
  update_organization_profile: defineOperatorTool({
    version: 1,
    description:
      "Update selected editable profile fields for one exact organization. Only supplied fields change.",
    inputSchema: z
      .object({
        orgId: organizationId,
        name: z.string().min(1).max(200).optional(),
        website: z.string().max(500).nullable().optional(),
        industry: z.string().max(200).nullable().optional(),
        industryVertical: z.string().max(200).nullable().optional(),
      })
      .refine(
        (input) =>
          input.name !== undefined ||
          input.website !== undefined ||
          input.industry !== undefined ||
          input.industryVertical !== undefined,
        "At least one profile field is required",
      ),
    capability: "operator.organizations.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) => {
      const fields = [
        input.name !== undefined ? `name=${JSON.stringify(input.name)}` : null,
        input.website !== undefined
          ? `website=${JSON.stringify(input.website)}`
          : null,
        input.industry !== undefined
          ? `industry=${JSON.stringify(input.industry)}`
          : null,
        input.industryVertical !== undefined
          ? `industryVertical=${JSON.stringify(input.industryVertical)}`
          : null,
      ].filter(Boolean);
      return `Update organization ${input.orgId}: ${fields.join(", ")}`;
    },
  }),
  set_organization_status: defineOperatorTool({
    version: 1,
    description:
      "Set the internal operator lifecycle of one exact broker or client organization.",
    inputSchema: z.object({
      orgId: organizationId,
      status: z.enum(["onboarding", "live"]),
    }),
    capability: "operator.organizations.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) =>
      `Set organization ${input.orgId} status to ${input.status}`,
  }),
  set_client_feature_flag: defineOperatorTool({
    version: 1,
    description:
      "Enable or disable one supported Spot feature flag for an exact client organization.",
    inputSchema: z.object({
      orgId: organizationId,
      flagId: z.enum([
        "connect_features",
        "coverage_recovery_v2",
        "imessage_app_cards",
      ]),
      enabled: z.boolean(),
    }),
    capability: "operator.organizations.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) =>
      `${input.enabled ? "Enable" : "Disable"} ${input.flagId} for organization ${input.orgId}`,
  }),
  clear_all_agent_memory: defineOperatorTool({
    version: 1,
    description:
      "Schedule a global purge of organization memory and raw conversation memory. This is owner-only and destructive.",
    inputSchema: z.object({}),
    capability: "operator.platform.destructive",
    effect: "destructive",
    requiredRole: "owner",
    confirmation: "exact",
    target: () => ({ kind: "platform", id: "agent-memory" }),
    summarize: () => "Clear all organization and raw conversation memory",
  }),
} as const;

export type OperatorAgentToolName = keyof typeof OPERATOR_AGENT_TOOL_REGISTRY;

export type ResolvedOperatorToolSpec = {
  version: number;
  description: string;
  inputSchema: z.ZodType;
  capability: string;
  effect: OperatorToolEffect;
  requiredRole: OperatorToolRole;
  confirmation: "none" | "exact";
  execution: OperatorToolExecution;
  target: (input: Record<string, unknown>) => OperatorToolTarget;
  summarize: (input: Record<string, unknown>) => string;
};

export function isOperatorAgentToolName(
  value: string,
): value is OperatorAgentToolName {
  return value in OPERATOR_AGENT_TOOL_REGISTRY;
}

export function getOperatorAgentToolSpec(
  name: string,
): ResolvedOperatorToolSpec {
  if (!isOperatorAgentToolName(name)) {
    throw new Error(`Unknown operator tool: ${name}`);
  }
  return OPERATOR_AGENT_TOOL_REGISTRY[
    name
  ] as unknown as ResolvedOperatorToolSpec;
}

export function parseOperatorAgentToolInput(
  name: string,
  input: unknown,
): Record<string, unknown> {
  return getOperatorAgentToolSpec(name).inputSchema.parse(input) as Record<
    string,
    unknown
  >;
}

export function operatorAgentToolCatalog() {
  return Object.entries(OPERATOR_AGENT_TOOL_REGISTRY).map(([name, spec]) => ({
    name: name as OperatorAgentToolName,
    version: spec.version,
    description: spec.description,
    capability: spec.capability,
    effect: spec.effect,
    requiredRole: spec.requiredRole,
    confirmation: spec.confirmation,
    execution: spec.execution,
  }));
}

export function operatorAgentToolJsonCatalog() {
  return Object.entries(OPERATOR_AGENT_TOOL_REGISTRY).map(([name, spec]) => ({
    name: name as OperatorAgentToolName,
    version: spec.version,
    description: spec.description,
    inputSchema: z.toJSONSchema(spec.inputSchema) as Record<string, unknown>,
    capability: spec.capability,
    effect: spec.effect,
    requiredRole: spec.requiredRole,
    confirmation: spec.confirmation,
    execution: spec.execution,
  }));
}
