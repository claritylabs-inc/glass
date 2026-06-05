import { getAuthUserId } from "@convex-dev/auth/server";
import dayjs from "dayjs";
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getOrgAccess, getPolicyAccessForQuery } from "./lib/access";
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

function normalizeHolderKey(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function holderNameFromCertificate(certificateHolder: string | undefined, holderName: string) {
  return (certificateHolder?.split(/\r?\n/)[0] ?? holderName).trim() || holderName.trim();
}

function sourceSpanIdsFromEvidence(evidence: unknown): string[] {
  if (!Array.isArray(evidence)) return [];
  const ids = new Set<string>();
  for (const item of evidence) {
    const sourceSpanIds = (item as { sourceSpanIds?: unknown }).sourceSpanIds;
    if (!Array.isArray(sourceSpanIds)) continue;
    for (const id of sourceSpanIds) {
      if (typeof id === "string" && id.trim()) ids.add(id.trim());
    }
  }
  return [...ids].slice(0, 24);
}

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



export const listLegacyLifecycleBackfillBatchInternal = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("certificates").collect();
    return rows
      .filter((row: any) => !row.certificateHolderId || !row.latestVersionId)
      .slice(0, Math.max(1, Math.min(args.limit, 1_000_000)))
      .map((row) => ({ _id: row._id, policyId: row.policyId }));
  },
});

