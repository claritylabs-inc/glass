import { getAuthUserId } from "@convex-dev/auth/server";
import dayjs from "dayjs";
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getOrgAccess, getPolicyAccessForQuery } from "./lib/access";
import {
  certificateHolderDisplayBlock,
  parseCertificateHolderBlock,
  type CertificateHolderAddressInput,
} from "./lib/certificateIdentity";
import {
  buildCertificateGateEvidencePacket,
  inferCertificateEndorsements,
  type CertificateEndorsementKind,
  type CertificateGateEvidence,
  type CertificateGateVerdict,
} from "./lib/certificateRequestGate";
import {
  buildBrokerSubmissionFromIdentity,
  missingBrokerRecipientInfo,
} from "./lib/policyChangeBrokerRouting";
import { makeGenerateObject } from "./lib/sdkCallbacks";
import { z } from "zod";

const certificateSourceValidator = v.union(
  v.literal("policy_page"),
  v.literal("chat"),
  v.literal("email"),
  v.literal("imessage"),
  v.literal("sms"),
  v.literal("api"),
  v.literal("mcp"),
  v.literal("agent"),
  v.literal("unknown"),
);

const requestedEndorsementValidator = v.array(v.string());

function cleanOptionalText(value?: string) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function structuredCertificateHolderAddress(args: {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}) {
  const address = {
    line1: cleanOptionalText(args.addressLine1),
    line2: cleanOptionalText(args.addressLine2),
    city: cleanOptionalText(args.city),
    state: cleanOptionalText(args.state),
    postalCode: cleanOptionalText(args.postalCode),
  };
  return Object.values(address).some(Boolean) ? address : undefined;
}

function sourceKindForPolicyChange(source: string | undefined):
  | "manual"
  | "chat"
  | "email"
  | "imessage"
  | "mcp" {
  if (source === "email") return "email";
  if (source === "imessage" || source === "sms") return "imessage";
  if (source === "mcp") return "mcp";
  if (source === "chat") return "chat";
  return "manual";
}

function formatGateMessage(args: {
  holderName: string;
  reasonMessage: string;
  policyChangeCaseId?: Id<"policyChangeCases">;
  policyChangeRequestsEnabled: boolean;
}) {
  const nextStep = args.policyChangeRequestsEnabled
    ? "I opened a policy change request so the broker can process the endorsement before this certificate is issued."
    : "Your broker has turned off Glass policy-change requests, so I can help loop the broker in by email or iMessage instead.";
  return `${args.reasonMessage} I put the certificate for ${args.holderName} on hold. ${nextStep}`;
}

const certificateGateReviewSchema = z.object({
  status: z.enum(["allowed", "held"]),
  reasonCode: z.enum([
    "policy_change_required",
    "missing_policy_evidence",
    "ambiguous_policy_evidence",
    "conflicting_policy_evidence",
  ]).nullable(),
  reasonMessage: z.string(),
  requiredChanges: z.array(z.enum([
    "additional_insured",
    "named_insured",
    "waiver_of_subrogation",
    "primary_non_contributory",
    "loss_payee",
    "mortgagee",
    "special_wording",
    "policy_change",
  ])).max(8),
  evidenceIds: z.array(z.string()).max(8),
});

