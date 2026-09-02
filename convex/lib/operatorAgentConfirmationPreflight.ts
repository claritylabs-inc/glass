import dayjs from "dayjs";

import type { Doc, Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { effectiveExtractionDataStage } from "../backfillDeclarationFacts";
import { validateProcurementRequestCreateByOperator } from "../procurementRequests";
import { assertFeatureFlagAllowedForOrg } from "./featureFlags";
import { assertNoOperatorImpersonation } from "./clientFiles";
import {
  isCompanyContextMemory,
  normalizeMemoryContent,
} from "./orgMemoryPolicy";
import type { OperatorAgentToolName } from "./operatorAgentToolRegistry";

export const OPERATOR_CONFIRMATION_PREFLIGHT_TOOL_NAMES = [
  "confirm_policy_fact",
  "create_client_memory",
  "update_client_memory",
  "delete_client_memory",
  "create_procurement_memory",
  "update_procurement_memory",
  "delete_procurement_memory",
  "retry_failed_policy_extraction",
  "generate_coi",
  "update_client_file",
  "create_procurement_request",
  "update_procurement_request",
  "confirm_procurement_requirement",
  "create_procurement_broker_outreach",
  "update_procurement_broker_outreach",
  "create_procurement_proposal",
  "confirm_procurement_proposal_review",
  "select_procurement_proposal",
  "create_broker_network_profile",
  "update_broker_network_profile",
  "create_procurement_file_item",
  "update_procurement_file_item",
  "update_procurement_email_thread",
  "update_organization_profile",
  "set_organization_status",
  "set_client_feature_flag",
  "clear_all_agent_memory",
] as const satisfies readonly OperatorAgentToolName[];

type PreflightArgs = {
  operatorUserId: Id<"users">;
  threadId: Id<"operatorAgentThreads">;
  toolName: OperatorAgentToolName;
  input: Record<string, unknown>;
};

function exactId<TableName extends TableNames>(
  ctx: MutationCtx,
  table: TableName,
  value: unknown,
  label: string,
) {
  const id =
    typeof value === "string" ? ctx.db.normalizeId(table, value) : null;
  if (!id) {
    throw new Error(
      `${label} must be an exact ${table} ID returned by a read tool`,
    );
  }
  return id;
}

function optionalProcurementPolicyReference(
  ctx: MutationCtx,
  value: unknown,
  field: "replacingPolicyId" | "resultingPolicyId",
) {
  if (value === undefined || value === null) return undefined;
  const policyId =
    typeof value === "string" ? ctx.db.normalizeId("policies", value) : null;
  if (!policyId) {
    throw new Error(
      `${field} must be an exact policy ID returned by a policy read tool; omit it when no policy is being linked`,
    );
  }
  return policyId;
}

async function requireDocument<TableName extends TableNames>(
  ctx: MutationCtx,
  table: TableName,
  value: unknown,
  label: string,
) {
  const id = exactId(ctx, table, value, label);
  const document = await ctx.db.get(id);
  if (!document) throw new Error(`${label} not found`);
  return document;
}

async function requireClientOrganization(ctx: MutationCtx, value: unknown) {
  const organization = await requireDocument(
    ctx,
    "organizations",
    value,
    "Client organization",
  );
  if (organization.type !== "client") {
    throw new Error("Client organization not found");
  }
  return organization;
}

async function requireProcurementRequest(ctx: MutationCtx, value: unknown) {
  const request = await requireDocument(
    ctx,
    "procurementRequests",
    value,
    "Procurement request",
  );
  await requireClientOrganization(ctx, request.clientOrgId);
  return request;
}

async function requireBrokerOrganization(ctx: MutationCtx, value: unknown) {
  if (value === undefined || value === null) return null;
  const broker = await requireDocument(
    ctx,
    "organizations",
    value,
    "Broker organization",
  );
  if (broker.type !== "broker")
    throw new Error("Broker organization not found");
  return broker;
}

async function requirePolicyForClient(
  ctx: MutationCtx,
  value: unknown,
  clientOrgId: Id<"organizations">,
  options: { active?: boolean } = {},
) {
  if (value === undefined || value === null) return null;
  const policy = await requireDocument(ctx, "policies", value, "Policy");
  if (
    policy.orgId !== clientOrgId ||
    (options.active === true && policy.deletedAt)
  ) {
    throw new Error(
      options.active
        ? "Policy is not an active policy for this client"
        : "Policy does not belong to this client",
    );
  }
  return policy;
}

function normalizedText(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function validateOptionalDate(value: unknown) {
  const date = normalizedText(value);
  if (!date) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !dayjs(date).isValid()) {
    throw new Error("Effective date must use YYYY-MM-DD");
  }
}

function validateOptionalEmail(value: unknown) {
  const email = normalizedText(value)?.toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address");
  }
}

