import { z } from "zod";

export type OperatorToolEffect =
  | "read"
  | "reversible_write"
  | "external_send"
  | "access_change"
  | "global_change"
  | "destructive";

export type OperatorToolRole = "operator" | "owner";

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
  target: (input: z.infer<TSchema>) => OperatorToolTarget;
  summarize: (input: z.infer<TSchema>) => string;
};

function defineOperatorTool<TSchema extends z.ZodType>(
  spec: OperatorToolSpec<TSchema>,
) {
  return spec;
}

const organizationId = z.string().min(1).describe("Exact organization ID");
const policyId = z.string().min(1).describe("Exact policy ID");

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
        .describe("Omit for platform-wide health; provide an exact organization ID to scope the result"),
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
  }));
}