export const findReusableIssuedInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    holderKey: v.string(),
    policyVersionId: v.id("policyVersions"),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("certificates")
      .withIndex("by_policy_holderKey", (q) =>
        q.eq("policyId", args.policyId).eq("holderKey", args.holderKey),
      )
      .collect();
    const certificate = rows
      .filter((row: any) =>
        row.orgId === args.orgId &&
        row.lifecycleStatus !== "inactive" &&
        row.latestPolicyVersionId === args.policyVersionId &&
        row.latestVersionId &&
        row.fileId,
      )
      .sort((a: any, b: any) => (b.issuedAt ?? b.createdAt ?? 0) - (a.issuedAt ?? a.createdAt ?? 0))[0];
    if (!certificate?.latestVersionId) return null;
    const version = await ctx.db.get(certificate.latestVersionId as Id<"certificateVersions">);
    if (!version || (version as any).status !== "issued") return null;
    return {
      certificateId: certificate._id,
      certificateVersionId: certificate.latestVersionId,
      certificateHolderId: certificate.certificateHolderId,
      fileId: certificate.fileId,
      fileName: certificate.fileName,
      url: await ctx.storage.getUrl(certificate.fileId),
      authorityType: certificate.authorityType,
      certificationStatus: certificate.certificationStatus,
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
    reissue: v.optional(v.boolean()),
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
      reissue: args.reissue,
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
    reissue: v.optional(v.boolean()),
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

    const currentPolicyVersion = await ctx.runQuery(internal.policies.getCurrentVersionInternal, {
      policyId: args.policyId,
    }).catch(() => null) as { _id: Id<"policyVersions"> } | null;
    const holderKey = normalizeHolderKey(certificateHolder);
    if (!args.reissue && gate.status === "allowed" && currentPolicyVersion) {
      const reusable = await ctx.runQuery(internal.certificates.findReusableIssuedInternal, {
        orgId: args.orgId,
        policyId: args.policyId,
        holderKey,
        policyVersionId: currentPolicyVersion._id,
      });
      if (reusable) {
        return {
          status: "existing",
          fileId: reusable.fileId,
          url: reusable.url,
          fileName: reusable.fileName,
          size: undefined,
          certificateId: reusable.certificateId,
          certificateVersionId: reusable.certificateVersionId,
          certificateHolderId: reusable.certificateHolderId,
          policyVersionId: currentPolicyVersion._id,
          authorityType: reusable.authorityType,
          certificationStatus: reusable.certificationStatus,
          message: "Returned the latest issued certificate for this holder and current policy version. Pass reissue=true to create a new certificate version.",
        };
      }
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
      policyVersionId: currentPolicyVersion?._id,
      holderKey,
      requestText: args.requestText,
      requestedEndorsements: args.requestedEndorsements,
      gateEvidence: gate.evidence,
      issueReason: args.reissue ? "explicit_reissue" : "initial_issue",
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
      certificateVersionId: generated.certificateVersionId,
      certificateHolderId: generated.certificateHolderId,
      policyVersionId: currentPolicyVersion?._id,
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
    policyVersionId: v.optional(v.id("policyVersions")),
    holderKey: v.optional(v.string()),
    requestText: v.optional(v.string()),
    requestedEndorsements: v.optional(requestedEndorsementValidator),
    gateEvidence: v.optional(v.any()),
    issueReason: v.optional(v.union(
      v.literal("initial_issue"),
      v.literal("explicit_reissue"),
      v.literal("renewal_review"),
      v.literal("legacy_backfill"),
    )),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy || policy.orgId !== args.orgId) {
      throw new Error("Policy not found for certificate record.");
    }

    const now = dayjs().valueOf();
    const holderName = holderNameFromCertificate(args.certificateHolder, args.certificateHolderName ?? "Certificate holder");
    const holderKey = args.holderKey ?? normalizeHolderKey(args.certificateHolder ?? holderName);
    const sourceSpanIds = sourceSpanIdsFromEvidence(args.gateEvidence);
    const verificationStatus = sourceSpanIds.length > 0 ? "source_backed" : "manual";

    const existingHolders = await ctx.db
      .query("certificateHolders")
      .withIndex("by_org_normalizedName", (q) =>
        q.eq("orgId", args.orgId).eq("normalizedName", holderKey),
      )
      .collect();
    const holder = existingHolders[0] as any | undefined;
    let certificateHolderId = holder?._id as Id<"certificateHolders"> | undefined;
    if (!certificateHolderId) {
      certificateHolderId = await ctx.db.insert("certificateHolders", {
        orgId: args.orgId,
        name: holderName,
        normalizedName: holderKey,
        certificateHolder: args.certificateHolder,
        source: args.source ?? "agent",
        sourcePolicyId: args.policyId,
        sourcePolicyVersionId: args.policyVersionId,
        sourceSpanIds,
        evidence: args.gateEvidence,
        verificationStatus,
        createdByUserId: args.createdByUserId,
        createdAt: now,
        updatedAt: now,
      });
    } else if (holder.verificationStatus !== "source_backed" && sourceSpanIds.length > 0) {
      await ctx.db.patch(certificateHolderId, {
        sourcePolicyId: args.policyId,
        sourcePolicyVersionId: args.policyVersionId,
        sourceSpanIds,
        evidence: args.gateEvidence,
        verificationStatus: "source_backed",
        updatedAt: now,
      });
    }

    const existingCertificates = await ctx.db
      .query("certificates")
      .withIndex("by_policy_holderKey", (q) =>
        q.eq("policyId", args.policyId).eq("holderKey", holderKey),
      )
      .collect();
    const certificate = existingCertificates
      .filter((row: any) => row.orgId === args.orgId && row.lifecycleStatus !== "inactive")
      .sort((a: any, b: any) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0] as any | undefined;
    let certificateId = certificate?._id as Id<"certificates"> | undefined;
    const versionNumber = certificate?.latestVersionId
      ? (await ctx.db
          .query("certificateVersions")
          .withIndex("by_certificate", (q) => q.eq("certificateId", certificateId!))
          .collect()).length + 1
      : 1;

    if (!certificateId) {
      certificateId = await ctx.db.insert("certificates", {
        orgId: args.orgId,
        policyId: args.policyId,
        certificateHolderId,
        latestPolicyVersionId: args.policyVersionId,
        lifecycleStatus: "active",
        holderKey,
        issuedAt: now,
        updatedAt: now,
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
    }

    const certificateVersionId = await ctx.db.insert("certificateVersions", {
      orgId: args.orgId,
      certificateId,
      certificateHolderId,
      policyId: args.policyId,
      policyVersionId: args.policyVersionId,
      versionNumber,
      status: "issued",
      issueReason: args.issueReason ?? (versionNumber === 1 ? "initial_issue" : "explicit_reissue"),
      fileId: args.fileId,
      fileName: args.fileName ?? "certificate-of-insurance.pdf",
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
      requestText: args.requestText,
      requestedEndorsements: args.requestedEndorsements,
      gateEvidence: args.gateEvidence,
      createdAt: now,
      issuedAt: now,
    });

    await ctx.db.patch(certificateId, {
      certificateHolderId,
      latestVersionId: certificateVersionId,
      latestPolicyVersionId: args.policyVersionId,
      lifecycleStatus: "active",
      holderKey,
      issuedAt: now,
      updatedAt: now,
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
    });

    return { certificateId, certificateVersionId, certificateHolderId };
  },
});