function validateOptionalUrl(value: unknown) {
  const url = normalizedText(value);
  if (!url) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Enter a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("URL must use http or https");
  }
}

async function validateCompanyMemory(
  ctx: MutationCtx,
  args: {
    memory?: Doc<"orgMemory">;
    orgId: Id<"organizations">;
    content: unknown;
  },
) {
  const organization = await requireClientOrganization(ctx, args.orgId);
  const content = normalizeMemoryContent(
    typeof args.content === "string" ? args.content : "",
  );
  if (
    !isCompanyContextMemory({
      type: args.memory?.type ?? "fact",
      content,
      orgName: organization.name,
      policyId: args.memory?.policyId,
    })
  ) {
    throw new Error("Memory must be a stable company fact");
  }
}

async function procurementMemoryLinks(
  ctx: MutationCtx,
  args: {
    clientOrgId: Id<"organizations">;
    requestValue?: unknown;
    outreachValue?: unknown;
    brokerValue?: unknown;
  },
) {
  await requireClientOrganization(ctx, args.clientOrgId);
  const request =
    args.requestValue === undefined || args.requestValue === null
      ? null
      : await requireDocument(
          ctx,
          "procurementRequests",
          args.requestValue,
          "Procurement request",
        );
  const outreach =
    args.outreachValue === undefined || args.outreachValue === null
      ? null
      : await requireDocument(
          ctx,
          "procurementBrokerOutreaches",
          args.outreachValue,
          "Procurement outreach",
        );
  const broker = await requireBrokerOrganization(ctx, args.brokerValue);
  if (request && request.clientOrgId !== args.clientOrgId) {
    throw new Error("Procurement request does not belong to this client");
  }
  if (outreach && outreach.clientOrgId !== args.clientOrgId) {
    throw new Error("Procurement outreach does not belong to this client");
  }
  if (request && outreach && outreach.requestId !== request._id) {
    throw new Error("Procurement outreach does not belong to this request");
  }
  if (outreach?.brokerOrgId && broker && outreach.brokerOrgId !== broker._id) {
    throw new Error("Broker does not match the linked outreach");
  }
}

async function preflightConfirmPolicyFact(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const organization = await requireClientOrganization(ctx, input.orgId);
  const policy = await requireDocument(
    ctx,
    "policies",
    input.policyId,
    "Policy",
  );
  if (policy.orgId !== organization._id) throw new Error("Policy not found");
  if (
    policy.deletedAt ||
    policy.pipelineStatus !== "complete" ||
    effectiveExtractionDataStage(policy) !== "final"
  ) {
    throw new Error(
      "Policy facts can be confirmed after full source-backed extraction finishes.",
    );
  }
  const spans = await ctx.db
    .query("sourceSpans")
    .withIndex("policy", (query) => query.eq("policyId", policy._id))
    .collect();
  const knownSpanIds = new Set(spans.map((span) => span.spanId));
  const requestedSpanIds = Array.isArray(input.sourceSpanIds)
    ? input.sourceSpanIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  if (
    requestedSpanIds.length === 0 ||
    requestedSpanIds.some((spanId) => !knownSpanIds.has(spanId))
  ) {
    throw new Error("Source evidence was not found on this policy");
  }
}