async function evaluateCertificateRequestGateWithLlm(params: {
  ctx: any;
  orgId: Id<"organizations">;
  policyId: Id<"policies">;
  certificateHolder?: string;
  requestText?: string;
  requestedEndorsements?: string[];
  policy?: Record<string, unknown> | null;
  sourceSpans?: any[];
  sourceNodes?: any[];
}): Promise<CertificateGateVerdict> {
  const requiredChanges = inferCertificateEndorsements(params);
  if (requiredChanges.length === 0) {
    return { status: "allowed", requiredChanges, evidence: [] };
  }
  const evidencePacket = buildCertificateGateEvidencePacket({
    policy: params.policy,
    sourceSpans: params.sourceSpans,
    sourceNodes: params.sourceNodes,
    certificateHolder: params.certificateHolder,
    requestText: params.requestText,
    requestedEndorsements: params.requestedEndorsements,
  });
  if (evidencePacket.length === 0) {
    return {
      status: "held",
      reasonCode: "missing_policy_evidence",
      reasonMessage:
        "I need broker review before issuing this certificate because Glass could not find source-backed policy or endorsement evidence for the requested certificate wording.",
      requiredChanges,
      evidence: [],
    };
  }

  const generateGateObject = makeGenerateObject("analysis", {
    ctx: params.ctx,
    orgId: params.orgId,
    tracePolicyId: params.policyId,
  });
  try {
    const result = await generateGateObject({
      schema: certificateGateReviewSchema,
      maxTokens: 1400,
      system: `You are a conservative certificate-of-insurance gate reviewer.

Decide whether Glass may issue the requested COI from existing policy and endorsement evidence.

Rules:
- Use only the provided evidence IDs. Do not invent evidence.
- If the request asks for additional insured wording, first check all endorsement evidence to determine whether the exact person/company/certificate holder is already scheduled, named, or added as an additional insured by an existing endorsement.
- If the holder is already scheduled/named/added by endorsement, allow the certificate and cite that endorsement evidence.
- If policy wording automatically grants additional insured status to the holder's class without a new endorsement, allow and cite that evidence.
- If the holder is not already scheduled/named and the policy requires scheduled/named additional insureds to be added by endorsement, hold with reasonCode policy_change_required.
- If evidence is missing, ambiguous, or conflicting, hold. Do not guess.
- For waiver, primary/non-contributory, loss payee, mortgagee, or special wording, apply the same rule: allow only if existing policy/endorsement evidence clearly supports the requested wording.`,
      prompt: `Certificate holder:
${params.certificateHolder ?? "(not provided)"}

Request text:
${params.requestText ?? "(not provided)"}

Requested endorsement flags:
${(params.requestedEndorsements ?? []).join(", ") || "(none)"}

Detected required changes:
${requiredChanges.join(", ")}

Evidence packet:
${JSON.stringify(evidencePacket, null, 2).slice(0, 60000)}

Return a gate verdict. If held, write a specific reason that explains whether the problem is missing endorsement evidence, an endorsement still needed, or ambiguity.`,
    });
    const review = result.object as z.infer<typeof certificateGateReviewSchema>;
    const evidenceById = new Map(evidencePacket.map((item) => [item.evidenceId, item]));
    const evidence: CertificateGateEvidence[] = review.evidenceIds
      .map((id) => evidenceById.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item) => ({
        label: item.label,
        excerpt: item.text.slice(0, 900),
        sourceSpanIds: item.sourceSpanIds,
        pageStart: item.pageStart,
        pageEnd: item.pageEnd,
      }));
    const reviewedChanges = review.requiredChanges.length
      ? review.requiredChanges as CertificateEndorsementKind[]
      : requiredChanges;
    if (review.status === "allowed") {
      if (reviewedChanges.length > 0 && evidence.length === 0) {
        return {
          status: "held",
          reasonCode: "ambiguous_policy_evidence",
          reasonMessage:
            "Broker review is needed because the certificate evidence review did not cite source-backed policy or endorsement evidence supporting the requested wording.",
          requiredChanges: reviewedChanges,
          evidence: evidencePacket.slice(0, 4).map((item) => ({
            label: item.label,
            excerpt: item.text.slice(0, 900),
            sourceSpanIds: item.sourceSpanIds,
            pageStart: item.pageStart,
            pageEnd: item.pageEnd,
          })),
        };
      }
      return {
        status: "allowed",
        requiredChanges: reviewedChanges,
        evidence,
      };
    }
    return {
      status: "held",
      reasonCode: review.reasonCode ?? "ambiguous_policy_evidence",
      reasonMessage: review.reasonMessage.trim() || "Broker review is needed before issuing this certificate.",
      requiredChanges: reviewedChanges,
      evidence,
    };
  } catch (error) {
    return {
      status: "held",
      reasonCode: "ambiguous_policy_evidence",
      reasonMessage: `I could not complete the certificate evidence review, so broker review is needed before issuing this certificate. ${error instanceof Error ? error.message : String(error)}`,
      requiredChanges,
      evidence: evidencePacket.slice(0, 4).map((item) => ({
        label: item.label,
        excerpt: item.text.slice(0, 900),
        sourceSpanIds: item.sourceSpanIds,
        pageStart: item.pageStart,
        pageEnd: item.pageEnd,
      })),
    };
  }
}

