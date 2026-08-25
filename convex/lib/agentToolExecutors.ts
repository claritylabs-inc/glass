"use node";

import type { ToolExecutionOptions } from "ai";
import dayjs from "dayjs";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  attachPolicyDocument,
  compareCoverages,
  confirmPolicyFact,
  generateCoi,
  lookupAddress,
  lookupCompanyContext,
  lookupComplianceRequirements,
  importRequirementAttachments,
  lookupPolicy,
  lookupPolicySection,
  presentPolicyCard,
  readThreadAttachment,
  saveNote,
  searchThreadHistory,
} from "./chatTools";
import { COI_GENERATION_FAILED_MESSAGE } from "./actionFailures";
import {
  certificateGeneratedOutcome,
  certificateHeldOutcome,
  certificateRecoverableOutcome,
  type CertificateRequestWorkflowParams,
} from "./workflows/certificateRequest";
import {
  filterComplianceRequirements,
  formatComplianceRequirement,
} from "./complianceAgent";
import { coverageBreakdownForTool } from "./coverageBreakdown";
import { orgLabelForScope, type AgentScope } from "./agentScope";
import { searchPolicyDocumentWithSourceSpans } from "./policyLookup";
import { resolvePolicyReferenceForOrg } from "./policyToolResolution";
import { buildVendorComplianceTools } from "./vendorComplianceTools";
import type { RequirementScope } from "./complianceTypes";
import { lobLabel, policyLobCodes } from "./linesOfBusiness";
import {
  resolvePolicyCarrierDisplay,
  resolvePolicyPartyContext,
} from "./policyPartyContext";
import { effectiveOrganizationProfileFacts } from "./orgProfileFacts";
import { lookupMapboxAddress } from "./mapboxAddress";
import { createAgentPolicyPresentationState } from "./agentPolicyPresentation";
import { rankOrgMemoryForQuery } from "./orgMemoryPolicy";
import type { AgentToolSurface } from "./agentMessageHistory";
import { readStoredThreadAttachment } from "./agentThreadAttachment";
import {
  normalizedSearchText,
  uniqueSearchTerms,
} from "./searchTokenizer";
import { importRequirementSources } from "./requirementAttachmentIntent";

const COMPANY_CONTEXT_QUERY_STOP_WORDS = new Set([
  "about",
  "company",
  "context",
  "does",
  "tell",
  "what",
]);

type ToolAttachment = {
  filename: string;
  contentType: string;
  size: number;
  fileId?: Id<"_storage">;
  kind?: "coi" | "original_policy" | "uploaded_file" | "generated_document";
};

type ToolArtifact = {
  type: string;
  data: unknown;
};

type ToolPolicy = Record<string, any> & {
  _id: Id<"policies">;
  orgId: Id<"organizations">;
};

type PolicyResolutionResult =
  | { ok: true; policy: ToolPolicy }
  | { ok: false; message: string };

type ListedPolicyForTool = Record<string, any> & {
  _id?: Id<"policies">;
  orgId?: Id<"organizations">;
  _scopeOrgName?: string;
  _clientProfileFacts?: Record<string, any>;
};

export type BuildAgentToolExecutorsOptions = {
  surface: AgentToolSurface;
  orgId: Id<"organizations">;
  userId: Id<"users">;
  scope: AgentScope;
  operatorInitiatedUserMessageId?: Id<"threadMessages">;
  readOrgIds?: Id<"organizations">[];
  writableOrgIds?: Id<"organizations">[];
  threadId?: Id<"threads">;
  canWrite?: boolean;
  writeUnavailableMessage?: string;
  availableFileIds?: Set<string>;
  requirementImportAttachments?: Array<
    ToolAttachment & { fileId: Id<"_storage"> }
  >;
  requirementImportDefaultScope?: RequirementScope;
  onPolicyReferenced?: (policyId: Id<"policies">) => void | Promise<void>;
  onPolicyPresented?: (policyId: Id<"policies">) => void | Promise<void>;
  onPolicySourceEvidence?: (evidence: unknown) => void | Promise<void>;
  onResponseAttachment?: (attachment: ToolAttachment) => void | Promise<void>;
  onToolArtifact?: (artifact: ToolArtifact) => void | Promise<void>;
};

function certificateSourceForSurface(surface: AgentToolSurface) {
  if (surface === "web") return "chat" as const;
  if (surface === "mcp") return "mcp" as const;
  return surface;
}

function orgMemorySourceForSurface(surface: AgentToolSurface) {
  if (surface === "email" || surface === "imessage" || surface === "slack") {
    return surface;
  }
  return "chat" as const;
}

function typeMap(
  value: string,
): "fact" | "preference" | "risk_note" | "observation" {
  if (value === "fact" || value === "preference" || value === "risk_note")
    return value;
  return "observation";
}

