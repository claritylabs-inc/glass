"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  attachPolicyDocument,
  compareCoverages,
  confirmPolicyFact,
  generateCoi,
  lookupComplianceRequirements,
  lookupPolicy,
  lookupPolicySection,
  saveNote,
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
import type { RequirementEvaluationTarget } from "./requirementSemantics";
import { lobLabel, policyLobCodes } from "./linesOfBusiness";

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
  onPolicyReferenced?: (policyId: Id<"policies">) => void | Promise<void>;
  onResponseAttachment?: (attachment: ToolAttachment) => void | Promise<void>;
  onToolArtifact?: (artifact: ToolArtifact) => void | Promise<void>;
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
    linesOfBusiness: policyLobCodes(policy),
    type: policyLobCodes(policy).filter((code) => code !== "UN").map(lobLabel).join(", "),
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
        lineOfBusiness?: string;
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
              params.lineOfBusiness ?? params.policyType,
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
        });
        if (!savedId) {
          return "Not saved. Memory is limited to stable company context, not policy details, agent behavior, drafts, requests, or workflow state.";
        }
        return "Note saved.";
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
        addressLine1?: string;
        addressLine2?: string;
        city?: string;
        state?: string;
        postalCode?: string;
        requestText?: string;
        requestedEndorsements?: string[];
        additionalInsuredName?: string;
        certificateForm?: "acord25" | "acord24" | "acord27" | "acord28" | "acord29" | "acord30" | "acord31";
        explicitReissue?: boolean;
      }) => {
        const resolved = await resolveFinalWritablePolicy(
          ctx,
          options,
          params.policyId,
          "certificate generation",
        );
        if (!resolved.ok) return resolved.message;
        try {
          const policy = resolved.policy;
          const holderName =
            params.certificateHolder?.split(/\r?\n/)[0]?.trim() ||
            "Certificate holder";
          const workflowParams: CertificateRequestWorkflowParams = {
            policyId: String(policy._id),
            holderName,
            certificateHolder: params.certificateHolder,
            holderContactName: params.holderContactName,
            holderEmail: params.holderEmail,
            holderPhone: params.holderPhone,
            requestText: params.requestText,
            requestedEndorsements: params.requestedEndorsements,
          };
          const generated = await ctx.runAction(
            internal.certificates.generateForOrg,
            {
              policyId: policy._id,
              orgId: policy.orgId,
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
              requestText: params.requestText,
              requestedEndorsements: params.requestedEndorsements,
              additionalInsuredName: params.additionalInsuredName,
              formCode: params.certificateForm,
              forceReissue: params.explicitReissue,
              source: certificateSourceForSurface(options.surface),
              createdByUserId: options.userId,
            },
          );
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
              formCode: generated.formCode,
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
            formCode: generated.formCode,
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