export const listByPolicyInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy || policy.orgId !== args.orgId) return [];

    const rows = await ctx.db
      .query("certificates")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .order("desc")
      .collect();

    return await Promise.all(
      rows.map(async (row) => ({
        ...row,
        url: await ctx.storage.getUrl(row.fileId),
      })),
    );
  },
});

export const listActivityByPolicy = query({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const policyAccess = await getPolicyAccessForQuery(ctx, args.policyId);
    if (!policyAccess) return { certificates: [], holds: [] };
    const [certificates, holds] = await Promise.all([
      ctx.db
        .query("certificates")
        .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
        .order("desc")
        .collect(),
      ctx.db
        .query("certificateRequestHolds")
        .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
        .order("desc")
        .collect(),
    ]);
    return {
      certificates: await Promise.all(
        certificates.map(async (row) => ({
          ...row,
          url: await ctx.storage.getUrl(row.fileId),
          activityType: "certificate" as const,
        })),
      ),
      holds: holds.map((row) => ({ ...row, activityType: "hold" as const })),
    };
  },
});

export const getGenerationContext = query({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy?.orgId) throw new Error("Policy not found");

    const access = await getOrgAccess(ctx, policy.orgId);
    if (access.accessType === "connected_client") {
      throw new Error("Connected client access is read-only.");
    }

    if (access.org.autoGenerateCoi === false) {
      const handling = access.org.coiHandling ?? "ignore";
      if (handling === "broker") {
        throw new Error("COI auto-generation is off. Contact the broker to obtain this certificate.");
      }
      if (handling === "member") {
        throw new Error("COI auto-generation is off. Route this request to the primary insurance contact.");
      }
      throw new Error("COI auto-generation is disabled for this organization.");
    }

    return { orgId: policy.orgId, userId: access.userId };
  },
});

export const getGenerationContextForOrg = internalQuery({
  args: {
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy || policy.orgId !== args.orgId) {
      throw new Error("Policy not found");
    }

    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Organization not found");

    if (org.autoGenerateCoi === false) {
      const handling = org.coiHandling ?? "ignore";
      if (handling === "broker") {
        throw new Error("COI auto-generation is off. Contact the broker to obtain this certificate.");
      }
      if (handling === "member") {
        throw new Error("COI auto-generation is off. Route this request to the primary insurance contact.");
      }
      throw new Error("COI auto-generation is disabled for this organization.");
    }

    return { orgId: args.orgId };
  },
});

function effectivePolicyDataStage(policy: Record<string, unknown> | null | undefined) {
  const stage = policy?.extractionDataStage;
  if (stage === "placeholder" || stage === "preview" || stage === "final") {
    return stage;
  }
  return policy?.pipelineStatus === "complete" ? "final" : "placeholder";
}

function policyReadyForCertificate(policy: Record<string, unknown> | null | undefined) {
  return policy?.pipelineStatus === "complete" && effectivePolicyDataStage(policy) === "final";
}