function formatPolicyForTool(policy: Record<string, any>, scope: AgentScope) {
  const extractionDataStage = effectivePolicyDataStage(policy);
  const provisional = extractionDataStage === "preview";
  const clientProfileFacts =
    policy._clientProfileFacts && typeof policy._clientProfileFacts === "object"
      ? (policy._clientProfileFacts as Record<string, any>)
      : {};
  const partyContext = resolvePolicyPartyContext(policy, {
    clientProfileFacts,
  });
  const carrierDisplay = resolvePolicyCarrierDisplay(policy);
  return {
    id: policy._id,
    client:
      scope.mode === "broker_portfolio"
        ? orgLabelForScope(scope, policy.orgId)
        : policy._scopeOrgName,
    orgId: policy.orgId,
    insured: partyContext.insuredName,
    insuredAddress: partyContext.insuredAddress,
    operationsDescription: partyContext.operationsDescription,
    additionalNamedInsureds: partyContext.additionalNamedInsureds,
    policyParties: partyContext.parties,
    clientProfile: {
      namedInsured: clientProfileFacts.namedInsured?.value,
      mailingAddress: clientProfileFacts.mailingAddress?.value,
      operationsDescription: clientProfileFacts.operationsDescription?.value,
      dba: clientProfileFacts.dba?.value,
      entityType: clientProfileFacts.entityType?.value,
      taxId: clientProfileFacts.taxId?.value,
      fein: clientProfileFacts.fein?.value ?? clientProfileFacts.taxId?.value,
      businessNumber: clientProfileFacts.businessNumber?.value,
      additionalNamedInsureds: Array.isArray(
        clientProfileFacts.additionalNamedInsureds,
      )
        ? clientProfileFacts.additionalNamedInsureds
            .map((fact: Record<string, any>) => fact?.value)
            .filter(Boolean)
        : undefined,
    },
    carrier:
      carrierDisplay.carrierDisplayName ??
      partyContext.carrierDisplayName ??
      partyContext.insurerName ??
      policy.security,
    carrierIdentity: carrierDisplay.carrierIdentity,
    linesOfBusiness: policyLobCodes(policy),
    type: policyLobCodes(policy)
      .filter((code) => code !== "UN")
      .map(lobLabel)
      .join(", "),
    number: policy.policyNumber,
    effective: policy.effectiveDate,
    expiration: policy.expirationDate,
    premium: policy.premium,
    extractionStatus: policy.pipelineStatus,
    dataStage: extractionDataStage,
    provisional,
    availabilityNote: provisional
      ? "Extraction is complete for this policy and enrichment is still running. Summaries and broad comparisons are available, but source evidence, COIs, policy delivery, policy changes, and endorsements require enrichment to finish."
      : undefined,
    coverages: (policy.coverages ?? []).map((coverage: any) => ({
      name: coverage.name,
      limit: coverage.limit,
      deductible: coverage.deductible,
    })),
    coverageBreakdown: coverageBreakdownForTool(policy),
  };
}

function effectivePolicyDataStage(policy: Record<string, any>) {
  if (
    policy.extractionDataStage === "placeholder" ||
    policy.extractionDataStage === "preview" ||
    policy.extractionDataStage === "final"
  ) {
    return policy.extractionDataStage as "placeholder" | "preview" | "final";
  }
  return policy.pipelineStatus === "complete" ? "final" : "placeholder";
}

function isFinalPolicy(policy: Record<string, any>) {
  return (
    !policy.deletedAt &&
    policy.pipelineStatus === "complete" &&
    effectivePolicyDataStage(policy) === "final"
  );
}

function finalExtractionRequiredMessage(
  policy: Record<string, any>,
  action: string,
) {
  const label = policy.policyNumber
    ? ` ${policy.policyNumber}`
    : policy.fileName
      ? ` ${policy.fileName}`
      : "";
  return [
    `Glass has completed extraction for policy${label}, but ${action} requires enrichment to finish.`,
    "Try again after enrichment completes.",
  ].join(" ");
}

function canWriteOrg(
  options: BuildAgentToolExecutorsOptions,
  orgId: Id<"organizations"> | string,
) {
  if (options.canWrite === false) return false;
  const writableOrgIds = options.writableOrgIds ?? options.scope.writableOrgIds;
  return writableOrgIds.some((id) => String(id) === String(orgId));
}

function canReadOrg(
  options: BuildAgentToolExecutorsOptions,
  orgId: Id<"organizations"> | string,
) {
  const readOrgIds = options.readOrgIds ?? options.scope.readOrgIds;
  return readOrgIds.some((id) => String(id) === String(orgId));
}

function writeUnavailable(
  options: BuildAgentToolExecutorsOptions,
  action: string,
) {
  return (
    options.writeUnavailableMessage ??
    `You do not have permission to ${action}.`
  );
}

async function listPoliciesForReadableOrgs(
  ctx: ActionCtx,
  options: BuildAgentToolExecutorsOptions,
): Promise<ListedPolicyForTool[]> {
  const readOrgIds = options.readOrgIds ?? options.scope.readOrgIds;
  const rows = await Promise.all(
    readOrgIds.map(async (orgId) => {
      const [policies, org] = await Promise.all([
        ctx.runQuery(internal.policies.listAllPreviewReadableInternal, {
          orgId,
        }),
        ctx.runQuery(internal.orgs.getInternal, { id: orgId }),
      ]);
      return (policies as Array<Record<string, unknown>>).map((policy) => ({
        ...policy,
        _scopeOrgName: orgLabelForScope(options.scope, orgId),
        _clientProfileFacts:
          org && typeof org === "object"
            ? effectiveOrganizationProfileFacts(org as Record<string, unknown>)
            : undefined,
      }));
    }),
  );
  return rows.flat() as ListedPolicyForTool[];
}

