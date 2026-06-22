"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  addPolicyChangeInfo,
  answerApplicationQuestions,
  attachPolicyDocument,
  checkApplicationStatus,
  checkPolicyChangeStatus,
  compareCoverages,
  completePolicyChangeFromEndorsement,
  confirmPolicyFact,
  createPolicyChangeRequest,
  draftPolicyChangeSubmission,
  generateCoi,
  lookupComplianceRequirements,
  lookupPolicy,
  lookupPolicySection,
  prepareApplicationPacket,
  saveNote,
  startApplicationIntake,
} from "./chatTools";
import { COI_GENERATION_FAILED_MESSAGE } from "./actionFailures";
import {
  buildCertificateProgramSelection,
  normalizeSelectedPartnerProgramId,
} from "./certificateProgramSelection";
import {
  filterComplianceRequirements,
  formatComplianceRequirement,
} from "./complianceAgent";
import { coverageBreakdownForTool } from "./coverageBreakdown";
import { orgLabelForScope, type AgentScope } from "./agentScope";
import { evaluatePceIntake, type PceRequestKind } from "./pceIntake";
import { searchPolicyDocumentWithSourceSpans } from "./policyLookup";
import { resolvePolicyReferenceForOrg } from "./policyToolResolution";
import { buildVendorComplianceTools } from "./vendorComplianceTools";
import type { RequirementEvaluationTarget } from "./requirementSemantics";

type AgentToolSurface = "web" | "email" | "imessage" | "mcp";

type ToolAttachment = {
  filename: string;
  contentType: string;
  size: number;
  fileId?: Id<"_storage">;
};

type ToolArtifact = {
  type: string;
  data: unknown;
};

type PolicyChangeDraftResult = {
  needsRecipient?: boolean;
  recipientEmail?: string;
  recipientName?: string;
  subject?: string;
  body?: string;
  ccAddresses?: string[];
  bccAddresses?: string[];
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
};

type PolicyChangeCaseForTool = {
  _id: Id<"policyChangeCases">;
  orgId: Id<"organizations">;
  policyId?: Id<"policies">;
  affectedPolicyIds?: Id<"policies">[];
  status?: string;
  summary?: string;
  requestText?: string;
  updatedAt?: number;
};

type PolicyChangeStatusForTool = {
  caseId: Id<"policyChangeCases">;
} & Record<string, unknown>;

export type BuildAgentToolExecutorsOptions = {
  surface: AgentToolSurface;
  orgId: Id<"organizations">;
  userId: Id<"users">;
  scope: AgentScope;
  operatorInitiatedUserMessageId?: Id<"threadMessages">;
  readOrgIds?: Id<"organizations">[];
  writableOrgIds?: Id<"organizations">[];
  org?: Record<string, unknown> | null;
  threadId?: Id<"threads">;
  defaultPolicyChangeCaseId?: Id<"policyChangeCases">;
  getCurrentPolicyChangeCaseId?: () => Id<"policyChangeCases"> | undefined;
  canWrite?: boolean;
  writeUnavailableMessage?: string;
  availableFileIds?: Set<string>;
  onPolicyReferenced?: (policyId: Id<"policies">) => void | Promise<void>;
  onResponseAttachment?: (attachment: ToolAttachment) => void | Promise<void>;
  onToolArtifact?: (artifact: ToolArtifact) => void | Promise<void>;
  onPolicyChangeCase?: (
    caseId: Id<"policyChangeCases">,
  ) => void | Promise<void>;
  onPolicyChangeEmailDraft?: (args: {
    caseId: Id<"policyChangeCases">;
    draft: PolicyChangeDraftResult;
  }) =>
    | void
    | { pendingEmailId?: Id<"pendingEmails"> }
    | Promise<void | { pendingEmailId?: Id<"pendingEmails"> }>;
};

function certificateSourceForSurface(surface: AgentToolSurface) {
  if (surface === "web") return "chat" as const;
  if (surface === "mcp") return "mcp" as const;
  return surface;
}