export const generateForPolicy = action({
  args: {
    policyId: v.id("policies"),
    holderName: v.string(),
    certificateHolder: v.optional(v.string()),
    holderContactName: v.optional(v.string()),
    holderEmail: v.optional(v.string()),
    holderPhone: v.optional(v.string()),
    addressLine1: v.optional(v.string()),
    addressLine2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    selectedPartnerProgramId: v.optional(v.id("partnerPrograms")),
    requestText: v.optional(v.string()),
    requestedEndorsements: v.optional(requestedEndorsementValidator),
    dryRun: v.optional(v.boolean()),
    forceReissue: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<any> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const holderName = args.holderName.trim();
    if (!holderName) throw new Error("Certificate holder is required.");

    const context = await ctx.runQuery(api.certificates.getGenerationContext, {
      policyId: args.policyId,
    });

    return await ctx.runAction(internal.certificates.generateForOrg, {
      policyId: args.policyId,
      orgId: context.orgId,
      holderName,
      certificateHolder: args.certificateHolder,
      holderContactName: args.holderContactName,
      holderEmail: args.holderEmail,
      holderPhone: args.holderPhone,
      addressLine1: args.addressLine1,
      addressLine2: args.addressLine2,
      city: args.city,
      state: args.state,
      postalCode: args.postalCode,
      selectedPartnerProgramId: args.selectedPartnerProgramId,
      requestText: args.requestText,
      requestedEndorsements: args.requestedEndorsements,
      dryRun: args.dryRun,
      forceReissue: args.forceReissue,
      source: "policy_page",
      createdByUserId: context.userId,
    });
  },
});

export const previewAuthorityForPolicy = action({
  args: {
    policyId: v.id("policies"),
  },
  handler: async (ctx, args): Promise<any> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    await ctx.runQuery(api.certificates.getGenerationContext, {
      policyId: args.policyId,
    });

    const authority = await ctx.runAction(internal.partnerPrograms.resolveCertificateAuthority, {
      policyId: args.policyId,
    }) as {
      authorityType: "non_binding" | "certified";
      certificationStatus: "not_applicable" | "pending" | "certified" | "declined" | "needs_program_selection";
      partnerProgramId?: Id<"partnerPrograms">;
      approvalMode?: "auto_approve_all" | "require_approval_all" | "llm_review";
      matchCandidates?: unknown[];
    };

    const selectedProgram = authority.partnerProgramId
      ? await ctx.runQuery(internal.partnerPrograms.getProgramInternal, {
        programId: authority.partnerProgramId,
      })
      : null;

    return {
      authorityType: authority.authorityType,
      certificationStatus: authority.certificationStatus,
      approvalMode: authority.approvalMode,
      selectedProgram: selectedProgram
        ? {
          programId: selectedProgram._id,
          programName: selectedProgram.name,
          categoryLabels: selectedProgram.categoryLabels,
          approvalMode: selectedProgram.approvalMode,
        }
        : null,
      matchCandidates: authority.matchCandidates ?? [],
    };
  },
});