async function resolveReadablePolicy(
  ctx: ActionCtx,
  options: BuildAgentToolExecutorsOptions,
  reference: string,
): Promise<PolicyResolutionResult> {
  const resolved = await resolvePolicyReferenceForOrg(ctx, {
    orgIds: options.readOrgIds ?? options.scope.readOrgIds,
    reference,
  });
  if (!resolved.ok) return { ok: false, message: resolved.message };
  const policy = resolved.policy as ToolPolicy;
  if (!policy.orgId || !canReadOrg(options, policy.orgId)) {
    return { ok: false as const, message: "Policy not found." };
  }
  const org = await ctx.runQuery(internal.orgs.getInternal, {
    id: policy.orgId,
  });
  return {
    ok: true,
    policy: {
      ...policy,
      _clientProfileFacts:
        org && typeof org === "object"
          ? effectiveOrganizationProfileFacts(org as Record<string, unknown>)
          : undefined,
    },
  };
}

async function resolveWritablePolicy(
  ctx: ActionCtx,
  options: BuildAgentToolExecutorsOptions,
  reference: string,
  action: string,
) {
  const resolved = await resolveReadablePolicy(ctx, options, reference);
  if (!resolved.ok) return resolved;
  if (!canWriteOrg(options, resolved.policy.orgId)) {
    return { ok: false as const, message: writeUnavailable(options, action) };
  }
  return resolved;
}

async function resolveFinalReadablePolicy(
  ctx: ActionCtx,
  options: BuildAgentToolExecutorsOptions,
  reference: string,
  action: string,
) {
  const resolved = await resolveReadablePolicy(ctx, options, reference);
  if (!resolved.ok) return resolved;
  if (!isFinalPolicy(resolved.policy)) {
    return {
      ok: false as const,
      message: finalExtractionRequiredMessage(resolved.policy, action),
    };
  }
  return resolved;
}

async function resolveFinalWritablePolicy(
  ctx: ActionCtx,
  options: BuildAgentToolExecutorsOptions,
  reference: string,
  action: string,
) {
  const resolved = await resolveWritablePolicy(ctx, options, reference, action);
  if (!resolved.ok) return resolved;
  if (!isFinalPolicy(resolved.policy)) {
    return {
      ok: false as const,
      message: finalExtractionRequiredMessage(resolved.policy, action),
    };
  }
  return resolved;
}