function orgMemorySourceForSurface(surface: AgentToolSurface) {
  if (surface === "email" || surface === "imessage") return surface;
  return "chat" as const;
}

function applicationSourceForSurface(surface: AgentToolSurface) {
  if (surface === "web") return "web" as const;
  return surface;
}

function programSelectionSourceForSurface(surface: AgentToolSurface) {
  if (surface === "email" || surface === "imessage") return surface;
  if (surface === "web") return "chat" as const;
  return "agent" as const;
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
  return {
    id: policy._id,
    client:
      scope.mode === "broker_portfolio"
        ? orgLabelForScope(scope, policy.orgId)
        : policy._scopeOrgName,
    orgId: policy.orgId,
    insured: policy.insuredName,
    carrier: policy.security,
    type: policy.policyTypes?.join(", "),
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
      origin: coverage.coverageOrigin,
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
      const policies = await ctx.runQuery(
        internal.policies.listAllPreviewReadableInternal,
        { orgId },
      );
      return (policies as Array<Record<string, unknown>>).map((policy) => ({
        ...policy,
        _scopeOrgName: orgLabelForScope(options.scope, orgId),
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
  await options.onPolicyReferenced?.(policy._id);
  return { ok: true, policy };
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

function policyChangeCaseMatchesPolicy(
  changeCase: PolicyChangeCaseForTool,
  policyId?: Id<"policies">,
) {
  if (!policyId) return true;
  if (changeCase.policyId) return String(changeCase.policyId) === String(policyId);
  return Array.isArray(changeCase.affectedPolicyIds)
    ? changeCase.affectedPolicyIds.some((id: unknown) => String(id) === String(policyId))
    : false;
}

function activePolicyChangeCase(changeCase: PolicyChangeCaseForTool) {
  return !["completed", "declined", "cancelled"].includes(String(changeCase.status));
}

function caseSelectionResponse(
  message: string,
  candidates: PolicyChangeCaseForTool[] = [],
) {
  return {
    status: "needs_case_selection",
    message,
    cases: candidates.slice(0, 8).map((changeCase) => ({
      caseId: changeCase._id,
      policyId: changeCase.policyId,
      status: changeCase.status,
      summary: changeCase.summary,
      requestText: typeof changeCase.requestText === "string"
        ? changeCase.requestText.slice(0, 500)
        : undefined,
      updatedAt: changeCase.updatedAt,
    })),
  };
}

async function resolvePolicyChangeCaseForTool(
  ctx: ActionCtx,
  options: BuildAgentToolExecutorsOptions,
  args: {
    caseId?: string;
    policyId?: Id<"policies">;
    orgId: Id<"organizations">;
    activeOnly?: boolean;
    actionLabel: string;
  },
) {
  const explicitCaseId = args.caseId?.trim();
  if (explicitCaseId) {
    const explicitMatches = await ctx.runQuery(
      internal.policyChanges.resolveCaseCandidatesInternal,
      {
        orgId: args.orgId,
        candidateCaseIds: [explicitCaseId],
        activeOnly: false,
      },
    ) as PolicyChangeCaseForTool[];
    const explicit = explicitMatches.find((changeCase) =>
      String(changeCase._id) === explicitCaseId,
    );
    if (explicit) {
      if (!canWriteOrg(options, explicit.orgId)) {
        return {
          ok: false as const,
          response: writeUnavailable(options, args.actionLabel),
        };
      }
      if (!policyChangeCaseMatchesPolicy(explicit, args.policyId)) {
        return {
          ok: false as const,
          response: caseSelectionResponse(
            "That policy change case belongs to a different policy. Choose the correct case for this policy before continuing.",
            [explicit],
          ),
        };
      }
      if (args.activeOnly !== false && !activePolicyChangeCase(explicit)) {
        return {
          ok: false as const,
          response: caseSelectionResponse(
            "That policy change case is already closed and cannot be used for this action.",
            [explicit],
          ),
        };
      }
      return {
        ok: true as const,
        caseId: explicit._id,
      };
    }
  }

  const candidateCaseIds = [
    explicitCaseId,
    options.getCurrentPolicyChangeCaseId?.(),
    options.defaultPolicyChangeCaseId,
  ]
    .filter((caseId): caseId is string | Id<"policyChangeCases"> => Boolean(caseId))
    .map(String);
  const candidates = await ctx.runQuery(
    internal.policyChanges.resolveCaseCandidatesInternal,
    {
      orgId: args.orgId,
      policyId: args.policyId,
      threadId: options.threadId,
      candidateCaseIds,
      activeOnly: args.activeOnly !== false,
    },
  ) as PolicyChangeCaseForTool[];
  const writableCandidates = candidates.filter((changeCase) =>
    canWriteOrg(options, changeCase.orgId),
  );

  if (writableCandidates.length === 1) {
    const changeCase = writableCandidates[0];
    return {
      ok: true as const,
      caseId: changeCase._id,
    };
  }
  if (writableCandidates.length > 1) {
    return {
      ok: false as const,
      response: caseSelectionResponse(
        "I found multiple active policy change cases that could match this request. Ask which case to use before continuing.",
        writableCandidates,
      ),
    };
  }
  return {
    ok: false as const,
    response: caseSelectionResponse(
      `I could not resolve the policy change case for this ${args.actionLabel}. Ask for the case to use before continuing.`,
    ),
  };
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
  return {
    lookup_policy: {
      ...lookupPolicy,
      execute: async (params: {
        query: string;
        policyType?: string;
        carrier?: string;
      }) => {
        const policies = await listPoliciesForReadableOrgs(ctx, options);
        const { policySearchScore } = await import("./aiUtils");
        const scored = policies
          .map((policy) => ({
            policy,
            score: policySearchScore(
              policy,
              params.query,
              params.policyType,
              params.carrier,
            ),
          }))
          .filter((match) => match.score > 0)
          .sort((left, right) => right.score - left.score);
        const matches =
          scored.length > 0
            ? scored.map((match) => match.policy)
            : policies.slice(0, 5);
        if (matches.length === 0)
          return "No policies found for this organization.";
        for (const policy of matches.slice(0, 5)) {
          if (policy._id)
            await options.onPolicyReferenced?.(policy._id as Id<"policies">);
        }
        return matches
          .slice(0, 5)
          .map((policy) =>
            formatPolicyForTool(policy as Record<string, any>, options.scope),
          );
      },
    },
    compare_coverages: {
      ...compareCoverages,
      execute: async (params: { policyId1: string; policyId2: string }) => {
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
        appliesTo?: "vendors" | "own_org" | "both" | "all";
        evaluationTarget?: RequirementEvaluationTarget | "all";
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
    ...buildVendorComplianceTools(
      ctx,
      (options.readOrgIds ?? options.scope.readOrgIds).map((orgId) =>
        String(orgId),
      ),
    ),
    lookup_policy_section: {
      ...lookupPolicySection,
      execute: async (params: { policyId: string; query: string }) => {
        const resolved = await resolveFinalReadablePolicy(
          ctx,
          options,
          params.policyId,
          "exact source lookup",
        );
        if (!resolved.ok) return resolved.message;
        await options.onPolicyReferenced?.(
          resolved.policy._id as Id<"policies">,
        );
        return searchPolicyDocumentWithSourceSpans(
          ctx,
          resolved.policy,
          params.query,
          8,
        );
      },
    },
    save_note: {
      ...saveNote,
      execute: async (params: {
        content: string;
        type: string;
        policyId?: string;
      }) => {
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
        }
        await ctx.runMutation(internal.orgMemory.upsert, {
          orgId: targetOrgId,
          type: typeMap(params.type),
          content: params.content,
          source: orgMemorySourceForSurface(options.surface),
          policyId,
        });
        return "Note saved.";
      },
    },
    start_application_intake: {
      ...startApplicationIntake,
      execute: async (params: {
        targetOrgId?: string;
        templateId?: string;
        title?: string;
        lineOfBusiness?: string;
        product?: string;
        requestText: string;
        missingQuestions?: Array<{
          fieldId: string;
          label: string;
          section?: string;
          prompt: string;
          required?: boolean;
        }>;
      }) => {
        if (options.canWrite === false)
          return writeUnavailable(options, "start an application intake");
        const targetOrgId = params.targetOrgId
          ? (params.targetOrgId as Id<"organizations">)
          : options.scope.mode === "client"
            ? options.orgId
            : undefined;
        if (!targetOrgId) {
          return "Choose the client organization before starting an application intake.";
        }
        if (!canWriteOrg(options, targetOrgId)) {
          return writeUnavailable(options, "start an application intake for that client");
        }
        const intake = await ctx.runMutation(
          internal.applicationIntakes.startFromAgent,
          {
            orgId: targetOrgId,
            userId: options.userId,
            templateId: params.templateId as Id<"applicationTemplates"> | undefined,
            sourceKind: applicationSourceForSurface(options.surface),
            requestText: params.requestText,
            title: params.title,
            lineOfBusiness: params.lineOfBusiness,
            product: params.product,
            threadId: options.threadId,
            missingQuestions: params.missingQuestions?.map((question) => ({
              ...question,
              required: question.required ?? true,
            })),
          },
        );
        const output = {
          message: "Application intake started.",
          applicationIntakeId: intake?._id,
          status: intake?.status,
          title: intake?.title,
          missingQuestions: intake?.missingQuestions,
        };
        await options.onToolArtifact?.({
          type: "application_intake",
          data: output,
        });
        return output;
      },
    },
    answer_application_questions: {
      ...answerApplicationQuestions,
      execute: async (params: {
        applicationIntakeId: string;
        answers: Array<{
          fieldId: string;
          label: string;
          section?: string;
          value: string;
          sourceSpanIds?: string[];
          userSourceSpanIds?: string[];
        }>;
        message?: string;
      }) => {
        if (options.canWrite === false)
          return writeUnavailable(options, "answer application questions");
        const intake = await ctx.runMutation(
          internal.applicationIntakes.recordAnswersFromAgent,
          {
            applicationIntakeId: params.applicationIntakeId as Id<"applicationIntakes">,
            userId: options.userId,
            answers: params.answers,
            sourceKind: applicationSourceForSurface(options.surface),
            message: params.message,
          },
        );
        const output = {
          message: "Application answers saved.",
          applicationIntakeId: intake?._id,
          status: intake?.status,
          missingQuestions: intake?.missingQuestions,
        };
        await options.onToolArtifact?.({
          type: "application_intake",
          data: output,
        });
        return output;
      },
    },
    check_application_status: {
      ...checkApplicationStatus,
      execute: async (params: { applicationIntakeId?: string }) => {
        if (params.applicationIntakeId) {
          const intake = await ctx.runQuery(
            internal.applicationIntakes.getForAgent,
            {
              applicationIntakeId: params.applicationIntakeId as Id<"applicationIntakes">,
              userId: options.userId,
            },
          );
          if (!intake) return "Application intake not found.";
          return {
            applicationIntakeId: intake._id,
            title: intake.title,
            status: intake.status,
            missingQuestions: intake.missingQuestions,
            answerCount: intake.normalizedAnswers.length,
            packetId: intake.packetId,
          };
        }
        const rows = await ctx.runQuery(
          internal.applicationIntakes.listForAgent,
          {
            orgIds: options.writableOrgIds ?? options.scope.writableOrgIds,
            userId: options.userId,
          },
        );
        return {
          applications: rows.map((row) => ({
            applicationIntakeId: row._id,
            orgId: row.orgId,
            title: row.title,
            status: row.status,
            missingQuestionCount: row.missingQuestions.length,
            answerCount: row.normalizedAnswers.length,
            updatedAt: row.updatedAt,
          })),
        };
      },
    },
    prepare_application_packet: {
      ...prepareApplicationPacket,
      execute: async (params: {
        applicationIntakeId: string;
        submissionNotes?: string;
      }) => {
        if (options.canWrite === false)
          return writeUnavailable(options, "prepare an application for review");
        const packet = await ctx.runMutation(
          internal.applicationIntakes.preparePacketFromAgent,
          {
            applicationIntakeId: params.applicationIntakeId as Id<"applicationIntakes">,
            userId: options.userId,
            submissionNotes: params.submissionNotes,
          },
        );
        const output = {
          message: packet?.status === "broker_ready"
            ? "Application is ready for broker review and carrier submission."
            : "Application review prepared, but required information is still missing.",
          packetId: packet?._id,
          status: packet?.status,
          missingFieldIds: packet?.missingFieldIds,
        };
        await options.onToolArtifact?.({
          type: "application_packet",
          data: output,
        });
        return output;
      },
    },
    attach_policy_document: {
      ...attachPolicyDocument,
      execute: async (params: { policyId: string }) => {
        const resolved = await resolveFinalReadablePolicy(
          ctx,
          options,
          params.policyId,
          "original policy delivery",
        );
        if (!resolved.ok) return resolved.message;
        const policy = resolved.policy;
        if (!policy.fileId)
          return "That policy does not have an original PDF file available.";
        const attachment = {
          filename: policy.fileName ?? `${policy.policyNumber ?? "policy"}.pdf`,
          contentType: "application/pdf",
          size: 0,
          fileId: policy.fileId as Id<"_storage">,
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
      execute: async (params: {
        policyId: string;
        fact: string;
        sourceSpanIds: string[];
        fieldUpdates?: Record<string, string | undefined>;
      }) => {
        const resolved = await resolveFinalWritablePolicy(
          ctx,
          options,
          params.policyId,
          "source-backed fact confirmation",
        );
        if (!resolved.ok) return resolved.message;
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
      execute: async (params: {
        policyId: string;
        certificateHolder?: string;
        holderContactName?: string;
        holderEmail?: string;
        holderPhone?: string;
        requestText?: string;
        requestedEndorsements?: string[];
        partnerProgramId?: string;
        explicitReissue?: boolean;
      }) => {
        const resolved = await resolveFinalWritablePolicy(
          ctx,
          options,
          params.policyId,
          "certificate generation",
        );
        if (!resolved.ok) return resolved.message;
        const autoGenerate = options.org?.autoGenerateCoi !== false;
        if (!autoGenerate) {
          const handling = options.org?.coiHandling ?? "ignore";
          if (handling === "broker")
            return "COI auto-generation is off. Please contact your broker to obtain this certificate.";
          if (handling === "member")
            return "COI auto-generation is off. Please route this COI request to your primary insurance contact.";
          return "COI auto-generation is disabled for this organization.";
        }
        try {
          const policy = resolved.policy;
          const generated = await ctx.runAction(
            internal.certificates.generateForOrg,
            {
              policyId: policy._id,
              orgId: policy.orgId,
              holderName:
                params.certificateHolder?.split(/\r?\n/)[0]?.trim() ||
                "Certificate holder",
              certificateHolder: params.certificateHolder,
              holderContactName: params.holderContactName,
              holderEmail: params.holderEmail,
              holderPhone: params.holderPhone,
              requestText: params.requestText,
              requestedEndorsements: params.requestedEndorsements,
              selectedPartnerProgramId: normalizeSelectedPartnerProgramId(
                params.partnerProgramId,
              ),
              forceReissue: params.explicitReissue,
              source: certificateSourceForSurface(options.surface),
              createdByUserId: options.userId,
            },
          );
          if (!generated) return COI_GENERATION_FAILED_MESSAGE;
          if (generated.status === "held_policy_change_required") {
            const output = {
              message: generated.message,
              holdId: generated.holdId,
              policyChangeCaseId: generated.policyChangeCaseId,
              requiredChanges: generated.requiredChanges,
              reasonCode: generated.reasonCode,
              evidence: generated.evidence,
              brokerHandoffOffered: generated.brokerHandoffOffered,
            };
            await options.onToolArtifact?.({
              type: "certificate_hold",
              data: output,
            });
            if (generated.policyChangeCaseId) {
              await options.onPolicyChangeCase?.(
                generated.policyChangeCaseId as Id<"policyChangeCases">,
              );
            }
            return output;
          }
          if (generated.status === "pending_approval") {
            await options.onToolArtifact?.({
              type: "certificate_result",
              data: {
                status: generated.status,
                policyId: policy._id,
                certificateRequestId: generated.requestId,
                holderName:
                  params.certificateHolder?.split(/\r?\n/)[0]?.trim() ||
                  "Certificate holder",
                authorityType: generated.authorityType,
                certificationStatus: generated.certificationStatus,
              },
            });
            return {
              message:
                "Certified COI request created and sent to the program administrator for approval.",
              requestId: generated.requestId,
              authorityType: generated.authorityType,
              certificationStatus: generated.certificationStatus,
            };
          }
          if (generated.status === "needs_program_selection") {
            const selection = buildCertificateProgramSelection({
              policyId: String(policy._id),
              holderName:
                params.certificateHolder?.split(/\r?\n/)[0]?.trim() ||
                "Certificate holder",
              certificateHolder: params.certificateHolder,
              candidates: generated.matchCandidates,
              source: programSelectionSourceForSurface(options.surface),
            });
            const output = {
              message:
                "I found multiple possible program administrator programs. Choose one to generate the certified COI.",
              candidates: generated.matchCandidates,
              programSelection: selection,
              authorityType: generated.authorityType,
              certificationStatus: generated.certificationStatus,
            };
            if (selection) {
              await options.onToolArtifact?.({
                type: "certificate_program_selection",
                data: selection,
              });
            }
            return output;
          }
          if (generated.status === "extraction_in_progress") {
            return {
              message: generated.message,
              status: generated.status,
              policyId: policy._id,
            };
          }
          const attachment = {
            filename: generated.fileName,
            contentType: "application/pdf",
            size: generated.size,
            fileId: generated.fileId as Id<"_storage">,
          };
          await options.onResponseAttachment?.(attachment);
          if (generated.status === "existing") {
            const output = {
              message:
                generated.authorityType === "certified"
                  ? "I found an existing certified COI for this holder and current policy version and attached it to this response."
                  : "I found an existing non-binding COI for this holder and current policy version and attached it to this response.",
              attachment,
              holderId: generated.holderId,
              policyCertificateId: generated.policyCertificateId,
              certificateVersionId: generated.certificateVersionId,
              policyVersionId: generated.policyVersionId,
              versionNumber: generated.versionNumber,
            };
            await options.onToolArtifact?.({
              type: "certificate_result",
              data: {
                status: generated.status,
                policyId: policy._id,
                policyCertificateId: generated.policyCertificateId,
                certificateVersionId: generated.certificateVersionId,
                holderId: generated.holderId,
                versionNumber: generated.versionNumber,
                authorityType: generated.authorityType,
                certificationStatus: generated.certificationStatus,
              },
            });
            return output;
          }
          const output = {
            message:
              generated.authorityType === "certified"
                ? "Certified COI generated and attached to this response."
                : "Non-binding COI generated and attached to this response.",
            attachment,
            certificateId: generated.certificateId,
            holderId: generated.holderId,
            policyCertificateId: generated.policyCertificateId,
            certificateVersionId: generated.certificateVersionId,
            policyVersionId: generated.policyVersionId,
            versionNumber: generated.versionNumber,
          };
          await options.onToolArtifact?.({
            type: "certificate_result",
            data: {
              status: generated.status,
              policyId: policy._id,
              certificateId: generated.certificateId,
              policyCertificateId: generated.policyCertificateId,
              certificateVersionId: generated.certificateVersionId,
              holderId: generated.holderId,
              versionNumber: generated.versionNumber,
              authorityType: generated.authorityType,
              certificationStatus: generated.certificationStatus,
            },
          });
          return output;
        } catch (err) {
          console.error("[agentToolExecutors] COI generation failed:", err);
          return COI_GENERATION_FAILED_MESSAGE;
        }
      },
    },
    create_policy_change_request: {
      ...createPolicyChangeRequest,
      execute: async (params: {
        requestKind?: PceRequestKind;
        requestText: string;
        policyId?: string;
        evidenceSourceIds?: string[];
      }) => {
        if (options.canWrite === false)
          return writeUnavailable(options, "capture a broker follow-up");
        const intake = evaluatePceIntake({
          requestKind: params.requestKind,
          requestText: params.requestText,
        });
        if (!intake.allowed) return intake.message;
        let targetOrgId = options.orgId;
        let policyId: Id<"policies"> | undefined;
        if (params.policyId) {
          const resolved = await resolveFinalWritablePolicy(
            ctx,
            options,
            params.policyId,
            "broker follow-ups",
          );
          if (!resolved.ok) return resolved.message;
          targetOrgId = resolved.policy.orgId;
          policyId = resolved.policy._id;
        }
        const createArgsBase: {
          orgId: Id<"organizations">;
          userId: Id<"users">;
          policyId?: Id<"policies">;
          requestText: string;
          evidenceSourceIds?: string[];
        } = {
          orgId: targetOrgId,
          userId: options.userId,
          policyId,
          requestText: params.requestText,
          evidenceSourceIds: params.evidenceSourceIds,
        };
        const result =
          options.surface === "email"
            ? await ctx.runAction(
                internal.actions.policyChangeRequests.createFromEmailForThread,
                createArgsBase,
              )
            : await ctx.runAction(
                internal.actions.policyChangeRequests.createFromChatForThread,
                {
                  ...createArgsBase,
                  operatorInitiatedUserMessageId:
                    options.surface === "web"
                      ? options.operatorInitiatedUserMessageId
                      : undefined,
                },
              );
        if (result?.error) return result.error;
        const caseId = result?.caseId as Id<"policyChangeCases"> | undefined;
        if (caseId) await options.onPolicyChangeCase?.(caseId);
        return {
          message: "Broker follow-up captured.",
          status: "created",
          caseId,
          requestKind: intake.kind,
          usedSdkPce: Boolean(result?.usedSdkPce),
        };
      },
    },
    add_policy_change_info: {
      ...addPolicyChangeInfo,
      execute: async (params: {
        caseId: string;
        infoText: string;
        sourceSpanIds?: string[];
      }) => {
        if (options.canWrite === false)
          return writeUnavailable(options, "update a broker follow-up");
        await ctx.runMutation(internal.policyChanges.addInfo, {
          caseId: params.caseId as Id<"policyChangeCases">,
          userId: options.userId,
          infoText: params.infoText,
          sourceSpanIds: params.sourceSpanIds,
        });
        return { status: "updated", caseId: params.caseId };
      },
    },
    check_policy_change_status: {
      ...checkPolicyChangeStatus,
      execute: async (params: {
        caseId?: string;
        policyId?: string;
        includeClosed?: boolean;
      }) => {
        let policyId: Id<"policies"> | undefined;
        if (params.policyId) {
          const resolved = await resolveReadablePolicy(
            ctx,
            options,
            params.policyId,
          );
          if (!resolved.ok) return resolved.message;
          policyId = resolved.policy._id;
        }
        const rows = await ctx.runQuery(
          internal.policyChanges.listForAgentInternal,
          {
            orgIds: options.readOrgIds ?? options.scope.readOrgIds,
            caseId: params.caseId,
            policyId,
            threadId: options.threadId,
            includeClosed: params.includeClosed,
            limit: 10,
          },
        ) as PolicyChangeStatusForTool[];

        if (rows.length === 0) {
          if (params.caseId) {
            return "Policy change case not found in this scope.";
          }
          if (policyId) {
            return "No active broker follow-ups found for that policy.";
          }
          return params.includeClosed
            ? "No broker follow-ups found in this scope."
            : "No active broker follow-ups found in this scope.";
        }

        if (rows.length === 1) await options.onPolicyChangeCase?.(rows[0].caseId);

        return {
          brokerFollowUps: rows,
          count: rows.length,
          includeClosed: params.includeClosed === true,
        };
      },
    },
    draft_policy_change_email: {
      ...draftPolicyChangeSubmission,
      execute: async (params: {
        caseId?: string;
        recipientEmail?: string;
        recipientName?: string;
        instructions?: string;
      }) => {
        if (options.canWrite === false)
          return writeUnavailable(options, "draft a broker email");
        const resolvedCase = await resolvePolicyChangeCaseForTool(ctx, options, {
          caseId: params.caseId,
          orgId: options.orgId,
          activeOnly: true,
          actionLabel: "draft a broker email",
        });
        if (!resolvedCase.ok) return resolvedCase.response;
        const draft = await ctx.runMutation(internal.policyChanges.draftSubmission, {
          caseId: resolvedCase.caseId,
          userId: options.userId,
          recipientEmail: params.recipientEmail,
          recipientName: params.recipientName,
          instructions: params.instructions,
        });
        const callbackResult = await options.onPolicyChangeEmailDraft?.({
          caseId: resolvedCase.caseId,
          draft,
        });
        const pendingEmailId =
          callbackResult && typeof callbackResult === "object"
            ? callbackResult.pendingEmailId
            : undefined;
        const draftWithOptionalAddresses = draft as PolicyChangeDraftResult;
        return {
          status: draft.needsRecipient ? "needs_recipient" : "drafted",
          caseId: resolvedCase.caseId,
          readyToSend: !draft.needsRecipient,
          nextAction: draft.needsRecipient
            ? "Ask for the broker email address."
            : "Show the email details and ask for approval before sending.",
          pendingEmailId,
          emailDraft: {
            recipientEmail: draft.recipientEmail,
            recipientName: draft.recipientName,
            ccAddresses: draftWithOptionalAddresses.ccAddresses,
            bccAddresses: draftWithOptionalAddresses.bccAddresses,
            subject: draft.subject,
            body: draft.body,
          },
        };
      },
    },
    complete_policy_change_from_endorsement: {
      ...completePolicyChangeFromEndorsement,
      execute: async (params: {
        caseId?: string;
        policyId: string;
        files: Array<{ fileId: string; fileName: string }>;
        summary?: string;
        fieldUpdates?: Record<string, unknown>;
      }) => {
        const resolved = await resolveFinalWritablePolicy(
          ctx,
          options,
          params.policyId,
          "endorsement completion",
        );
        if (!resolved.ok) return resolved.message;
        const resolvedCase = await resolvePolicyChangeCaseForTool(ctx, options, {
          caseId: params.caseId,
          orgId: resolved.policy.orgId,
          policyId: resolved.policy._id,
          activeOnly: true,
          actionLabel: "attach an endorsement",
        });
        if (!resolvedCase.ok) return resolvedCase.response;
        if (options.availableFileIds) {
          for (const file of params.files) {
            if (!options.availableFileIds.has(file.fileId)) {
              return `Storage ID ${file.fileId} does not match any attachment on this message.`;
            }
          }
        }
        const result = await ctx.runMutation(internal.policyChanges.completeFromEndorsement, {
          caseId: resolvedCase.caseId,
          userId: options.userId,
          policyId: resolved.policy._id,
          files: params.files.map((file) => ({
            fileId: file.fileId as Id<"_storage">,
            fileName: file.fileName,
          })),
          summary: params.summary,
          fieldUpdates: params.fieldUpdates,
        });
        await options.onPolicyChangeCase?.(resolvedCase.caseId);
        await options.onToolArtifact?.({
          type: "policy_change_result",
          data: {
            status: "completed",
            caseId: resolvedCase.caseId,
            policyId: resolved.policy._id,
          },
        });
        return { status: "completed", caseId: resolvedCase.caseId, ...result };
      },
    },
  };
}