export const generateForOrg = internalAction({
  args: {
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    holderName: v.string(),
    certificateHolder: v.optional(v.string()),
    holderContactName: v.optional(v.string()),
    holderEmail: v.optional(v.string()),
    holderPhone: v.optional(v.string()),
    addressLine1: v.optional(v.string()),
    addressLine2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    source: v.optional(certificateSourceValidator),
    createdByUserId: v.optional(v.id("users")),
    selectedPartnerProgramId: v.optional(v.id("partnerPrograms")),
    policyVersionId: v.optional(v.id("policyVersions")),
    requestText: v.optional(v.string()),
    requestedEndorsements: v.optional(requestedEndorsementValidator),
    dryRun: v.optional(v.boolean()),
    forceReissue: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<any> => {
    const holderName = args.holderName.trim();
    if (!holderName) throw new Error("Certificate holder is required.");

    await ctx.runQuery(internal.certificates.getGenerationContextForOrg, {
      orgId: args.orgId,
      policyId: args.policyId,
    });
    const parsedHolderBlock = parseCertificateHolderBlock(
      args.certificateHolder,
      holderName,
    );
    const holderContactName = args.holderContactName ?? parsedHolderBlock.contactName;
    const holderEmail = args.holderEmail ?? parsedHolderBlock.email;
    const holderPhone = args.holderPhone ?? parsedHolderBlock.phone;
    const holderAddress =
      structuredCertificateHolderAddress(args) ??
      parsedHolderBlock.address;
    const certificateHolder = certificateHolderDisplayBlock({
      displayName: holderName,
      contactName: holderContactName,
      email: holderEmail,
      phone: holderPhone,
      address: holderAddress as CertificateHolderAddressInput | undefined,
    });

    const policy = await ctx.runQuery(internal.policies.getInternal, {
      id: args.policyId,
    });
    if (!policyReadyForCertificate(policy as Record<string, unknown> | null)) {
      return {
        status: "extraction_in_progress",
        holderName,
        certificateHolder,
        message:
          "COI generation is available after Glass finishes full source-backed extraction for this policy.",
      };
    }
    const org = await ctx.runQuery(internal.orgs.getInternal, {
      id: args.orgId,
    });
    const workflowSettings = await ctx.runQuery(
      (internal as any).certificateWorkflowSettings.getEffectiveInternal,
      { orgId: args.orgId },
    );
    const certificateChangeRequestsEnabled =
      workflowSettings.policyChangeRequestsForHeldCertificatesEnabled !== false;
    const hasSourceNodes = await ctx.runQuery(
      (internal as any).sourceNodes.hasNodesForPolicy,
      { policyId: args.policyId },
    ).catch(() => false);
    const hasReadySourceTree =
      (policy as { sourceTreeVersion?: string; sourceTreeStatus?: string } | null)?.sourceTreeVersion === "v3" &&
      (policy as { sourceTreeVersion?: string; sourceTreeStatus?: string } | null)?.sourceTreeStatus === "ready" &&
      hasSourceNodes;
    if (!hasReadySourceTree) {
      const rebuild = await ctx.runAction((internal as any).actions.policyExtraction.ensurePolicyV3SourceTree, {
        policyId: args.policyId,
        reason: "certificate_generation",
      }).catch((error) => ({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }));
      return {
        status: "source_tree_rebuild_required",
        holderName,
        certificateHolder,
        rebuildStatus: rebuild.status,
        message:
          rebuild.status === "failed"
            ? `Certificate generation needs source-tree evidence, but rebuilding failed: ${rebuild.error ?? "unknown error"}`
            : "Certificate generation is queued until Glass rebuilds source-tree evidence for this policy.",
      };
    }
    const gate = await evaluateCertificateRequestGateWithLlm({
      ctx,
      orgId: args.orgId,
      policyId: args.policyId,
      certificateHolder,
      requestText: args.requestText,
      requestedEndorsements: args.requestedEndorsements,
      policy: policy as Record<string, unknown> | null,
    });

    if (args.dryRun) {
      return {
        status: gate.status === "allowed" ? "gate_allowed" : "gate_held",
        holderName,
        certificateHolder,
        gate,
      };
    }

    if (gate.status === "held") {
      let policyChangeCaseId: Id<"policyChangeCases"> | undefined;
      if (certificateChangeRequestsEnabled) {
        const brokerIdentity = org?.type === "client"
          ? await ctx.runQuery(internal.orgs.resolveBrokerIdentityInternal, {
              clientOrgId: args.orgId,
            })
          : null;
        const brokerSubmission = buildBrokerSubmissionFromIdentity(brokerIdentity);
        policyChangeCaseId = await ctx.runMutation(
          internal.policyChanges.createFromChatInternal,
          {
            orgId: args.orgId,
            userId: args.createdByUserId,
            policyId: args.policyId,
            requestText:
              args.requestText ??
              `Certificate request for ${holderName} requires ${gate.requiredChanges.join(", ")} before the COI can be issued.`,
            sourceKind: sourceKindForPolicyChange(args.source),
            evidenceSourceIds: gate.evidence.flatMap((item) => item.sourceSpanIds ?? []),
            missingInfoQuestions: missingBrokerRecipientInfo(
              brokerSubmission,
              "certificate",
            ),
            brokerSubmission,
          },
        );
      }

      const holdId = await ctx.runMutation(internal.certificates.recordHoldInternal, {
        orgId: args.orgId,
        policyId: args.policyId,
        holderName,
        certificateHolder,
        requestText: args.requestText,
        requestedEndorsements: args.requestedEndorsements,
        source: args.source,
        status: policyChangeCaseId ? "policy_change_opened" : "broker_handoff_offered",
        reasonCode: gate.reasonCode,
        reasonMessage: gate.reasonMessage,
        requiredChanges: gate.requiredChanges,
        evidence: gate.evidence,
        policyChangeCaseId,
        createdByUserId: args.createdByUserId,
      });

      return {
        status: "held_policy_change_required",
        holdId,
        policyChangeCaseId,
        holderName,
        certificateHolder,
        requiredChanges: gate.requiredChanges,
        reasonCode: gate.reasonCode,
        reasonMessage: gate.reasonMessage,
        evidence: gate.evidence,
        policyChangeRequestsEnabled: certificateChangeRequestsEnabled,
        brokerHandoffOffered: !certificateChangeRequestsEnabled,
        message: formatGateMessage({
          holderName,
          reasonMessage: gate.reasonMessage,
          policyChangeCaseId,
          policyChangeRequestsEnabled: certificateChangeRequestsEnabled,
        }),
      };
    }

    const authority = await ctx.runAction(internal.partnerPrograms.resolveCertificateAuthority, {
      policyId: args.policyId,
      selectedPartnerProgramId: args.selectedPartnerProgramId,
    }) as {
      authorityType: "non_binding" | "certified";
      certificationStatus: "not_applicable" | "pending" | "certified" | "declined" | "needs_program_selection";
      partnerOrgId?: Id<"organizations">;
      partnerProgramId?: Id<"partnerPrograms">;
      templateId?: Id<"coiTemplates">;
      standingAuthorizationId?: Id<"standingAuthorizations">;
      approvalType?: "standing_authorization";
      approvalMode?: "auto_approve_all" | "require_approval_all" | "llm_review";
      approvalAudit?: unknown;
      matchCandidates?: unknown;
      disclaimer?: string;
    };

    if (authority.certificationStatus === "needs_program_selection") {
      return {
        status: "needs_program_selection",
        authorityType: "certified",
        certificationStatus: "needs_program_selection",
        matchCandidates: authority.matchCandidates ?? [],
      };
    }

    const holderId = await ctx.runMutation((internal as any).certificateHolders.upsertInternal, {
      orgId: args.orgId,
      displayName: holderName,
      contactName: holderContactName,
      email: holderEmail,
      phone: holderPhone,
      address: holderAddress,
      source: "certificate_generation",
      sourceRef: String(args.policyId),
      createdByUserId: args.createdByUserId,
      updatedByUserId: args.createdByUserId,
    }) as Id<"certificateHolders">;
    const policyVersionId = args.policyVersionId ?? await ctx.runMutation(
      (internal as any).policyVersions.ensureInitialInternal,
      {
        policyId: args.policyId,
        createdByUserId: args.createdByUserId,
      },
    ) as Id<"policyVersions">;
    const policyCertificateId = await ctx.runMutation(
      (internal as any).certificateLifecycle.getOrCreateParentInternal,
      {
        orgId: args.orgId,
        policyId: args.policyId,
        holderId,
        source: args.source ?? "unknown",
        createdByUserId: args.createdByUserId,
      },
    ) as Id<"policyCertificates">;

    const reusableCertificationStatus = authority.authorityType === "certified"
      ? authority.certificationStatus === "pending"
        ? "certified"
        : authority.certificationStatus
      : "not_applicable";
    const reusableVersion = args.forceReissue
      ? null
      : await ctx.runQuery((internal as any).certificateLifecycle.findReusableIssuedVersionInternal, {
          certificateId: policyCertificateId,
          policyVersionId,
          authorityType: authority.authorityType,
          certificationStatus: reusableCertificationStatus,
          partnerProgramId: authority.partnerProgramId,
          templateId: authority.templateId,
        });
    const reusableHolderMatches =
      reusableVersion?.certificateHolder?.trim() === certificateHolder.trim();
    if (reusableVersion?.fileId && reusableHolderMatches) {
      return {
        status: "existing",
        reused: true,
        fileId: reusableVersion.fileId,
        url: reusableVersion.url,
        fileName: reusableVersion.fileName ?? "certificate-of-insurance.pdf",
        size: reusableVersion.fileSize ?? 0,
        holderId: String(holderId),
        policyCertificateId: String(policyCertificateId),
        certificateVersionId: String(reusableVersion._id),
        policyVersionId: String(policyVersionId),
        versionNumber: reusableVersion.versionNumber,
        authorityType: reusableVersion.authorityType ?? authority.authorityType,
        certificationStatus: reusableVersion.certificationStatus ?? reusableCertificationStatus,
      };
    }

    if (authority.authorityType === "certified" && authority.certificationStatus === "pending" && authority.partnerOrgId) {
      const requestId = await ctx.runMutation(internal.partnerPrograms.createCertificateRequestInternal, {
        orgId: args.orgId,
        policyId: args.policyId,
        partnerOrgId: authority.partnerOrgId,
        partnerProgramId: authority.partnerProgramId,
        templateId: authority.templateId,
        holderName,
        certificateHolder,
        source: args.source,
        createdByUserId: args.createdByUserId,
        matchCandidates: authority.matchCandidates,
        approvalMode: authority.approvalMode,
        approvalAudit: authority.approvalAudit,
      });
      return {
        status: "pending_approval",
        requestId,
        authorityType: "certified",
        certificationStatus: "pending",
        partnerOrgId: authority.partnerOrgId,
        partnerProgramId: authority.partnerProgramId,
        templateId: authority.templateId,
      };
    }

    const generated = await ctx.runAction(internal.actions.generateCoi.run, {
      policyId: args.policyId,
      orgId: args.orgId,
      certificateHolder,
      certificateHolderName: holderName,
      holderContactName,
      holderEmail,
      holderPhone,
      source: args.source,
      createdByUserId: args.createdByUserId,
      authorityType: authority.authorityType,
      certificationStatus: authority.certificationStatus,
      partnerOrgId: authority.partnerOrgId,
      partnerProgramId: authority.partnerProgramId,
      templateId: authority.templateId,
      standingAuthorizationId: authority.standingAuthorizationId,
      approvalMode: authority.approvalMode,
      approvalAudit: authority.approvalAudit,
      disclaimer: authority.disclaimer,
      certificateHolderId: holderId,
      policyCertificateId,
      policyVersionId,
      holderAddress,
    });
    if (!generated) throw new Error("COI generation failed.");

    const fileId = generated.storageId as Id<"_storage">;
    if (authority.approvalType === "standing_authorization" && authority.partnerOrgId) {
      const approvalId = await ctx.runMutation(internal.partnerPrograms.recordCertificateApprovalInternal, {
        orgId: args.orgId,
        policyId: args.policyId,
        certificateId: generated.certificateId as Id<"certificates">,
        partnerOrgId: authority.partnerOrgId,
        partnerProgramId: authority.partnerProgramId,
        templateId: authority.templateId,
        standingAuthorizationId: authority.standingAuthorizationId,
        approvalType: "standing_authorization",
        status: "approved",
        approvalMode: authority.approvalMode,
        audit: authority.approvalAudit,
        notes: authority.disclaimer,
      });
      await ctx.runMutation(internal.partnerPrograms.linkCertificateApprovalInternal, {
        certificateId: generated.certificateId as Id<"certificates">,
        approvalId,
      });
    }
    return {
      status: "generated",
      fileId,
      url: await ctx.storage.getUrl(fileId),
      fileName: generated.fileName,
      size: generated.size,
      certificateId: generated.certificateId,
      holderId: generated.holderId,
      policyCertificateId: generated.policyCertificateId,
      certificateVersionId: generated.certificateVersionId,
      policyVersionId: String(policyVersionId),
      versionNumber: generated.versionNumber,
      authorityType: authority.authorityType,
      certificationStatus: authority.certificationStatus,
    };
  },
});

export const recordGenerated = internalMutation({
  args: {
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    fileId: v.id("_storage"),
    fileName: v.optional(v.string()),
    certificateHolder: v.optional(v.string()),
    certificateHolderName: v.optional(v.string()),
    source: v.optional(certificateSourceValidator),
    createdByUserId: v.optional(v.id("users")),
    authorityType: v.optional(v.union(v.literal("non_binding"), v.literal("certified"))),
    certificationStatus: v.optional(
      v.union(
        v.literal("not_applicable"),
        v.literal("pending"),
        v.literal("certified"),
        v.literal("declined"),
      ),
    ),
    partnerOrgId: v.optional(v.id("organizations")),
    partnerProgramId: v.optional(v.id("partnerPrograms")),
    templateId: v.optional(v.id("coiTemplates")),
    standingAuthorizationId: v.optional(v.id("standingAuthorizations")),
    approvalMode: v.optional(v.union(
      v.literal("auto_approve_all"),
      v.literal("require_approval_all"),
      v.literal("llm_review"),
    )),
    approvalAudit: v.optional(v.any()),
    disclaimer: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy || policy.orgId !== args.orgId) {
      throw new Error("Policy not found for certificate record.");
    }

    return await ctx.db.insert("certificates", {
      orgId: args.orgId,
      policyId: args.policyId,
      fileId: args.fileId,
      fileName: args.fileName ?? "certificate-of-insurance.pdf",
      certificateHolder: args.certificateHolder,
      certificateHolderName: args.certificateHolderName,
      source: args.source ?? "agent",
      createdByUserId: args.createdByUserId,
      authorityType: args.authorityType ?? "non_binding",
      certificationStatus: args.certificationStatus ?? "not_applicable",
      partnerOrgId: args.partnerOrgId,
      partnerProgramId: args.partnerProgramId,
      templateId: args.templateId,
      standingAuthorizationId: args.standingAuthorizationId,
      approvalMode: args.approvalMode,
      approvalAudit: args.approvalAudit,
      disclaimer: args.disclaimer,
      createdAt: dayjs().valueOf(),
    });
  },
});

