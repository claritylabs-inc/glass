import { getAuthUserId } from "@convex-dev/auth/server";
import dayjs from "dayjs";
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getOrgAccess, getPolicyAccessForQuery } from "./lib/access";
import { evaluateCertificateRequestGate } from "./lib/certificateRequestGate";

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
    const sourceSpans = await ctx.runQuery(
      internal.sourceSpans.listSpansByPolicyInternal,
      { policyId: args.policyId },
    ).catch(() => []);
    const gate = evaluateCertificateRequestGate({
      certificateHolder,
      requestText: args.requestText,
      requestedEndorsements: args.requestedEndorsements,
      policy: policy as Record<string, unknown> | null,
      sourceSpans,
    });

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