async function preflightGenerateCoi(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const policyReference = normalizedText(input.policyId);
  const sourceReference = normalizedText(input.requirementSourceDocumentId);
  const requirementReference = normalizedText(input.requirementId);
  const requirementsMode = Boolean(sourceReference || requirementReference);
  if (Boolean(policyReference) === requirementsMode) {
    throw new Error(
      "Choose either one policy or one requirements source for certificate generation",
    );
  }
  if (policyReference) {
    const policy = await requireDocument(
      ctx,
      "policies",
      policyReference,
      "Policy",
    );
    if (!policy.orgId || policy.deletedAt) throw new Error("Policy not found");
    await requireClientOrganization(ctx, policy.orgId);
    const holderName = normalizedText(input.certificateHolder)
      ?.split(/\r?\n/)[0]
      ?.trim();
    if (!holderName) throw new Error("Certificate holder is required");
    return;
  }

  const source = sourceReference
    ? await requireDocument(
        ctx,
        "requirementSourceDocuments",
        sourceReference,
        "Requirements source",
      )
    : null;
  const requirement = requirementReference
    ? await requireDocument(
        ctx,
        "insuranceRequirements",
        requirementReference,
        "Requirement",
      )
    : null;
  if (source?.archivedAt) throw new Error("Requirements source not found");
  if (requirement && requirement.status !== "active") {
    throw new Error("Requirement not found");
  }
  if (source && requirement && requirement.sourceDocumentId !== source._id) {
    throw new Error("Requirement does not belong to the requirements source");
  }
  const orgId = source?.orgId ?? requirement?.orgId;
  if (!orgId) throw new Error("Requirements source not found");
  await requireClientOrganization(ctx, orgId);
}

async function preflightProcurementRequestUpdate(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const request = await requireProcurementRequest(
    ctx,
    input.procurementRequestId,
  );
  await Promise.all([
    requirePolicyForClient(ctx, input.replacingPolicyId, request.clientOrgId),
    requirePolicyForClient(ctx, input.resultingPolicyId, request.clientOrgId),
  ]);
  if (input.targetEffectiveDate !== null) {
    validateOptionalDate(input.targetEffectiveDate);
  }
}

async function preflightOutreachCreate(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  await requireProcurementRequest(ctx, input.procurementRequestId);
  await requireBrokerOrganization(ctx, input.brokerOrgId);
  validateOptionalEmail(input.contactEmail);
  validateOptionalUrl(input.applicationUrl);
  validateOptionalUrl(input.quoteUrl);
}

async function preflightOutreachUpdate(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const outreach = await requireDocument(
    ctx,
    "procurementBrokerOutreaches",
    input.procurementOutreachId,
    "Broker outreach",
  );
  await requireProcurementRequest(ctx, outreach.requestId);
  await requireBrokerOrganization(ctx, input.brokerOrgId);
  validateOptionalEmail(input.contactEmail);
  validateOptionalUrl(input.applicationUrl);
  validateOptionalUrl(input.quoteUrl);
}

async function preflightRequirementDraftConfirm(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const draft = await requireDocument(
    ctx,
    "procurementRequirementDrafts",
    input.procurementRequirementDraftId,
    "Requirement draft",
  );
  if (draft.status !== "draft") throw new Error("Requirement draft not found");
  const request = await requireProcurementRequest(ctx, draft.requestId);
  if (request.clientOrgId !== draft.clientOrgId) {
    throw new Error("Requirement draft belongs to a different client");
  }
}