export const backfillLegacyCertificateInternal = internalMutation({
  args: {
    certificateId: v.id("certificates"),
    policyVersionId: v.optional(v.id("policyVersions")),
  },
  handler: async (ctx, args) => {
    const certificate = await ctx.db.get(args.certificateId) as any;
    if (!certificate) return null;
    if (certificate.certificateHolderId && certificate.latestVersionId) return certificate._id;
    const now = dayjs().valueOf();
    const holderName = holderNameFromCertificate(
      certificate.certificateHolder,
      certificate.certificateHolderName ?? "Certificate holder",
    );
    const holderKey = certificate.holderKey ?? normalizeHolderKey(certificate.certificateHolder ?? holderName);
    const existingHolders = await ctx.db
      .query("certificateHolders")
      .withIndex("by_org_normalizedName", (q) =>
        q.eq("orgId", certificate.orgId).eq("normalizedName", holderKey),
      )
      .collect();
    const certificateHolderId = certificate.certificateHolderId ?? existingHolders[0]?._id ?? await ctx.db.insert("certificateHolders", {
      orgId: certificate.orgId,
      name: holderName,
      normalizedName: holderKey,
      certificateHolder: certificate.certificateHolder,
      source: certificate.source ?? "unknown",
      sourcePolicyId: certificate.policyId,
      sourcePolicyVersionId: args.policyVersionId,
      verificationStatus: "legacy_backfill",
      createdByUserId: certificate.createdByUserId,
      createdAt: certificate.createdAt ?? now,
      updatedAt: now,
    });
    const existingVersions = await ctx.db
      .query("certificateVersions")
      .withIndex("by_certificate", (q) => q.eq("certificateId", certificate._id))
      .collect();
    const latestVersionId = certificate.latestVersionId ?? await ctx.db.insert("certificateVersions", {
      orgId: certificate.orgId,
      certificateId: certificate._id,
      certificateHolderId,
      policyId: certificate.policyId,
      policyVersionId: args.policyVersionId,
      versionNumber: existingVersions.length + 1,
      status: "issued",
      issueReason: "legacy_backfill",
      fileId: certificate.fileId,
      fileName: certificate.fileName,
      source: certificate.source ?? "unknown",
      createdByUserId: certificate.createdByUserId,
      authorityType: certificate.authorityType,
      certificationStatus: certificate.certificationStatus,
      partnerOrgId: certificate.partnerOrgId,
      partnerProgramId: certificate.partnerProgramId,
      templateId: certificate.templateId,
      standingAuthorizationId: certificate.standingAuthorizationId,
      approvalId: certificate.approvalId,
      approvalMode: certificate.approvalMode,
      approvalAudit: certificate.approvalAudit,
      disclaimer: certificate.disclaimer,
      createdAt: certificate.createdAt ?? now,
      issuedAt: certificate.issuedAt ?? certificate.createdAt ?? now,
    });
    await ctx.db.patch(certificate._id, {
      certificateHolderId,
      latestVersionId,
      latestPolicyVersionId: certificate.latestPolicyVersionId ?? args.policyVersionId,
      lifecycleStatus: certificate.lifecycleStatus ?? "active",
      holderKey,
      issuedAt: certificate.issuedAt ?? certificate.createdAt ?? now,
      updatedAt: now,
    });
    return certificate._id;
  },
});

export const createRenewalReviewJobsForPolicyInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy || policy.orgId !== args.orgId) return { created: 0 };
    const toPolicyVersionId = (policy as any).currentPolicyVersionId as Id<"policyVersions"> | undefined;
    if (!toPolicyVersionId) return { created: 0 };

    const certificates = await ctx.db
      .query("certificates")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .collect();
    const now = dayjs().valueOf();
    let created = 0;
    for (const certificate of certificates as any[]) {
      if (certificate.orgId !== args.orgId) continue;
      if (certificate.lifecycleStatus === "inactive") continue;
      if (!certificate.latestVersionId || !certificate.certificateHolderId) continue;
      if (certificate.latestPolicyVersionId === toPolicyVersionId) continue;
      const latestVersion = await ctx.db.get(certificate.latestVersionId);
      if (!latestVersion || (latestVersion as any).status !== "issued") continue;
      const existingJobs = await ctx.db
        .query("certificateRenewalReviewJobs")
        .withIndex("by_certificate", (q) => q.eq("certificateId", certificate._id))
        .collect();
      if (existingJobs.some((job: any) =>
        job.status === "pending_review" && job.toPolicyVersionId === toPolicyVersionId,
      )) continue;
      const draftVersionId = await ctx.db.insert("certificateVersions", {
        orgId: args.orgId,
        certificateId: certificate._id,
        certificateHolderId: certificate.certificateHolderId,
        policyId: args.policyId,
        policyVersionId: toPolicyVersionId,
        versionNumber: (await ctx.db
          .query("certificateVersions")
          .withIndex("by_certificate", (q) => q.eq("certificateId", certificate._id))
          .collect()).length + 1,
        status: "draft_review",
        issueReason: "renewal_review",
        source: "agent",
        authorityType: certificate.authorityType,
        certificationStatus: certificate.certificationStatus,
        partnerOrgId: certificate.partnerOrgId,
        partnerProgramId: certificate.partnerProgramId,
        templateId: certificate.templateId,
        standingAuthorizationId: certificate.standingAuthorizationId,
        approvalMode: certificate.approvalMode,
        approvalAudit: certificate.approvalAudit,
        disclaimer: certificate.disclaimer,
        createdAt: now,
      });
      await ctx.db.insert("certificateRenewalReviewJobs", {
        orgId: args.orgId,
        policyId: args.policyId,
        certificateId: certificate._id,
        certificateHolderId: certificate.certificateHolderId,
        fromPolicyVersionId: certificate.latestPolicyVersionId,
        toPolicyVersionId,
        draftVersionId,
        status: "pending_review",
        reason: "Policy version changed; review before reissuing this holder certificate.",
        createdAt: now,
        updatedAt: now,
      });
      created += 1;
    }
    return { created };
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
