import dayjs from "dayjs";
import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { assertPartnerOrg, getOrgAccess } from "./lib/access";
import { notify } from "./lib/notify";
import { getAuthUserId } from "@convex-dev/auth/server";

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

function normalize(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function policyNames(policy: any) {
  return [
    policy.partnerOrgId ? "__manual_partner__" : undefined,
    policy.mga,
    policy.security,
    policy.carrier,
    policy.carrierLegalName,
    policy.insurer?.legalName,
  ].filter(Boolean).map(normalize);
}

function policyTypes(policy: any): string[] {
  return Array.isArray(policy.policyTypes)
    ? policy.policyTypes.map((type: unknown) => normalize(type)).filter(Boolean)
    : [];
}

async function matchedProgram(ctx: any, policy: any) {
  if (policy.partnerOrgId) {
    const program = policy.partnerProgramId
      ? await ctx.db.get(policy.partnerProgramId)
      : await ctx.db
          .query("partnerPrograms")
          .withIndex("by_partnerOrgId", (q: any) => q.eq("partnerOrgId", policy.partnerOrgId))
          .filter((q: any) => q.eq(q.field("status"), "active"))
          .first();
    if (program) return program;
  }

  const names = new Set(policyNames(policy));
  const programs = await ctx.db
    .query("partnerPrograms")
    .withIndex("by_status", (q: any) => q.eq("status", "active"))
    .collect();

  return programs.find((program: any) => {
    const aliases = [program.name, ...(program.aliases ?? [])].map(normalize);
    return aliases.some((alias) => alias && names.has(alias));
  }) ?? null;
}

async function activeTemplateAndAuthorization(ctx: any, policy: any, program: any) {
  const templates = await ctx.db
    .query("coiTemplates")
    .withIndex("by_programId", (q: any) => q.eq("programId", program._id))
    .filter((q: any) => q.eq(q.field("status"), "active"))
    .collect();
  if (templates.length === 0) return {};

  const authorizations = await ctx.db
    .query("standingAuthorizations")
    .withIndex("by_programId", (q: any) => q.eq("programId", program._id))
    .filter((q: any) => q.eq(q.field("status"), "active"))
    .collect();
  const types = new Set(policyTypes(policy));
  const authorization = authorizations.find((auth: any) => {
    if (auth.allowedPolicyTypes && auth.allowedPolicyTypes.length > 0) {
      return auth.allowedPolicyTypes.map(normalize).some((type: string) => types.has(type));
    }
    return true;
  });
  const template = authorization
    ? templates.find((item: any) => item._id === authorization.templateId) ?? templates[0]
    : templates[0];
  return { template, authorization };
}

async function requireCurrentPartnerAccess(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .first();
  if (!membership) throw new Error("No organization membership");
  const access = await getOrgAccess(ctx, membership.orgId);
  assertPartnerOrg(access);
  return access;
}

export const upsertProgram = mutation({
  args: {
    name: v.string(),
    aliases: v.optional(v.array(v.string())),
    status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
  },
  handler: async (ctx, args) => {
    const access = await requireCurrentPartnerAccess(ctx);
    if (access.role !== "admin") throw new Error("Admin role required");

    const now = dayjs().valueOf();
    const existing = await ctx.db
      .query("partnerPrograms")
      .withIndex("by_partnerOrgId", (q) => q.eq("partnerOrgId", access.org._id))
      .filter((q) => q.eq(q.field("name"), args.name.trim()))
      .first();
    const patch = {
      partnerOrgId: access.org._id,
      name: args.name.trim(),
      aliases: args.aliases ?? [],
      status: args.status ?? "active",
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("partnerPrograms", { ...patch, createdAt: now });
  },
});

export const createTemplate = mutation({
  args: {
    programId: v.optional(v.id("partnerPrograms")),
    name: v.string(),
    templateKind: v.optional(v.union(v.literal("pdf_fields"), v.literal("standard_overlay"))),
    fileId: v.optional(v.id("_storage")),
    fieldMappings: v.optional(v.any()),
    certifiedNotice: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireCurrentPartnerAccess(ctx);
    if (access.role !== "admin") throw new Error("Admin role required");
    if (args.programId) {
      const program = await ctx.db.get(args.programId);
      if (!program || program.partnerOrgId !== access.org._id) throw new Error("Program not found");
    }
    const now = dayjs().valueOf();
    return await ctx.db.insert("coiTemplates", {
      partnerOrgId: access.org._id,
      programId: args.programId,
      name: args.name.trim(),
      templateKind: args.templateKind ?? "pdf_fields",
      fileId: args.fileId,
      fieldMappings: args.fieldMappings,
      certifiedNotice: args.certifiedNotice,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const createStandingAuthorization = mutation({
  args: {
    programId: v.id("partnerPrograms"),
    templateId: v.id("coiTemplates"),
    allowedPolicyTypes: v.optional(v.array(v.string())),
    allowedCoverageCodes: v.optional(v.array(v.string())),
    authorizationText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireCurrentPartnerAccess(ctx);
    if (access.role !== "admin") throw new Error("Admin role required");
    const [program, template] = await Promise.all([
      ctx.db.get(args.programId),
      ctx.db.get(args.templateId),
    ]);
    if (!program || program.partnerOrgId !== access.org._id) throw new Error("Program not found");
    if (!template || template.partnerOrgId !== access.org._id) throw new Error("Template not found");
    const now = dayjs().valueOf();
    return await ctx.db.insert("standingAuthorizations", {
      partnerOrgId: access.org._id,
      programId: args.programId,
      templateId: args.templateId,
      status: "active",
      allowedPolicyTypes: args.allowedPolicyTypes,
      allowedCoverageCodes: args.allowedCoverageCodes,
      authorizationText: args.authorizationText,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const resolveCertificateAuthority = internalQuery({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy) throw new Error("Policy not found");
    const program = await matchedProgram(ctx, policy);
    if (!program) {
      return {
        authorityType: "non_binding",
        certificationStatus: "not_applicable",
        disclaimer: "This non-binding certificate is issued for information only and does not amend, extend, alter or certify coverage.",
      };
    }

    const { template, authorization } = await activeTemplateAndAuthorization(ctx, policy, program);
    return {
      authorityType: "certified",
      certificationStatus: authorization ? "certified" : "pending",
      partnerOrgId: program.partnerOrgId,
      partnerProgramId: program._id,
      templateId: template?._id,
      standingAuthorizationId: authorization?._id,
      approvalType: authorization ? "standing_authorization" : undefined,
      disclaimer: authorization
        ? `Certified under standing authorization from ${program.name}.`
        : `Certification requires approval from ${program.name}.`,
    };
  },
});

export const resolvePolicyPartner = internalQuery({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy) throw new Error("Policy not found");
    const program = await matchedProgram(ctx, policy);
    if (!program) return null;
    return {
      partnerOrgId: program.partnerOrgId,
      partnerProgramId: program._id,
      programName: program.name,
    };
  },
});

export const markPolicyChangePendingPartnerInternal = internalMutation({
  args: {
    caseId: v.id("policyChangeCases"),
    partnerOrgId: v.id("organizations"),
    partnerProgramId: v.optional(v.id("partnerPrograms")),
  },
  handler: async (ctx, args) => {
    const changeCase = await ctx.db.get(args.caseId);
    if (!changeCase) throw new Error("Policy change case not found");
    await ctx.db.patch(args.caseId, {
      partnerOrgId: args.partnerOrgId,
      partnerProgramId: args.partnerProgramId,
      partnerApprovalStatus: "pending",
      status: "ready",
      updatedAt: dayjs().valueOf(),
    });
    await notify(ctx, {
      orgId: args.partnerOrgId,
      type: "program_admin_pce_request",
      title: "Policy change approval requested",
      body: changeCase.summary ?? "A policy change request is waiting for approval.",
      actionType: "review_program_admin_pce",
      actionPayload: { caseId: args.caseId, href: `/partner/approvals?caseId=${args.caseId}` },
      sourceRef: { caseId: args.caseId, policyId: changeCase.policyId },
    });
  },
});

export const createCertificateRequestInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    partnerOrgId: v.id("organizations"),
    partnerProgramId: v.optional(v.id("partnerPrograms")),
    templateId: v.optional(v.id("coiTemplates")),
    holderName: v.string(),
    certificateHolder: v.optional(v.string()),
    source: v.optional(certificateSourceValidator),
    createdByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const requestId = await ctx.db.insert("certificateRequests", {
      ...args,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await notify(ctx, {
      orgId: args.partnerOrgId,
      type: "program_admin_certificate_request",
      title: "Certified COI approval requested",
      body: `A certified certificate is waiting for approval for ${args.holderName}.`,
      actionType: "review_program_admin_certificate",
      actionPayload: { requestId, href: `/partner/approvals?requestId=${requestId}` },
      sourceRef: { requestId, policyId: args.policyId },
    });
    return requestId;
  },
});

export const recordCertificateApprovalInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    requestId: v.optional(v.id("certificateRequests")),
    certificateId: v.optional(v.id("certificates")),
    partnerOrgId: v.id("organizations"),
    partnerProgramId: v.optional(v.id("partnerPrograms")),
    templateId: v.optional(v.id("coiTemplates")),
    standingAuthorizationId: v.optional(v.id("standingAuthorizations")),
    approvalType: v.union(v.literal("human"), v.literal("standing_authorization")),
    status: v.union(v.literal("approved"), v.literal("declined")),
    approvedByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    return await ctx.db.insert("certificateApprovals", {
      ...args,
      createdAt: now,
      approvedAt: now,
    });
  },
});

export const linkCertificateApprovalInternal = internalMutation({
  args: {
    certificateId: v.id("certificates"),
    approvalId: v.id("certificateApprovals"),
    requestId: v.optional(v.id("certificateRequests")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.certificateId, { approvalId: args.approvalId });
    await ctx.db.patch(args.approvalId, { certificateId: args.certificateId });
    if (args.requestId) {
      await ctx.db.patch(args.requestId, {
        status: "approved",
        certificateId: args.certificateId,
        approvalId: args.approvalId,
        updatedAt: dayjs().valueOf(),
      });
    }
  },
});

export const listApprovalQueue = query({
  args: {},
  handler: async (ctx) => {
    const access = await requireCurrentPartnerAccess(ctx);

    const certificateRequests = await ctx.db
      .query("certificateRequests")
      .withIndex("by_partnerOrgId_status", (q) => q.eq("partnerOrgId", access.org._id).eq("status", "pending"))
      .order("desc")
      .collect();
    const policyChangeCases = await ctx.db
      .query("policyChangeCases")
      .withIndex("by_partnerOrgId_approval", (q) =>
        q.eq("partnerOrgId", access.org._id).eq("partnerApprovalStatus", "pending"))
      .collect();

    return {
      certificateRequests: await Promise.all(certificateRequests.map(async (request) => ({
        ...request,
        policy: await ctx.db.get(request.policyId),
        program: request.partnerProgramId ? await ctx.db.get(request.partnerProgramId) : null,
      }))),
      policyChangeCases: await Promise.all(policyChangeCases
        .map(async (changeCase) => ({
          ...changeCase,
          policy: changeCase.policyId ? await ctx.db.get(changeCase.policyId) : null,
          program: changeCase.partnerProgramId ? await ctx.db.get(changeCase.partnerProgramId) : null,
        }))),
    };
  },
});

export const approveCertificateRequest = action({
  args: { requestId: v.id("certificateRequests"), notes: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args): Promise<any> => {
    const viewerOrg = await ctx.runQuery(api.orgs.viewerOrg, {});
    if (!viewerOrg?.org || viewerOrg.org.type !== "partner") throw new Error("Partner access required");
    const request: any = await ctx.runQuery(internal.partnerPrograms.getCertificateRequestInternal, { requestId: args.requestId });
    if (!request || request.partnerOrgId !== viewerOrg.org._id) throw new Error("Certificate request not found");
    const generated: any = await ctx.runAction(internal.actions.generateCoi.run, {
      orgId: request.orgId,
      policyId: request.policyId,
      certificateHolder: request.certificateHolder,
      certificateHolderName: request.holderName,
      source: request.source,
      createdByUserId: viewerOrg.membership.userId,
      authorityType: "certified",
      certificationStatus: "certified",
      partnerOrgId: request.partnerOrgId,
      partnerProgramId: request.partnerProgramId,
      templateId: request.templateId,
      disclaimer: args.notes
        ? `Certified by program administrator. Notes: ${args.notes}`
        : "Certified by program administrator.",
    });
    const approvalId = await ctx.runMutation(internal.partnerPrograms.recordCertificateApprovalInternal, {
      orgId: request.orgId,
      policyId: request.policyId,
      requestId: args.requestId,
      partnerOrgId: request.partnerOrgId,
      partnerProgramId: request.partnerProgramId,
      templateId: request.templateId,
      approvalType: "human",
      status: "approved",
      approvedByUserId: viewerOrg.membership.userId,
      notes: args.notes,
    });
    await ctx.runMutation(internal.partnerPrograms.linkCertificateApprovalInternal, {
      certificateId: generated.certificateId as Id<"certificates">,
      approvalId,
      requestId: args.requestId,
    });
    return generated;
  },
});

export const declineCertificateRequest = mutation({
  args: { requestId: v.id("certificateRequests"), notes: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const access = await requireCurrentPartnerAccess(ctx);
    const request = await ctx.db.get(args.requestId);
    if (!request || request.partnerOrgId !== access.org._id) throw new Error("Certificate request not found");
    const approvalId = await ctx.db.insert("certificateApprovals", {
      orgId: request.orgId,
      policyId: request.policyId,
      requestId: args.requestId,
      partnerOrgId: request.partnerOrgId,
      partnerProgramId: request.partnerProgramId,
      templateId: request.templateId,
      approvalType: "human",
      status: "declined",
      approvedByUserId: access.userId,
      notes: args.notes,
      createdAt: dayjs().valueOf(),
      approvedAt: dayjs().valueOf(),
    });
    await ctx.db.patch(args.requestId, {
      status: "declined",
      approvalId,
      notes: args.notes,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const approvePolicyChangeCase = mutation({
  args: {
    caseId: v.id("policyChangeCases"),
    notes: v.optional(v.string()),
    stagedPolicyUpdate: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const access = await requireCurrentPartnerAccess(ctx);
    const changeCase = await ctx.db.get(args.caseId);
    if (!changeCase || changeCase.partnerOrgId !== access.org._id) {
      throw new Error("Policy change case not found");
    }
    await ctx.db.patch(args.caseId, {
      partnerApprovalStatus: "approved",
      partnerApprovedByUserId: access.userId,
      partnerApprovedAt: dayjs().valueOf(),
      stagedPolicyUpdate: args.stagedPolicyUpdate ?? {
        status: "approved_by_program_admin",
        notes: args.notes,
      },
      status: "accepted",
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const declinePolicyChangeCase = mutation({
  args: { caseId: v.id("policyChangeCases"), notes: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const access = await requireCurrentPartnerAccess(ctx);
    const changeCase = await ctx.db.get(args.caseId);
    if (!changeCase || changeCase.partnerOrgId !== access.org._id) {
      throw new Error("Policy change case not found");
    }
    await ctx.db.patch(args.caseId, {
      partnerApprovalStatus: "declined",
      stagedPolicyUpdate: args.notes ? { declineNotes: args.notes } : undefined,
      status: "declined",
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const getCertificateRequestInternal = internalQuery({
  args: { requestId: v.id("certificateRequests") },
  handler: async (ctx, args) => ctx.db.get(args.requestId),
});