async function preflightProposalCreate(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const request = await requireProcurementRequest(
    ctx,
    input.procurementRequestId,
  );
  const broker = await requireBrokerOrganization(ctx, input.brokerOrgId);
  const outreach = await requireDocument(
    ctx,
    "procurementBrokerOutreaches",
    input.procurementOutreachId,
    "Broker outreach",
  );
  if (outreach.requestId !== request._id)
    throw new Error("Outreach does not belong to this request");
  if (!broker || outreach.brokerOrgId !== broker._id)
    throw new Error("Proposal broker must match its outreach");
  if (input.supersedesProposalId != null) {
    const superseded = await requireDocument(
      ctx,
      "procurementProposals",
      input.supersedesProposalId,
      "Proposal",
    );
    if (superseded.requestId !== request._id)
      throw new Error("Superseded proposal must belong to this request");
  }
}

async function preflightProposalReviewConfirm(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const review = await requireDocument(
    ctx,
    "procurementProposalReviews",
    input.procurementProposalReviewId,
    "Proposal review",
  );
  const proposal = await requireDocument(
    ctx,
    "procurementProposals",
    review.proposalId,
    "Proposal",
  );
  const request = await requireProcurementRequest(ctx, review.requestId);
  if (
    proposal.requestId !== request._id ||
    proposal.clientOrgId !== request.clientOrgId ||
    proposal.extractionFingerprint !== review.extractionFingerprint ||
    (request.requirementRevision ?? 0) !== review.requirementRevision ||
    (request.specificationRevision ?? 0) !== review.specificationRevision
  ) {
    throw new Error("Review is stale");
  }
}

async function preflightProposalSelect(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const proposal = await requireDocument(
    ctx,
    "procurementProposals",
    input.procurementProposalId,
    "Proposal",
  );
  const request = await requireProcurementRequest(ctx, proposal.requestId);
  if (proposal.clientOrgId !== request.clientOrgId) {
    throw new Error("Proposal belongs to a different client");
  }
  if (proposal.status !== "reviewed" && proposal.status !== "selected") {
    throw new Error("Only a reviewed proposal can be selected");
  }
}