export function buildAgentToolExecutors(
  ctx: ActionCtx,
  options: BuildAgentToolExecutorsOptions,
) {
  const policyPresentation = createAgentPolicyPresentationState();
  const recordToolPolicyReference = async (
    policyId: Id<"policies">,
    toolName: string,
    executionOptions?: ToolExecutionOptions,
  ) => {
    policyPresentation.recordToolPolicyReference({
      policyId,
      toolCallId:
        executionOptions?.toolCallId ?? `direct:${toolName}:${policyId}`,
      toolName,
    });
    await options.onPolicyReferenced?.(policyId);
  };

  return {
    search_thread_history: {
      ...searchThreadHistory,
      execute: async (params: { query: string; limit?: number }) => {
        if (!options.threadId) {
          return {
            status: "unavailable" as const,
            message:
              "This agent surface does not have a conversation thread to search.",
          };
        }
        const matches = await ctx.runQuery(
          internal.agentHistory.searchThreadHistory,
          {
            threadId: options.threadId,
            userId: options.userId,
            readOrgIds: options.readOrgIds ?? options.scope.readOrgIds,
            query: params.query,
            limit: params.limit ?? 5,
          },
        );
        console.log("[agent-history] Retrieval tool used", {
          tool: "search_thread_history",
          surface: options.surface,
          threadId: options.threadId,
          resultCount: matches.length,
        });
        return {
          status: "ok" as const,
          matches,
          message:
            matches.length > 0
              ? undefined
              : "No matching older messages were found in this conversation.",
        };
      },
    },
    read_thread_attachment: {
      ...readThreadAttachment,
      execute: async (params: { messageId: string; filename: string }) => {
        if (!options.threadId) {
          return {
            status: "unavailable" as const,
            message:
              "This agent surface does not have a conversation thread attachment to reopen.",
          };
        }
        const attachment = await ctx.runQuery(
          internal.agentHistory.getThreadAttachment,
          {
            threadId: options.threadId,
            messageId: params.messageId,
            filename: params.filename,
            userId: options.userId,
            readOrgIds: options.readOrgIds ?? options.scope.readOrgIds,
          },
        );
        if (!attachment) {
          return {
            status: "unavailable" as const,
            message:
              "That attachment was not found in this conversation or is no longer available.",
          };
        }
        console.log("[agent-history] Retrieval tool used", {
          tool: "read_thread_attachment",
          surface: options.surface,
          threadId: options.threadId,
          contentType: attachment.contentType,
          size: attachment.size,
        });
        return readStoredThreadAttachment(ctx, {
          orgId: options.orgId,
          surface: options.surface,
          threadId: options.threadId,
          messageId: attachment.messageId,
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
          url: attachment.url,
        });
      },
    },
    lookup_address: {
      ...lookupAddress,
      execute: async (params: { query: string; countryCode?: string }) => {
        const accessToken =
          process.env.MAPBOX_ACCESS_TOKEN?.trim() ||
          process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();
        if (!accessToken) {
          return {
            status: "unavailable" as const,
            query: params.query,
            candidates: [],
            message:
              "Mapbox address validation is not configured. Preserve the user's original address and do not claim it was validated.",
          };
        }
        return lookupMapboxAddress({
          query: params.query,
          countryCode: params.countryCode,
          accessToken,
        });
      },
    },
    lookup_policy: {
      ...lookupPolicy,
      execute: async (
        params: {
          query?: string;
          policyIds?: string[];
          expiringWithinDays?: number;
          lineOfBusiness?: string;
          policyType?: string;
          carrier?: string;
        },
        executionOptions?: ToolExecutionOptions,
      ) => {
        const policies = await listPoliciesForReadableOrgs(ctx, options);
        const { policySearchScore } = await import("./aiUtils");
        const exactPolicyIds = new Set((params.policyIds ?? []).slice(0, 5));
        let candidates =
          exactPolicyIds.size > 0
            ? policies.filter(
                (policy) =>
                  policy._id && exactPolicyIds.has(String(policy._id)),
              )
            : policies;
        if (params.expiringWithinDays !== undefined) {
          const today = dayjs().startOf("day");
          const end = today.add(params.expiringWithinDays, "day").endOf("day");
          candidates = candidates.filter((policy) => {
            if (
              !policy.expirationDate ||
              policy.policyTermType === "continuous"
            ) {
              return false;
            }
            const expiration = dayjs(policy.expirationDate);
            return (
              expiration.isValid() &&
              !expiration.isBefore(today) &&
              !expiration.isAfter(end)
            );
          });
        }
        const scored = candidates
          .map((policy) => ({
            policy,
            score: policySearchScore(
              policy,
              params.query ?? "",
              params.lineOfBusiness ?? params.policyType,
              params.carrier,
            ),
          }))
          .filter((match) => match.score > 0)
          .sort((left, right) => right.score - left.score);
        const hasStructuredFilter = Boolean(
          params.lineOfBusiness ?? params.policyType ?? params.carrier,
        );
        let matches: ListedPolicyForTool[];
        if (exactPolicyIds.size > 0) {
          matches = candidates;
        } else if (scored.length > 0) {
          matches = scored.map((match) => match.policy);
        } else if (params.expiringWithinDays !== undefined) {
          matches = candidates;
        } else if (hasStructuredFilter) {
          matches = [];
        } else {
          matches = policies.slice(0, 5);
        }
        if (exactPolicyIds.size > 0) {
          const order = new Map(
            [...exactPolicyIds].map((policyId, index) => [policyId, index]),
          );
          matches = [...matches].sort(
            (left, right) =>
              (order.get(String(left._id)) ?? Number.MAX_SAFE_INTEGER) -
              (order.get(String(right._id)) ?? Number.MAX_SAFE_INTEGER),
          );
        } else if (
          params.expiringWithinDays !== undefined &&
          scored.length === 0
        ) {
          matches = [...matches].sort(
            (left, right) =>
              dayjs(left.expirationDate).valueOf() -
              dayjs(right.expirationDate).valueOf(),
          );
        }
        if (matches.length === 0)
          return "No policies matched the requested IDs or filters in the readable organization scope.";
        for (const policy of matches.slice(0, 5)) {
          if (policy._id)
            await recordToolPolicyReference(
              policy._id as Id<"policies">,
              "lookup_policy",
              executionOptions,
            );
        }
        return matches
          .slice(0, 5)
          .map((policy) =>
            formatPolicyForTool(policy as Record<string, any>, options.scope),
          );
      },
    },
    ...(options.onPolicyPresented
      ? {
          present_policy_card: {
            ...presentPolicyCard,
            execute: async (params: {
              policyId: string;
              allowMultiple?: boolean;
              repeatRequested?: boolean;
            }) => {
              const referencedPolicy =
                policyPresentation.toolPolicyReferences.find(
                  (reference) => String(reference.policyId) === params.policyId,
                );
              const wasRecentlyPresented =
                options.threadId && referencedPolicy
                  ? await ctx.runQuery(
                      internal.threads.wasPolicyCardRecentlyPresentedInternal,
                      {
                        threadId: options.threadId,
                        policyId: referencedPolicy.policyId,
                      },
                    )
                  : false;
              const selection = policyPresentation.selectPolicyCard({
                policyId: params.policyId,
                allowMultiple: params.allowMultiple === true,
                repeatRequested: params.repeatRequested === true,
                wasRecentlyPresented,
              });
              if (!selection.ok) {
                return {
                  status: selection.status,
                  message: selection.message,
                };
              }
              await options.onPolicyPresented?.(selection.policyId);
              return {
                status: "presented" as const,
                policyId: selection.policyId,
                message: "Policy card selected for this response.",
              };
            },
          },
        }
      : {}),
    lookup_company_context: {
      ...lookupCompanyContext,
      execute: async (params: {
        orgId?: string;
        query?: string;
        limit?: number;
      }) => {
        const requestedLimit = params.limit ?? 10;
        const readableOrgIds = options.readOrgIds ?? options.scope.readOrgIds;
        let targetOrgIds = readableOrgIds;
        let matchedOrgByName = false;
        if (params.orgId) {
          targetOrgIds = readableOrgIds.filter(
            (orgId) => String(orgId) === params.orgId,
          );
          if (targetOrgIds.length === 0) {
            return "That organization is not in the readable scope.";
          }
        } else if (params.query?.trim()) {
          const query = normalizedSearchText(params.query);
          const nameMatches = options.scope.orgs
            .filter((org) => {
              const name = normalizedSearchText(org.name);
              return name.includes(query) || query.includes(name);
            })
            .map((org) => org.orgId);
          if (nameMatches.length > 0) {
            targetOrgIds = nameMatches;
            matchedOrgByName = true;
          }
        } else if (options.scope.focusedOrgId) {
          targetOrgIds = [options.scope.focusedOrgId];
        }

        const boundedOrgIds = targetOrgIds.slice(0, 25);
        const memories = (
          await Promise.all(
            boundedOrgIds.map(async (orgId) => {
              const rows = await ctx.runQuery(internal.orgMemory.listByOrg, {
                orgId,
                limit: 100,
              });
              return rows.map((memory) => ({
                ...memory,
                orgId,
                orgName: orgLabelForScope(options.scope, orgId),
              }));
            }),
          )
        ).flat();
        const queryTerms = uniqueSearchTerms(params.query ?? "", {
          minimumLength: 3,
        })
          .filter((term) => !COMPANY_CONTEXT_QUERY_STOP_WORDS.has(term));
        const relevantMemories =
          params.query?.trim() && targetOrgIds.length > 1 && !matchedOrgByName
            ? memories.filter((memory) => {
                const content = normalizedSearchText(memory.content);
                return queryTerms.some((term) => content.includes(term));
              })
            : memories;
        const facts = rankOrgMemoryForQuery(
          params.query ?? "",
          relevantMemories,
          requestedLimit,
        ).map((memory) => ({
          orgId: memory.orgId,
          orgName: memory.orgName,
          type: memory.type,
          content: memory.content,
          updatedAt: memory.updatedAt,
        }));
        return {
          facts,
          searchedOrganizations: boundedOrgIds.length,
          bounded: targetOrgIds.length > boundedOrgIds.length,
          note:
            facts.length > 0
              ? "These are durable company-profile facts only. Use policy tools for every policy fact."
              : "No matching durable company-profile facts were found. Do not infer policy facts from memory.",
        };
      },
    },
    compare_coverages: {
      ...compareCoverages,
      execute: async (
        params: { policyId1: string; policyId2: string },
        executionOptions?: ToolExecutionOptions,
      ) => {
        const first = await resolveReadablePolicy(
          ctx,
          options,
          params.policyId1,
        );
        if (!first.ok) return first.message;
        const second = await resolveReadablePolicy(
          ctx,
          options,
          params.policyId2,
        );
        if (!second.ok) return second.message;
        await recordToolPolicyReference(
          first.policy._id,
          "compare_coverages",
          executionOptions,
        );
        await recordToolPolicyReference(
          second.policy._id,
          "compare_coverages",
          executionOptions,
        );
        return {
          policy1: formatPolicyForTool(first.policy as any, options.scope),
          policy2: formatPolicyForTool(second.policy as any, options.scope),
        };
      },
    },
    lookup_compliance_requirements: {
      ...lookupComplianceRequirements,
      execute: async (params: {
        query?: string;
        scope?: RequirementScope | "all";
      }) => {
        const blocks: string[] = [];
        for (const readOrgId of options.readOrgIds ??
          options.scope.readOrgIds) {
          const requirements = await ctx.runQuery(
            internal.compliance.listRequirementsInternal,
            { orgId: readOrgId },
          );
          const matches = filterComplianceRequirements(requirements, params);
          if (matches.length > 0) {
            const label = orgLabelForScope(options.scope, readOrgId);
            blocks.push(
              `Requirements for ${label} (orgId: ${readOrgId}):\n${matches.map(formatComplianceRequirement).join("\n")}`,
            );
          }
        }
        return blocks.length > 0
          ? blocks.join("\n\n")
          : "No matching compliance requirements found. Vendor/contractor requirements and internal requirements are stored separately.";
      },
    },
    ...(options.requirementImportAttachments?.length
      ? {
          import_requirement_attachments: {
            ...importRequirementAttachments,
            execute: async () => {
              if (!canWriteOrg(options, options.orgId)) {
                return writeUnavailable(
                  options,
                  "import compliance requirements",
                );
              }
              const { imports, createdCount, workflowOutcome } =
                await importRequirementSources(ctx, {
                  orgId: options.orgId,
                  userId: options.userId,
                  attachments: options.requirementImportAttachments ?? [],
                  scope: options.requirementImportDefaultScope,
                });
              return {
                status: "imported" as const,
                message: `${imports.length} requirement source${imports.length === 1 ? " was" : "s were"} saved and ${createdCount} new insurance requirement${createdCount === 1 ? " was" : "s were"} extracted. Use lookup_compliance_requirements before answering the compliance question.`,
                imports,
                createdCount,
                workflowOutcome,
              };
            },
          },
        }
      : {}),
    ...buildVendorComplianceTools(
      ctx,
      (options.readOrgIds ?? options.scope.readOrgIds).map((orgId) =>
        String(orgId),
      ),
      (result) =>
        options.onToolArtifact?.({ type: "vendor_compliance", data: result }),
    ),
    lookup_policy_section: {
      ...lookupPolicySection,
      execute: async (
        params: { policyId: string; query: string },
        executionOptions?: ToolExecutionOptions,
      ) => {
        const resolved = await resolveFinalReadablePolicy(
          ctx,
          options,
          params.policyId,
          "exact source lookup",
        );
        if (!resolved.ok) return resolved.message;
        await recordToolPolicyReference(
          resolved.policy._id,
          "lookup_policy_section",
          executionOptions,
        );
        if (
          resolved.policy.fileId &&
          resolved.policy.sourceTreeStatus !== "ready" &&
          resolved.policy.sourceTreeStatus !== "queued" &&
          resolved.policy.sourceTreeStatus !== "running"
        ) {
          await ctx.scheduler
            .runAfter(
              0,
              internal.actions.policyExtraction.ensurePolicyV3SourceTree,
              {
                policyId: resolved.policy._id,
                reason: "agent_policy_section_lookup",
              },
            )
            .catch(() => undefined);
        }
        const evidence = await searchPolicyDocumentWithSourceSpans(
          ctx,
          resolved.policy,
          params.query,
          8,
        );
        await options.onPolicySourceEvidence?.(evidence);
        return evidence;
      },
    },
    save_note: {
      ...saveNote,
      execute: async (
        params: {
          content: string;
          type: string;
          policyId?: string;
        },
        executionOptions?: ToolExecutionOptions,
      ) => {
        if (options.canWrite === false)
          return writeUnavailable(options, "save durable notes");
        let policyId: Id<"policies"> | undefined;
        let targetOrgId = options.orgId;
        if (params.policyId) {
          const resolved = await resolveWritablePolicy(
            ctx,
            options,
            params.policyId,
            "save notes for that policy",
          );
          if (!resolved.ok) return resolved.message;
          policyId = resolved.policy._id;
          targetOrgId = resolved.policy.orgId;
          await recordToolPolicyReference(
            resolved.policy._id,
            "save_note",
            executionOptions,
          );
        }
        if (policyId) {
          return "Not saved. Memory is limited to stable company context; policy-specific facts must come from policy lookup tools.";
        }
        if (typeMap(params.type) !== "fact") {
          return "Not saved. Memory is limited to stable company facts.";
        }
        const savedId = await ctx.runMutation(internal.orgMemory.upsert, {
          orgId: targetOrgId,
          type: "fact",
          content: params.content,
          source: orgMemorySourceForSurface(options.surface),
          provenance: {
            kind: "organization_fact",
            derivation: "agent_tool",
            schemaVersion: "organization-fact-v1",
          },
        });
        if (!savedId) {
          return "Not saved. Memory is limited to stable company context, not policy details, agent behavior, drafts, requests, or workflow state.";
        }
        return "Note saved.";
      },
    },
    attach_policy_document: {
      ...attachPolicyDocument,
      execute: async (
        params: { policyId: string },
        executionOptions?: ToolExecutionOptions,
      ) => {
        const resolved = await resolveFinalReadablePolicy(
          ctx,
          options,
          params.policyId,
          "original policy delivery",
        );
        if (!resolved.ok) return resolved.message;
        const policy = resolved.policy;
        await recordToolPolicyReference(
          policy._id,
          "attach_policy_document",
          executionOptions,
        );
        if (!policy.fileId)
          return "That policy does not have an original PDF file available.";
        const attachment = {
          filename: policy.fileName ?? `${policy.policyNumber ?? "policy"}.pdf`,
          contentType: "application/pdf",
          size: 0,
          fileId: policy.fileId as Id<"_storage">,
          kind: "original_policy" as const,
        };
        await options.onResponseAttachment?.(attachment);
        return {
          message: "Original policy PDF attached to this response.",
          policyId: policy._id,
          attachment,
        };
      },
    },
    confirm_policy_fact: {
      ...confirmPolicyFact,
      execute: async (
        params: {
          policyId: string;
          requirementIds?: string[];
          fact: string;
          sourceSpanIds: string[];
          fieldUpdates?: Record<string, string | undefined>;
        },
        executionOptions?: ToolExecutionOptions,
      ) => {
        const resolved = await resolveFinalWritablePolicy(
          ctx,
          options,
          params.policyId,
          "source-backed fact confirmation",
        );
        if (!resolved.ok) return resolved.message;
        await recordToolPolicyReference(
          resolved.policy._id,
          "confirm_policy_fact",
          executionOptions,
        );
        try {
          const result = await ctx.runMutation(
            internal.policies.confirmPolicyFactFromSource,
            {
              id: resolved.policy._id,
              orgId: resolved.policy.orgId,
              userId: options.userId,
              fact: params.fact,
              source: orgMemorySourceForSurface(options.surface),
              sourceSpanIds: params.sourceSpanIds,
              fieldUpdates: params.fieldUpdates,
            },
          );
          return {
            status: "confirmed",
            fact: params.fact,
            updatedFields: result.updatedFields,
            sourceSpanIds: result.sourceSpanIds,
          };
        } catch (err) {
          return err instanceof Error
            ? err.message
            : "Unable to confirm that fact from source evidence.";
        }
      },
    },
    generate_coi: {
      ...generateCoi,
      execute: async (
        params: {
          policyId?: string;
          requirementSourceDocumentId?: string;
          requirementId?: string;
          certificateHolder?: string;
          holderContactName?: string;
          holderEmail?: string;
          holderPhone?: string;
          addressLine1?: string;
          addressLine2?: string;
          city?: string;
          state?: string;
          postalCode?: string;
          country?: string;
          requestText?: string;
          descriptionOfOperations?: string;
          requestedEndorsements?: string[];
          additionalInsuredName?: string;
          explicitReissue?: boolean;
        },
        executionOptions?: ToolExecutionOptions,
      ) => {
        try {
          const requirementsMode = Boolean(
            params.requirementSourceDocumentId || params.requirementId,
          );
          if (Boolean(params.policyId) === requirementsMode) {
            return "Choose either a policy or a requirements source for certificate generation.";
          }
          let targetOrgId: Id<"organizations">;
          let policy: ToolPolicy | undefined;
          if (params.policyId) {
            const resolved = await resolveFinalWritablePolicy(
              ctx,
              options,
              params.policyId,
              "certificate generation",
            );
            if (!resolved.ok) return resolved.message;
            policy = resolved.policy;
            targetOrgId = policy.orgId;
            await recordToolPolicyReference(
              policy._id,
              "generate_coi",
              executionOptions,
            );
          } else {
            const writableOrgIds =
              options.writableOrgIds ?? options.scope.writableOrgIds;
            const matchingOrgIds: Id<"organizations">[] = [];
            for (const orgId of writableOrgIds) {
              const plan = await ctx
                .runQuery(
                  internal.compliance
                    .getCertificateRequirementSourcePlanInternal,
                  {
                    orgId,
                    sourceDocumentId: params.requirementSourceDocumentId as
                      | Id<"requirementSourceDocuments">
                      | undefined,
                    requirementId: params.requirementId as
                      | Id<"insuranceRequirements">
                      | undefined,
                  },
                )
                .catch(() => null);
              if (plan) matchingOrgIds.push(orgId);
            }
            if (matchingOrgIds.length !== 1) {
              return matchingOrgIds.length > 1
                ? "That requirement reference is ambiguous across writable organizations. Ask the user which client they mean."
                : "I could not find a writable requirement source with complete certificate-holder details.";
            }
            targetOrgId = matchingOrgIds[0];
          }
          const holderName =
            params.certificateHolder?.split(/\r?\n/)[0]?.trim() ||
            (requirementsMode
              ? "Requirements source holder"
              : "Certificate holder");
          const workflowParams: CertificateRequestWorkflowParams = {
            policyId: policy ? String(policy._id) : undefined,
            requirementSourceDocumentId: params.requirementSourceDocumentId,
            requirementId: params.requirementId,
            holderName,
            certificateHolder: params.certificateHolder,
            holderContactName: params.holderContactName,
            holderEmail: params.holderEmail,
            holderPhone: params.holderPhone,
            addressLine1: params.addressLine1,
            addressLine2: params.addressLine2,
            city: params.city,
            state: params.state,
            postalCode: params.postalCode,
            country: params.country,
            requestText: params.requestText,
            descriptionOfOperations: params.descriptionOfOperations,
            requestedEndorsements: params.requestedEndorsements,
          };
          const batch = await ctx.runAction(
            internal.certificates.generateBatchForOrg,
            {
              primaryPolicyId: policy?._id,
              requirementSourceDocumentId:
                params.requirementSourceDocumentId as
                  | Id<"requirementSourceDocuments">
                  | undefined,
              requirementId: params.requirementId as
                | Id<"insuranceRequirements">
                | undefined,
              orgId: targetOrgId,
              holderName: requirementsMode ? undefined : holderName,
              certificateHolder: params.certificateHolder,
              holderContactName: params.holderContactName,
              holderEmail: params.holderEmail,
              holderPhone: params.holderPhone,
              addressLine1: params.addressLine1,
              addressLine2: params.addressLine2,
              city: params.city,
              state: params.state,
              postalCode: params.postalCode,
              country: params.country,
              requestText: params.requestText,
              descriptionOfOperations: params.descriptionOfOperations,
              requestedEndorsements: params.requestedEndorsements,
              additionalInsuredName: params.additionalInsuredName,
              forceReissue: params.explicitReissue,
              source: certificateSourceForSurface(options.surface),
              createdByUserId: options.userId,
            },
          );
          const batchResults = (batch?.results ?? []) as Array<
            Record<string, any>
          >;
          const batchGaps = (batch?.gaps ?? []) as Array<Record<string, any>>;
          if (
            requirementsMode ||
            batchResults.length > 1 ||
            batchGaps.length > 0
          ) {
            const attachments: ToolAttachment[] = [];
            for (const item of batchResults) {
              if (item.policyId) {
                await recordToolPolicyReference(
                  item.policyId as Id<"policies">,
                  "generate_coi",
                  executionOptions,
                );
              }
              if (item.fileId) {
                const attachment = {
                  filename: item.fileName ?? "certificate-of-insurance.pdf",
                  contentType: "application/pdf",
                  size: Number(item.size ?? 0),
                  fileId: item.fileId as Id<"_storage">,
                  kind: "coi" as const,
                };
                attachments.push(attachment);
                await options.onResponseAttachment?.(attachment);
              }
              await options.onToolArtifact?.({
                type:
                  item.status === "held_policy_change_required"
                    ? "certificate_hold"
                    : "certificate_result",
                data: item,
              });
            }
            const readyCount = attachments.length;
            return {
              message: batchGaps.length
                ? `${readyCount} certificate${readyCount === 1 ? " is" : "s are"} attached. ${batchGaps.length} selected requirement${batchGaps.length === 1 ? " has" : "s have"} a coverage gap that needs review.`
                : `${readyCount} certificates were generated from the policies supporting the selected requirements and attached to this response.`,
              status: batch.status,
              generationBatchId: batch.generationBatchId,
              requirementSourceDocumentId: batch.requirementSourceDocumentId,
              certificateHolder: batch.holder,
              attachments,
              results: batchResults,
              gaps: batchGaps,
            };
          }
          if (!policy) return COI_GENERATION_FAILED_MESSAGE;
          const generated = batchResults[0];
          if (!generated) return COI_GENERATION_FAILED_MESSAGE;
          if (generated.status === "ambiguous_certificate_holder") {
            const workflowOutcome = certificateRecoverableOutcome({
              params: workflowParams,
              status: generated.status,
              message: generated.message,
              nextAction: "return_existing_certificate",
              artifactData: {
                status: generated.status,
                policyId: policy._id,
                reason: generated.reason,
                candidates: generated.candidates,
              },
            });
            return {
              message: generated.message,
              status: generated.status,
              reason: generated.reason,
              candidates: generated.candidates,
              workflowOutcome,
            };
          }
          if (generated.status === "held_policy_change_required") {
            const output = {
              message: generated.message,
              holdId: generated.holdId,
              requiredChanges: generated.requiredChanges,
              reasonCode: generated.reasonCode,
              evidence: generated.evidence,
              emailDraft: generated.emailDraft,
              brokerHandoffOffered: generated.brokerHandoffOffered,
              workflowOutcome: certificateHeldOutcome({
                params: workflowParams,
                generated,
                artifactData: {
                  status: generated.status,
                  holdId: generated.holdId,
                  requiredChanges: generated.requiredChanges,
                  reasonCode: generated.reasonCode,
                  evidence: generated.evidence,
                  emailDraft: generated.emailDraft,
                  brokerHandoffOffered: generated.brokerHandoffOffered,
                },
              }),
            };
            await options.onToolArtifact?.({
              type: "certificate_hold",
              data: output,
            });
            return output;
          }
          if (generated.status === "extraction_in_progress") {
            const workflowOutcome = certificateRecoverableOutcome({
              params: workflowParams,
              status: generated.status,
              message: generated.message,
              nextAction: "wait_for_extraction",
              artifactData: {
                status: generated.status,
                policyId: policy._id,
              },
            });
            return {
              message: generated.message,
              status: generated.status,
              policyId: policy._id,
              workflowOutcome,
            };
          }
          if (generated.status === "source_tree_rebuild_required") {
            const workflowOutcome = certificateRecoverableOutcome({
              params: workflowParams,
              status: generated.status,
              message: generated.message,
              nextAction: "wait_for_source_tree",
              artifactData: {
                status: generated.status,
                policyId: policy._id,
                rebuildStatus: generated.rebuildStatus,
              },
            });
            return {
              message: generated.message,
              status: generated.status,
              policyId: policy._id,
              rebuildStatus: generated.rebuildStatus,
              workflowOutcome,
            };
          }
          const attachment = {
            filename: generated.fileName,
            contentType: "application/pdf",
            size: generated.size,
            fileId: generated.fileId as Id<"_storage">,
            kind: "coi" as const,
          };
          await options.onResponseAttachment?.(attachment);
          if (generated.status === "existing") {
            const artifactData = {
              status: generated.status,
              policyId: policy._id,
              policyCertificateId: generated.policyCertificateId,
              certificateVersionId: generated.certificateVersionId,
              holderId: generated.holderId,
              versionNumber: generated.versionNumber,
              requestKind: generated.requestKind ?? "holder",
              additionalInsuredName: generated.additionalInsuredName,
            };
            const output = {
              message:
                "I found an existing COI for this holder and current policy version and attached it to this response.",
              attachment,
              holderId: generated.holderId,
              policyCertificateId: generated.policyCertificateId,
              certificateVersionId: generated.certificateVersionId,
              policyVersionId: generated.policyVersionId,
              versionNumber: generated.versionNumber,
              workflowOutcome: certificateGeneratedOutcome({
                params: workflowParams,
                generated,
                attachment,
                artifactData,
              }),
            };
            await options.onToolArtifact?.({
              type: "certificate_result",
              data: artifactData,
            });
            return output;
          }
          const artifactData = {
            status: generated.status,
            policyId: policy._id,
            certificateId: generated.certificateId,
            policyCertificateId: generated.policyCertificateId,
            certificateVersionId: generated.certificateVersionId,
            holderId: generated.holderId,
            versionNumber: generated.versionNumber,
            requestKind: generated.requestKind ?? "holder",
            additionalInsuredName: generated.additionalInsuredName,
          };
          const output = {
            message: "COI generated and attached to this response.",
            attachment,
            certificateId: generated.certificateId,
            holderId: generated.holderId,
            policyCertificateId: generated.policyCertificateId,
            certificateVersionId: generated.certificateVersionId,
            policyVersionId: generated.policyVersionId,
            versionNumber: generated.versionNumber,
            workflowOutcome: certificateGeneratedOutcome({
              params: workflowParams,
              generated,
              attachment,
              artifactData,
            }),
          };
          await options.onToolArtifact?.({
            type: "certificate_result",
            data: artifactData,
          });
          return output;
        } catch (err) {
          console.error("[agentToolExecutors] COI generation failed:", err);
          return COI_GENERATION_FAILED_MESSAGE;
        }
      },
    },
  };
}