export const recordHoldInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    holderName: v.string(),
    certificateHolder: v.optional(v.string()),
    requestText: v.optional(v.string()),
    requestedEndorsements: v.optional(requestedEndorsementValidator),
    source: v.optional(certificateSourceValidator),
    status: v.union(
      v.literal("held"),
      v.literal("policy_change_opened"),
      v.literal("broker_handoff_offered"),
      v.literal("resolved"),
      v.literal("cancelled"),
    ),
    reasonCode: v.union(
      v.literal("policy_change_required"),
      v.literal("missing_policy_evidence"),
      v.literal("ambiguous_policy_evidence"),
      v.literal("conflicting_policy_evidence"),
    ),
    reasonMessage: v.string(),
    requiredChanges: v.array(v.string()),
    evidence: v.optional(v.any()),
    policyChangeCaseId: v.optional(v.id("policyChangeCases")),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    createdByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    return await ctx.db.insert("certificateRequestHolds", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const markHoldResolvedInternal = internalMutation({
  args: {
    policyChangeCaseId: v.id("policyChangeCases"),
  },
  handler: async (ctx, args) => {
    const holds = await ctx.db
      .query("certificateRequestHolds")
      .withIndex("by_policyChangeCaseId", (q) =>
        q.eq("policyChangeCaseId", args.policyChangeCaseId),
      )
      .collect();
    const now = dayjs().valueOf();
    for (const hold of holds) {
      await ctx.db.patch(hold._id, { status: "resolved", updatedAt: now });
    }
  },
});