async function preflightBrokerProfileCreate(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const name = normalizedText(input.name);
  if (!name) throw new Error("Broker name is required");
  validateOptionalUrl(input.website);
  // The agent reaches this tool from unstructured submission records, where the
  // same broker often appears under a name it has already been registered with.
  // Registering a duplicate splits that broker's outreach and proposal history.
  const brokers = await ctx.db
    .query("organizations")
    .withIndex("type", (query) => query.eq("type", "broker"))
    .collect();
  const duplicate = brokers.find(
    (broker) => broker.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (duplicate) {
    throw new Error(
      `Broker ${duplicate.name} is already registered as ${duplicate._id}; update that profile instead`,
    );
  }
}

async function preflightProcurementFileCreate(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const request = await requireProcurementRequest(
    ctx,
    input.procurementRequestId,
  );
  if (input.procurementOutreachId != null) {
    const outreach = await requireDocument(
      ctx,
      "procurementBrokerOutreaches",
      input.procurementOutreachId,
      "Broker outreach",
    );
    if (outreach.requestId !== request._id) {
      throw new Error("Broker outreach does not belong to this request");
    }
  }
  if (input.clientFileId != null) {
    const file = await requireDocument(
      ctx,
      "clientFiles",
      input.clientFileId,
      "Client file",
    );
    if (file.orgId !== request.clientOrgId) {
      throw new Error("Client file does not belong to this request's client");
    }
  }
}

async function preflightProcurementFileUpdate(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const item = await requireDocument(
    ctx,
    "procurementFileItems",
    input.procurementFileItemId,
    "Procurement file item",
  );
  const request = await requireProcurementRequest(ctx, item.requestId);
  if (input.procurementOutreachId != null) {
    const outreach = await requireDocument(
      ctx,
      "procurementBrokerOutreaches",
      input.procurementOutreachId,
      "Broker outreach",
    );
    if (outreach.requestId !== request._id) {
      throw new Error("Broker outreach does not belong to this request");
    }
  }
  if (input.clientFileId != null) {
    const file = await requireDocument(
      ctx,
      "clientFiles",
      input.clientFileId,
      "Client file",
    );
    if (file.orgId !== request.clientOrgId) {
      throw new Error("Client file does not belong to this request's client");
    }
  }
}

async function preflightUpdateClientFile(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const file = await requireDocument(
    ctx,
    "clientFiles",
    input.clientFileId,
    "Client file",
  );
  if (file.archivedAt || file.deletedAt)
    throw new Error("Client file not found");
  await requireClientOrganization(ctx, file.orgId);
  await requirePolicyForClient(ctx, input.policyId, file.orgId, {
    active: true,
  });
}

async function preflightProcurementMemory(
  ctx: MutationCtx,
  input: Record<string, unknown>,
  mode: "create" | "update" | "delete",
) {
  if (mode === "create") {
    const clientOrgId = exactId(
      ctx,
      "organizations",
      input.orgId,
      "Client organization",
    );
    await procurementMemoryLinks(ctx, {
      clientOrgId,
      requestValue: input.procurementRequestId,
      outreachValue: input.procurementOutreachId,
      brokerValue: input.brokerOrgId,
    });
    return;
  }
  const memory = await requireDocument(
    ctx,
    "procurementMemory",
    input.procurementMemoryId,
    "Procurement memory",
  );
  if (mode === "delete") return;
  await procurementMemoryLinks(ctx, {
    clientOrgId: memory.clientOrgId,
    requestValue:
      input.procurementRequestId === undefined
        ? memory.requestId
        : input.procurementRequestId,
    outreachValue:
      input.procurementOutreachId === undefined
        ? memory.outreachId
        : input.procurementOutreachId,
    brokerValue:
      input.brokerOrgId === undefined ? memory.brokerOrgId : input.brokerOrgId,
  });
}

export async function preflightOperatorToolConfirmation(
  ctx: MutationCtx,
  args: PreflightArgs,
) {
  if (
    !new Set<OperatorAgentToolName>(
      OPERATOR_CONFIRMATION_PREFLIGHT_TOOL_NAMES,
    ).has(args.toolName)
  ) {
    throw new Error(
      `Missing confirmation preflight for exact-confirmed tool ${args.toolName}`,
    );
  }
  if (args.toolName === "clear_all_agent_memory") return;
  await assertNoOperatorImpersonation(ctx, args.operatorUserId);

  switch (args.toolName) {
    case "confirm_policy_fact":
      await preflightConfirmPolicyFact(ctx, args.input);
      return;
    case "create_client_memory": {
      const orgId = exactId(
        ctx,
        "organizations",
        args.input.orgId,
        "Client organization",
      );
      await validateCompanyMemory(ctx, {
        orgId,
        content: args.input.content,
      });
      return;
    }
    case "update_client_memory": {
      const memory = await requireDocument(
        ctx,
        "orgMemory",
        args.input.memoryId,
        "Company memory",
      );
      await validateCompanyMemory(ctx, {
        memory,
        orgId: memory.orgId,
        content: args.input.content,
      });
      return;
    }
    case "delete_client_memory": {
      const memory = await requireDocument(
        ctx,
        "orgMemory",
        args.input.memoryId,
        "Company memory",
      );
      await requireClientOrganization(ctx, memory.orgId);
      return;
    }
    case "create_procurement_memory":
      await preflightProcurementMemory(ctx, args.input, "create");
      return;
    case "update_procurement_memory":
      await preflightProcurementMemory(ctx, args.input, "update");
      return;
    case "delete_procurement_memory":
      await preflightProcurementMemory(ctx, args.input, "delete");
      return;
    case "retry_failed_policy_extraction": {
      const policy = await requireDocument(
        ctx,
        "policies",
        args.input.policyId,
        "Policy",
      );
      const run = await ctx.db
        .query("policyExtractionRuns")
        .withIndex("policy", (query) => query.eq("policyId", policy._id))
        .order("desc")
        .first();
      const status = run?.pipelineStatus ?? policy.pipelineStatus;
      if (status === "running" || status === "paused") {
        throw new Error(
          "An extraction is already running or paused for this policy",
        );
      }
      if (!policy.fileId) throw new Error("Policy source file is missing");
      return;
    }
    case "generate_coi":
      await preflightGenerateCoi(ctx, args.input);
      return;
    case "update_client_file":
      await preflightUpdateClientFile(ctx, args.input);
      return;
    case "create_procurement_request": {
      const clientOrgId = exactId(
        ctx,
        "organizations",
        args.input.orgId,
        "Client organization",
      );
      await validateProcurementRequestCreateByOperator(ctx, {
        operatorUserId: args.operatorUserId,
        clientOrgId,
        title: typeof args.input.title === "string" ? args.input.title : "",
        requestSummary:
          typeof args.input.requestSummary === "string"
            ? args.input.requestSummary
            : "",
        requirements:
          typeof args.input.requirements === "string"
            ? args.input.requirements
            : "",
        targetEffectiveDate: normalizedText(args.input.targetEffectiveDate),
        status: args.input.status as
          | Doc<"procurementRequests">["status"]
          | undefined,
        replacingPolicyId: optionalProcurementPolicyReference(
          ctx,
          args.input.replacingPolicyId,
          "replacingPolicyId",
        ),
        resultingPolicyId: optionalProcurementPolicyReference(
          ctx,
          args.input.resultingPolicyId,
          "resultingPolicyId",
        ),
      });
      return;
    }
    case "update_procurement_request":
      await preflightProcurementRequestUpdate(ctx, args.input);
      return;
    case "confirm_procurement_requirement":
      await preflightRequirementDraftConfirm(ctx, args.input);
      return;
    case "create_procurement_broker_outreach":
      await preflightOutreachCreate(ctx, args.input);
      return;
    case "update_procurement_broker_outreach":
      await preflightOutreachUpdate(ctx, args.input);
      return;
    case "create_procurement_proposal":
      await preflightProposalCreate(ctx, args.input);
      return;
    case "confirm_procurement_proposal_review":
      await preflightProposalReviewConfirm(ctx, args.input);
      return;
    case "select_procurement_proposal":
      await preflightProposalSelect(ctx, args.input);
      return;
    case "create_broker_network_profile":
      await preflightBrokerProfileCreate(ctx, args.input);
      return;
    case "update_broker_network_profile":
      await requireBrokerOrganization(ctx, args.input.brokerOrgId);
      return;
    case "create_procurement_file_item":
      await preflightProcurementFileCreate(ctx, args.input);
      return;
    case "update_procurement_file_item":
      await preflightProcurementFileUpdate(ctx, args.input);
      return;
    case "update_procurement_email_thread": {
      const thread = await requireDocument(
        ctx,
        "procurementEmailThreads",
        args.input.procurementEmailThreadId,
        "Procurement email thread",
      );
      if (thread.deletedAt)
        throw new Error("Procurement email thread not found");
      await requireProcurementRequest(ctx, thread.requestId);
      if (args.input.procurementRequestId != null) {
        const request = await requireProcurementRequest(
          ctx,
          args.input.procurementRequestId,
        );
        if (request.clientOrgId !== thread.clientOrgId) {
          throw new Error("Email thread can move only within the same client");
        }
        if (request._id === thread.requestId && args.input.category == null) {
          throw new Error("No email thread fields changed");
        }
      }
      return;
    }
    case "update_organization_profile":
    case "set_organization_status":
      await requireDocument(
        ctx,
        "organizations",
        args.input.orgId,
        "Organization",
      );
      return;
    case "set_client_feature_flag": {
      const organization = await requireClientOrganization(
        ctx,
        args.input.orgId,
      );
      const flagId = args.input.flagId;
      if (
        flagId !== "connect_features" &&
        flagId !== "coverage_recovery_v2" &&
        flagId !== "imessage_app_cards"
      ) {
        throw new Error("Unsupported feature flag");
      }
      assertFeatureFlagAllowedForOrg(flagId, organization);
      return;
    }
    default:
      throw new Error(
        `Missing confirmation preflight for exact-confirmed tool ${args.toolName}`,
      );
  }
}
