import { getAuthUserId } from "@convex-dev/auth/server";
import dayjs from "dayjs";
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { assertCanCreatePolicyChange, getOrgAccess, getPolicyAccessForQuery } from "./lib/access";
import {
  buildCertificateGateEvidencePacket,
  inferCertificateEndorsements,
  type CertificateEndorsementKind,
  type CertificateGateEvidence,
  type CertificateGateVerdict,
} from "./lib/certificateRequestGate";
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

function compactCertificateHolder(args: {
  holderName: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}) {
  const cityStateZip = [
    args.city?.trim(),
    [args.state?.trim(), args.postalCode?.trim()].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");

  return [
    args.holderName.trim(),
    args.addressLine1?.trim(),
    args.addressLine2?.trim(),
    cityStateZip,
  ].filter(Boolean).join("\n");
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

function buildBrokerSubmissionFromIdentity(identity: any | null) {
  if (!identity || !identity.clientOrgId) return undefined;
  const recipientEmail = typeof identity.contactEmail === "string"
    ? identity.contactEmail.trim()
    : "";
  const recipientName = identity.contactName ?? identity.brokerCompanyName;
  return {
    routingStatus: recipientEmail
      ? "recipient_ready"
      : identity.source === "none"
        ? "needs_broker_contact"
        : "needs_broker_recipient",
    source: identity.source,
    brokerOrgId: identity.brokerOrgId,
    brokerCompanyName: identity.brokerCompanyName,
    recipientEmail: recipientEmail || undefined,
    recipientName,
    contactPhone: identity.contactPhone,
    needsRecipient: !recipientEmail,
  };
}

function missingBrokerRecipientInfo(brokerSubmission: any | undefined) {
  if (!brokerSubmission?.needsRecipient) return [];
  return [{
    code: "broker_contact_required",
    question: "Which broker email or contact should receive this certificate change request?",
    reason: "Certificate requests that require policy changes are broker-mediated and need a broker recipient before Glass can draft or send one.",
  }];
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

export const generateForPolicy = action({
  args: {
    policyId: v.id("policies"),
    holderName: v.string(),
    certificateHolder: v.optional(v.string()),
    addressLine1: v.optional(v.string()),
    addressLine2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    selectedPartnerProgramId: v.optional(v.id("partnerPrograms")),
    requestText: v.optional(v.string()),
    requestedEndorsements: v.optional(requestedEndorsementValidator),
    dryRun: v.optional(v.boolean()),
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
      addressLine1: args.addressLine1,
      addressLine2: args.addressLine2,
      city: args.city,
      state: args.state,
      postalCode: args.postalCode,
      selectedPartnerProgramId: args.selectedPartnerProgramId,
      requestText: args.requestText,
      requestedEndorsements: args.requestedEndorsements,
      dryRun: args.dryRun,
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
    addressLine1: v.optional(v.string()),
    addressLine2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    source: v.optional(certificateSourceValidator),
    createdByUserId: v.optional(v.id("users")),
    selectedPartnerProgramId: v.optional(v.id("partnerPrograms")),
    requestText: v.optional(v.string()),
    requestedEndorsements: v.optional(requestedEndorsementValidator),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<any> => {
    const holderName = args.holderName.trim();
    if (!holderName) throw new Error("Certificate holder is required.");

    await ctx.runQuery(internal.certificates.getGenerationContextForOrg, {
      orgId: args.orgId,
      policyId: args.policyId,
    });
    const certificateHolder = args.certificateHolder?.trim() || compactCertificateHolder({ ...args, holderName });

    const policy = await ctx.runQuery(internal.policies.getInternal, {
      id: args.policyId,
    });
    const org = await ctx.runQuery(internal.orgs.getInternal, {
      id: args.orgId,
    });
    const brokerOrg = org?.type === "client" && org.brokerOrgId
      ? await ctx.runQuery(internal.orgs.getInternal, {
          id: org.brokerOrgId as Id<"organizations">,
        })
      : null;
    const settingsOrg = brokerOrg ?? org;
    const policyChangeRequestsEnabled =
      settingsOrg?.policyChangeRequestsEnabled !== false;
    const certificateChangeRequestsEnabled =
      settingsOrg?.certificateChangeRequestsEnabled !== false &&
      policyChangeRequestsEnabled;
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
            missingInfoQuestions: missingBrokerRecipientInfo(brokerSubmission),
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

    const now = dayjs().valueOf();
    const certificateId = await ctx.db.insert("certificates", {
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
      createdAt: now,
    });

    await ctx.db.insert("certificateVersions", {
      orgId: args.orgId,
      policyId: args.policyId,
      certificateId,
      sourceCertificateId: certificateId,
      versionNumber: 1,
      status: "issued",
      reason: "initial_issue",
      fileId: args.fileId,
      fileName: args.fileName ?? "certificate-of-insurance.pdf",
      certificateHolder: args.certificateHolder,
      certificateHolderName: args.certificateHolderName,
      createdByUserId: args.createdByUserId,
      issuedByUserId: args.createdByUserId,
      issuedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return certificateId;
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

const certificateReviewJobStatusValidator = v.union(
  v.literal("ready_for_review"),
  v.literal("blocked_missing_holder_contact"),
  v.literal("sent"),
  v.literal("cancelled"),
);

const certificateReviewJobTypeValidator = v.union(
  v.literal("renewal_reissue"),
  v.literal("post_endorsement"),
);

function normalizeEmail(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || undefined;
}

function holderNameForCertificate(certificate: { certificateHolderName?: string; certificateHolder?: string }) {
  const holderName = certificate.certificateHolderName?.trim();
  if (holderName) return holderName;
  const firstLine = certificate.certificateHolder?.split("\n")[0]?.trim();
  return firstLine || "Certificate holder";
}

async function nextCertificateVersionNumber(ctx: any, certificateId: Id<"certificates"> | undefined) {
  if (!certificateId) return 1;
  const latest = await ctx.db
    .query("certificateVersions")
    .withIndex("by_certificateId", (q: any) => q.eq("certificateId", certificateId))
    .order("desc")
    .first();
  return latest ? (latest.versionNumber ?? 0) + 1 : 1;
}

async function insertCertificateReviewJobAudit(ctx: any, args: {
  orgId: Id<"organizations">;
  policyId: Id<"policies">;
  jobId: Id<"certificateReviewJobs">;
  action: "created" | "reviewed" | "sent" | "cancelled" | "blocked_missing_holder_contact";
  previousStatus?: string;
  nextStatus: string;
  userId?: Id<"users">;
  notes?: string;
  metadata?: unknown;
}) {
  await ctx.db.insert("certificateReviewJobAudit", {
    orgId: args.orgId,
    policyId: args.policyId,
    jobId: args.jobId,
    action: args.action,
    previousStatus: args.previousStatus,
    nextStatus: args.nextStatus,
    userId: args.userId,
    notes: args.notes,
    metadata: args.metadata,
    createdAt: dayjs().valueOf(),
  });
}

async function createCertificateReviewJob(ctx: any, args: {
  orgId: Id<"organizations">;
  policyId: Id<"policies">;
  certificateId?: Id<"certificates">;
  sourceCertificateId?: Id<"certificates">;
  sourceHoldId?: Id<"certificateRequestHolds">;
  policyChangeCaseId?: Id<"policyChangeCases">;
  policyUpdateRunId?: Id<"policyUpdateRuns">;
  jobType: "renewal_reissue" | "post_endorsement";
  holderName: string;
  certificateHolder?: string;
  holderContactEmail?: string;
  createdByUserId?: Id<"users">;
  metadata?: unknown;
}) {
  const holderContactEmail = normalizeEmail(args.holderContactEmail);
  const now = dayjs().valueOf();
  const versionId = await ctx.db.insert("certificateVersions", {
    orgId: args.orgId,
    policyId: args.policyId,
    certificateId: args.certificateId,
    sourceCertificateId: args.sourceCertificateId,
    sourceHoldId: args.sourceHoldId,
    policyUpdateRunId: args.policyUpdateRunId,
    versionNumber: await nextCertificateVersionNumber(ctx, args.certificateId),
    status: "draft",
    reason: args.jobType,
    certificateHolder: args.certificateHolder,
    certificateHolderName: args.holderName,
    holderContactEmail,
    createdByUserId: args.createdByUserId,
    createdAt: now,
    updatedAt: now,
  });
  const status = holderContactEmail ? "ready_for_review" : "blocked_missing_holder_contact";
  const missingContactReason = holderContactEmail
    ? undefined
    : "Holder contact email is required before this certificate can be sent.";
  const jobId = await ctx.db.insert("certificateReviewJobs", {
    orgId: args.orgId,
    policyId: args.policyId,
    certificateId: args.certificateId,
    sourceCertificateId: args.sourceCertificateId,
    draftCertificateVersionId: versionId,
    sourceHoldId: args.sourceHoldId,
    policyChangeCaseId: args.policyChangeCaseId,
    policyUpdateRunId: args.policyUpdateRunId,
    jobType: args.jobType,
    status,
    holderName: args.holderName,
    certificateHolder: args.certificateHolder,
    holderContactEmail,
    missingContactReason,
    createdByUserId: args.createdByUserId,
    createdAt: now,
    updatedAt: now,
  });
  await insertCertificateReviewJobAudit(ctx, {
    orgId: args.orgId,
    policyId: args.policyId,
    jobId,
    action: status === "blocked_missing_holder_contact" ? "blocked_missing_holder_contact" : "created",
    nextStatus: status,
    userId: args.createdByUserId,
    notes: missingContactReason,
    metadata: args.metadata,
  });
  return { jobId, draftCertificateVersionId: versionId, status };
}

async function createRenewalReviewJobsForPolicyImpl(ctx: any, args: {
  orgId: Id<"organizations">;
  policyId: Id<"policies">;
  createdByUserId?: Id<"users">;
  holderContacts?: Array<{ certificateId: Id<"certificates">; email: string }>;
}) {
  const policy = await ctx.db.get(args.policyId);
  if (!policy || policy.orgId !== args.orgId) throw new Error("Policy not found");
  const contacts = new Map((args.holderContacts ?? []).map((item) => [item.certificateId, item.email]));
  const certificates = await ctx.db
    .query("certificates")
    .withIndex("by_policyId", (q: any) => q.eq("policyId", args.policyId))
    .collect();
  const jobs = [];
  for (const certificate of certificates) {
    const existingActiveJob = await ctx.db
      .query("certificateReviewJobs")
      .withIndex("by_sourceCertificateId_jobType", (q: any) =>
        q.eq("sourceCertificateId", certificate._id).eq("jobType", "renewal_reissue"),
      )
      .filter((q: any) =>
        q.or(
          q.eq(q.field("status"), "ready_for_review"),
          q.eq(q.field("status"), "blocked_missing_holder_contact"),
        ),
      )
      .first();
    if (existingActiveJob) continue;
    const latestVersion = await ctx.db
      .query("certificateVersions")
      .withIndex("by_certificateId", (q: any) => q.eq("certificateId", certificate._id))
      .order("desc")
      .first();
    if (latestVersion && latestVersion.status !== "issued") continue;
    const job = await createCertificateReviewJob(ctx, {
      orgId: args.orgId,
      policyId: args.policyId,
      certificateId: certificate._id,
      sourceCertificateId: certificate._id,
      jobType: "renewal_reissue",
      holderName: holderNameForCertificate(certificate),
      certificateHolder: certificate.certificateHolder,
      holderContactEmail: contacts.get(certificate._id),
      createdByUserId: args.createdByUserId,
      metadata: { latestVersionId: latestVersion?._id, legacyIssuedCertificate: !latestVersion },
    });
    jobs.push(job);
  }
  return { created: jobs.length, jobs };
}

export const createRenewalReviewJobsForPolicyInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    createdByUserId: v.optional(v.id("users")),
    holderContacts: v.optional(v.array(v.object({
      certificateId: v.id("certificates"),
      email: v.string(),
    }))),
  },
  handler: async (ctx, args) => {
    return await createRenewalReviewJobsForPolicyImpl(ctx, args);
  },
});

export const createRenewalReviewJobsForPolicy = mutation({
  args: {
    policyId: v.id("policies"),
    holderContacts: v.optional(v.array(v.object({
      certificateId: v.id("certificates"),
      email: v.string(),
    }))),
  },
  handler: async (ctx, args): Promise<any> => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy?.orgId) throw new Error("Policy not found");
    const access = await getOrgAccess(ctx, policy.orgId);
    assertCanCreatePolicyChange(access);
    return await createRenewalReviewJobsForPolicyImpl(ctx, {
      orgId: policy.orgId,
      policyId: args.policyId,
      createdByUserId: access.userId,
      holderContacts: args.holderContacts,
    });
  },
});

export const createPostEndorsementReviewJobsInternal = internalMutation({
  args: {
    policyChangeCaseId: v.id("policyChangeCases"),
    policyUpdateRunId: v.optional(v.id("policyUpdateRuns")),
    createdByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const changeCase = await ctx.db.get(args.policyChangeCaseId);
    if (!changeCase?.orgId || !changeCase.policyId) throw new Error("Policy change case not found");
    const holds = await ctx.db
      .query("certificateRequestHolds")
      .withIndex("by_policyChangeCaseId", (q) => q.eq("policyChangeCaseId", args.policyChangeCaseId))
      .collect();
    const jobs = [];
    for (const hold of holds) {
      if (hold.status !== "resolved") continue;
      const existingJob = await ctx.db
        .query("certificateReviewJobs")
        .withIndex("by_sourceHoldId", (q: any) => q.eq("sourceHoldId", hold._id))
        .first();
      if (existingJob) continue;
      const certificates = await ctx.db
        .query("certificates")
        .withIndex("by_policyId", (q) => q.eq("policyId", hold.policyId))
        .collect();
      const matchingCertificate = certificates.find((certificate) =>
        certificate.certificateHolderName?.trim().toLowerCase() === hold.holderName.trim().toLowerCase() ||
        certificate.certificateHolder?.trim().toLowerCase() === hold.certificateHolder?.trim().toLowerCase(),
      );
      const job = await createCertificateReviewJob(ctx, {
        orgId: hold.orgId,
        policyId: hold.policyId,
        certificateId: matchingCertificate?._id,
        sourceCertificateId: matchingCertificate?._id,
        sourceHoldId: hold._id,
        policyChangeCaseId: args.policyChangeCaseId,
        policyUpdateRunId: args.policyUpdateRunId,
        jobType: "post_endorsement",
        holderName: hold.holderName,
        certificateHolder: hold.certificateHolder,
        createdByUserId: args.createdByUserId,
        metadata: { requiredChanges: hold.requiredChanges, reasonCode: hold.reasonCode },
      });
      jobs.push(job);
    }
    return { created: jobs.length, jobs };
  },
});

export const listReviewJobs = query({
  args: {
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
    status: v.optional(certificateReviewJobStatusValidator),
    jobType: v.optional(certificateReviewJobTypeValidator),
  },
  handler: async (ctx, args) => {
    await getOrgAccess(ctx, args.orgId);
    const rows = args.policyId
      ? await ctx.db
        .query("certificateReviewJobs")
        .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId!))
        .order("desc")
        .collect()
      : await ctx.db
        .query("certificateReviewJobs")
        .withIndex("by_orgId_status", (q) =>
          args.status ? q.eq("orgId", args.orgId).eq("status", args.status) : q.eq("orgId", args.orgId),
        )
        .order("desc")
        .collect();
    return rows.filter((row) =>
      row.orgId === args.orgId &&
      (!args.status || row.status === args.status) &&
      (!args.jobType || row.jobType === args.jobType),
    );
  },
});

export const listReviewJobAudit = query({
  args: { jobId: v.id("certificateReviewJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return [];
    await getOrgAccess(ctx, job.orgId);
    return await ctx.db
      .query("certificateReviewJobAudit")
      .withIndex("by_jobId", (q) => q.eq("jobId", args.jobId))
      .collect();
  },
});

export const reviewJob = mutation({
  args: {
    jobId: v.id("certificateReviewJobs"),
    holderContactEmail: v.optional(v.string()),
    reviewNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Certificate review job not found");
    const access = await getOrgAccess(ctx, job.orgId);
    assertCanCreatePolicyChange(access);
    if (job.status === "sent" || job.status === "cancelled") {
      throw new Error("Completed certificate review jobs cannot be reviewed.");
    }
    const holderContactEmail = normalizeEmail(args.holderContactEmail) ?? job.holderContactEmail;
    const nextStatus = holderContactEmail ? "ready_for_review" : "blocked_missing_holder_contact";
    const now = dayjs().valueOf();
    await ctx.db.patch(args.jobId, {
      status: nextStatus,
      holderContactEmail,
      missingContactReason: holderContactEmail ? undefined : job.missingContactReason ?? "Holder contact email is required before this certificate can be sent.",
      reviewNotes: args.reviewNotes,
      reviewedByUserId: access.userId,
      reviewedAt: now,
      updatedAt: now,
    });
    if (job.draftCertificateVersionId) {
      await ctx.db.patch(job.draftCertificateVersionId, {
        holderContactEmail,
        updatedAt: now,
      });
    }
    await insertCertificateReviewJobAudit(ctx, {
      orgId: job.orgId,
      policyId: job.policyId,
      jobId: args.jobId,
      action: "reviewed",
      previousStatus: job.status,
      nextStatus,
      userId: access.userId,
      notes: args.reviewNotes,
    });
    return { status: nextStatus };
  },
});

export const sendReviewJob = mutation({
  args: {
    jobId: v.id("certificateReviewJobs"),
    sendNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Certificate review job not found");
    const access = await getOrgAccess(ctx, job.orgId);
    assertCanCreatePolicyChange(access);
    if (job.status !== "ready_for_review") {
      throw new Error("Certificate review job must be ready for review before it can be sent.");
    }
    if (!job.holderContactEmail) {
      throw new Error("Holder contact email is required before sending this certificate.");
    }
    const now = dayjs().valueOf();
    await ctx.db.patch(args.jobId, {
      status: "sent",
      sendNotes: args.sendNotes,
      sentByUserId: access.userId,
      sentAt: now,
      updatedAt: now,
    });
    if (job.draftCertificateVersionId) {
      await ctx.db.patch(job.draftCertificateVersionId, {
        status: "issued",
        issuedByUserId: access.userId,
        issuedAt: now,
        updatedAt: now,
      });
    }
    await insertCertificateReviewJobAudit(ctx, {
      orgId: job.orgId,
      policyId: job.policyId,
      jobId: args.jobId,
      action: "sent",
      previousStatus: job.status,
      nextStatus: "sent",
      userId: access.userId,
      notes: args.sendNotes,
    });
    return { status: "sent" };
  },
});

export const cancelReviewJob = mutation({
  args: {
    jobId: v.id("certificateReviewJobs"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Certificate review job not found");
    const access = await getOrgAccess(ctx, job.orgId);
    assertCanCreatePolicyChange(access);
    if (job.status === "sent") throw new Error("Sent certificate review jobs cannot be cancelled.");
    if (job.status === "cancelled") return { status: "cancelled" };
    const now = dayjs().valueOf();
    await ctx.db.patch(args.jobId, {
      status: "cancelled",
      cancelReason: args.reason,
      cancelledByUserId: access.userId,
      cancelledAt: now,
      updatedAt: now,
    });
    if (job.draftCertificateVersionId) {
      await ctx.db.patch(job.draftCertificateVersionId, {
        status: "cancelled",
        cancelledByUserId: access.userId,
        cancelledAt: now,
        updatedAt: now,
      });
    }
    await insertCertificateReviewJobAudit(ctx, {
      orgId: job.orgId,
      policyId: job.policyId,
      jobId: args.jobId,
      action: "cancelled",
      previousStatus: job.status,
      nextStatus: "cancelled",
      userId: access.userId,
      notes: args.reason,
    });
    return { status: "cancelled" };
  },
});
