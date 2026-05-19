import dayjs from "dayjs";
import { generateObject } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { assertPartnerOrg, getOrgAccess } from "./lib/access";
import { notify } from "./lib/notify";
import { getAuthUserId } from "@convex-dev/auth/server";
import { makeEmbedText } from "./lib/sdkCallbacks";
import { getModelForOrg, getProviderOptionsForTask } from "./lib/models";

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

const approvalModeValidator = v.union(
  v.literal("auto_approve_all"),
  v.literal("require_approval_all"),
  v.literal("llm_review"),
);

const templateKindValidator = v.union(
  v.literal("standard_glass"),
  v.literal("custom_glass"),
  v.literal("pdf_overlay"),
  v.literal("pdf_fields"),
  v.literal("standard_overlay"),
);

const LlmApprovalSchema = z.object({
  approved: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoningSummary: z.string(),
  evidence: z
    .array(
      z.object({
        label: z.string(),
        excerpt: z.string(),
        page: z.number().optional(),
      }),
    )
    .default([]),
});

const AutoPlaceTemplateSchema = z.object({
  matches: z.array(
    z.object({
      fieldId: z.string(),
      candidateId: z.string(),
      confidence: z.number().min(0).max(1).nullable(),
    }),
  ),
});

type AutoPlaceTemplateResult = z.infer<typeof AutoPlaceTemplateSchema>;

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
  ]
    .filter(Boolean)
    .map(normalize);
}

function programMatchText(program: {
  name?: string;
  aliases?: string[];
  categoryLabels?: string[];
  categoryLabel?: string;
}) {
  return [program.name, ...(program.categoryLabels ?? []), program.categoryLabel, ...(program.aliases ?? [])]
    .filter(Boolean)
    .join("\n");
}

function cleanStringList(items?: string[]) {
  const seen = new Set<string>();
  return (items ?? [])
    .map((item) => item.trim())
    .filter((item) => {
      const key = normalize(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function policyMatchText(policy: any) {
  return [
    ...(Array.isArray(policy.policyTypes) ? policy.policyTypes : []),
    policy.policyType,
    policy.mga,
    policy.security,
    policy.carrier,
    policy.carrierLegalName,
    policy.insurer?.legalName,
  ]
    .filter(Boolean)
    .join("\n");
}

async function matchedProgram(ctx: any, policy: any) {
  if (policy.partnerOrgId) {
    const program = policy.partnerProgramId
      ? await ctx.db.get(policy.partnerProgramId)
      : await ctx.db
          .query("partnerPrograms")
          .withIndex("by_partnerOrgId", (q: any) =>
            q.eq("partnerOrgId", policy.partnerOrgId),
          )
          .filter((q: any) => q.eq(q.field("status"), "active"))
          .first();
    if (program) return program;
  }

  const names = new Set(policyNames(policy));
  const programs = await ctx.db
    .query("partnerPrograms")
    .withIndex("by_status", (q: any) => q.eq("status", "active"))
    .collect();

  return (
    programs.find((program: any) => {
      const aliases = [program.name, ...(program.aliases ?? [])].map(normalize);
      return aliases.some((alias) => alias && names.has(alias));
    }) ?? null
  );
}

async function activeTemplate(ctx: any, program: any) {
  if (program.defaultTemplateId) {
    const template = await ctx.db.get(program.defaultTemplateId);
    if (template && template.status === "active") return template;
  }
  return await ctx.db
    .query("coiTemplates")
    .withIndex("by_programId", (q: any) => q.eq("programId", program._id))
    .filter((q: any) => q.eq(q.field("status"), "active"))
    .first();
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
    programId: v.optional(v.id("partnerPrograms")),
    name: v.string(),
    aliases: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
    categoryLabels: v.optional(v.array(v.string())),
    categoryLabel: v.optional(v.string()),
    defaultTemplateId: v.optional(v.id("coiTemplates")),
    approvalMode: v.optional(approvalModeValidator),
    approvalRuleText: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
  },
  handler: async (ctx, args) => {
    const access = await requireCurrentPartnerAccess(ctx);
    if (access.role !== "admin") throw new Error("Admin role required");

    const existing = args.programId
      ? await ctx.db.get(args.programId)
      : await ctx.db
          .query("partnerPrograms")
          .withIndex("by_partnerOrgId", (q) =>
            q.eq("partnerOrgId", access.org._id),
          )
          .filter((q) => q.eq(q.field("name"), args.name.trim()))
          .first();
    if (existing && existing.partnerOrgId !== access.org._id) {
      throw new Error("Program not found");
    }
    if (args.defaultTemplateId) {
      const template = await ctx.db.get(args.defaultTemplateId);
      if (!template || template.partnerOrgId !== access.org._id) {
        throw new Error("Default template not found");
      }
    }

    const now = dayjs().valueOf();
    const categoryLabels = cleanStringList(
      args.categoryLabels ?? (args.categoryLabel ? [args.categoryLabel] : []),
    );
    const patch = {
      partnerOrgId: access.org._id,
      name: args.name.trim(),
      aliases: cleanStringList(args.aliases),
      description: args.description?.trim() || undefined,
      categoryLabels,
      categoryLabel: categoryLabels[0],
      defaultTemplateId: args.defaultTemplateId,
      approvalMode: args.approvalMode ?? "require_approval_all",
      approvalRuleText: args.approvalRuleText?.trim() || undefined,
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

export const saveProgram = action({
  args: {
    programId: v.optional(v.id("partnerPrograms")),
    name: v.string(),
    aliases: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
    categoryLabels: v.optional(v.array(v.string())),
    categoryLabel: v.optional(v.string()),
    defaultTemplateId: v.optional(v.id("coiTemplates")),
    approvalMode: approvalModeValidator,
    approvalRuleText: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
  },
  handler: async (ctx, args): Promise<Id<"partnerPrograms">> => {
    const programId = await ctx.runMutation(api.partnerPrograms.upsertProgram, args) as Id<"partnerPrograms">;
    const program = await ctx.runQuery(internal.partnerPrograms.getProgramInternal, {
      programId,
    });
    if (program) {
      const embedding = await makeEmbedText(ctx, program.partnerOrgId)(
        programMatchText(program),
      );
      await ctx.runMutation(
        internal.partnerPrograms.upsertProgramEmbeddingInternal,
        {
          partnerOrgId: program.partnerOrgId,
          programId,
          matchText: programMatchText(program),
          embedding,
          status: program.status,
        },
      );
    }
    return programId;
  },
});

export const listPrograms = query({
  args: {},
  handler: async (ctx) => {
    const access = await requireCurrentPartnerAccess(ctx);
    const [programs, templates] = await Promise.all([
      ctx.db
        .query("partnerPrograms")
        .withIndex("by_partnerOrgId", (q) => q.eq("partnerOrgId", access.org._id))
        .collect(),
      ctx.db
        .query("coiTemplates")
        .withIndex("by_partnerOrgId", (q) => q.eq("partnerOrgId", access.org._id))
        .collect(),
    ]);
    const templateById = new Map(
      templates.map((template) => [String(template._id), template]),
    );
    return programs
      .map((program) => ({
        ...program,
        defaultTemplate: program.defaultTemplateId
          ? templateById.get(String(program.defaultTemplateId)) ?? null
          : null,
        templateCount: templates.filter(
          (template) => String(template.programId) === String(program._id),
        ).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const createTemplate = mutation({
  args: {
    templateId: v.optional(v.id("coiTemplates")),
    programId: v.optional(v.id("partnerPrograms")),
    name: v.string(),
    templateKind: v.optional(templateKindValidator),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    fieldMappings: v.optional(v.any()),
    certifiedNotice: v.optional(v.string()),
    fallbackToStandard: v.optional(v.boolean()),
    status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
  },
  handler: async (ctx, args) => {
    const access = await requireCurrentPartnerAccess(ctx);
    if (access.role !== "admin") throw new Error("Admin role required");
    if (args.programId) {
      const program = await ctx.db.get(args.programId);
      if (!program || program.partnerOrgId !== access.org._id) {
        throw new Error("Program not found");
      }
    }
    const now = dayjs().valueOf();
    const patch = {
      partnerOrgId: access.org._id,
      programId: args.programId,
      name: args.name.trim(),
      templateKind: args.templateKind ?? "standard_glass",
      fileId: args.fileId,
      fileName: args.fileName,
      fieldMappings: args.fieldMappings,
      certifiedNotice: args.certifiedNotice,
      fallbackToStandard: args.fallbackToStandard ?? true,
      status: args.status ?? "active",
      updatedAt: now,
    };
    if (args.templateId) {
      const existing = await ctx.db.get(args.templateId);
      if (!existing || existing.partnerOrgId !== access.org._id) {
        throw new Error("Template not found");
      }
      await ctx.db.patch(args.templateId, patch);
      return args.templateId;
    }
    return await ctx.db.insert("coiTemplates", { ...patch, createdAt: now });
  },
});

export const generateTemplateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const access = await requireCurrentPartnerAccess(ctx);
    if (access.role !== "admin") throw new Error("Admin role required");
    return await ctx.storage.generateUploadUrl();
  },
});

export const getCurrentPartnerOrgForAction = query({
  args: {},
  handler: async (ctx) => {
    const access = await requireCurrentPartnerAccess(ctx);
    if (access.role !== "admin") throw new Error("Admin role required");
    return { orgId: access.org._id, role: access.role };
  },
});

export const autoPlaceTemplateFields = action({
  args: {
    fileId: v.id("_storage"),
    fields: v.array(
      v.object({
        id: v.string(),
        key: v.optional(v.string()),
        label: v.string(),
        type: v.optional(v.string()),
      }),
    ),
    candidates: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        kind: v.union(v.literal("field"), v.literal("area")),
        nearbyText: v.array(v.string()),
        x: v.number(),
        y: v.number(),
        width: v.number(),
        height: v.number(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<AutoPlaceTemplateResult> => {
    const access = await ctx.runQuery(
      api.partnerPrograms.getCurrentPartnerOrgForAction,
      {},
    ) as { orgId: Id<"organizations">; role: string };
    const result = await generateObject({
      model: await getModelForOrg(ctx, access.orgId, "classification"),
      providerOptions: getProviderOptionsForTask("classification"),
      schema: AutoPlaceTemplateSchema,
      system:
        "You match certificate overlay fields to deterministic PDF layout candidate rectangles. Do not invent coordinates. Choose only candidate IDs from the provided candidates. Prefer exact label matches and blank value cells to the right of labels. Coverage table fields should match a larger area candidate in the coverages/products section. If uncertain, choose the nearest semantically plausible candidate with low confidence.",
      prompt: JSON.stringify({
        rules: [
          "Return one match for every requested field.",
          "candidateId must exactly equal one of the provided candidate ids.",
          "Do not use coordinates or labels that are not in the candidate list.",
          "Match policy_number to policy/plan number labels when no literal policy number label exists.",
          "Match coi_number or certificate number fields to certificate number labels.",
          "Match issued_date to date issued labels.",
          "Match coverage_table to the broad coverage detail area candidate, not a single coverage type row, when available.",
        ],
        fields: args.fields,
        candidates: args.candidates,
      }),
    });

    return result.object as AutoPlaceTemplateResult;
  },
});

export const listTemplates = query({
  args: {},
  handler: async (ctx) => {
    const access = await requireCurrentPartnerAccess(ctx);
    const [templates, programs] = await Promise.all([
      ctx.db
        .query("coiTemplates")
        .withIndex("by_partnerOrgId", (q) => q.eq("partnerOrgId", access.org._id))
        .collect(),
      ctx.db
        .query("partnerPrograms")
        .withIndex("by_partnerOrgId", (q) => q.eq("partnerOrgId", access.org._id))
        .collect(),
    ]);
    const programById = new Map(
      programs.map((program) => [String(program._id), program]),
    );
    return await Promise.all(
      templates.map(async (template) => ({
        ...template,
        fileUrl: template.fileId ? await ctx.storage.getUrl(template.fileId) : null,
        program: template.programId
          ? programById.get(String(template.programId)) ?? null
          : null,
      })),
    );
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
    if (!program || program.partnerOrgId !== access.org._id) {
      throw new Error("Program not found");
    }
    if (!template || template.partnerOrgId !== access.org._id) {
      throw new Error("Template not found");
    }
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

export const resolveCertificateAuthority = internalAction({
  args: {
    policyId: v.id("policies"),
    selectedPartnerProgramId: v.optional(v.id("partnerPrograms")),
  },
  handler: async (ctx, args): Promise<any> => {
    const policy: any = await ctx.runQuery(internal.policies.getInternal, {
      id: args.policyId,
    });
    if (!policy) throw new Error("Policy not found");

    let program: any = null;
    let matchCandidates: any[] = [];

    if (args.selectedPartnerProgramId) {
      program = await ctx.runQuery(internal.partnerPrograms.getProgramInternal, {
        programId: args.selectedPartnerProgramId,
      });
    } else {
      const matchText = policyMatchText(policy);
      if (matchText.trim()) {
        const vector = await makeEmbedText(ctx, policy.orgId)(matchText);
        const results = await ctx.vectorSearch(
          "partnerProgramEmbeddings",
          "by_embedding",
          {
            vector,
            limit: 5,
            filter: (q) => q.eq("status", "active"),
          },
        );
        matchCandidates = (
          await Promise.all(
            results.map(async (result) => {
              const embedding = await ctx.runQuery(
                internal.partnerPrograms.getProgramEmbeddingInternal,
                { id: result._id },
              );
              if (!embedding) return null;
              const matched = await ctx.runQuery(
                internal.partnerPrograms.getProgramInternal,
                { programId: embedding.programId },
              );
              if (!matched || matched.status !== "active") return null;
              return { ...matched, score: result._score };
            }),
          )
        ).filter(Boolean) as any[];
        const top = matchCandidates[0];
        const second = matchCandidates[1];
        if (top && top.score >= 0.72 && (!second || top.score - second.score >= 0.05)) {
          program = top;
        }
      }
    }

    if (!program) {
      if (matchCandidates.length > 0) {
        return {
          authorityType: "certified",
          certificationStatus: "needs_program_selection",
          matchCandidates: matchCandidates.map((candidate) => ({
            _id: candidate._id,
            name: candidate.name,
            aliases: candidate.aliases,
            categoryLabel: candidate.categoryLabels?.join(", ") ?? candidate.categoryLabel,
            categoryLabels: candidate.categoryLabels,
            score: candidate.score,
          })),
          disclaimer:
            "Certification requires selecting the program administrator program.",
        };
      }
      return {
        authorityType: "non_binding",
        certificationStatus: "not_applicable",
        disclaimer:
          "This non-binding certificate is issued for information only and does not amend, extend, alter or certify coverage.",
      };
    }

    const template = await ctx.runQuery(
      internal.partnerPrograms.getActiveTemplateForProgramInternal,
      { programId: program._id },
    );
    const approvalMode = program.approvalMode ?? "require_approval_all";

    if (approvalMode === "auto_approve_all") {
      return {
        authorityType: "certified",
        certificationStatus: "certified",
        partnerOrgId: program.partnerOrgId,
        partnerProgramId: program._id,
        templateId: template?._id,
        approvalType: "standing_authorization",
        approvalMode,
        approvalAudit: {
          approvalMode,
          reasoningSummary: `Auto-approved under ${program.name}.`,
        },
        disclaimer: `Certified under auto-approval rules from ${program.name}.`,
      };
    }

    if (approvalMode === "llm_review") {
      const spans: any[] = await ctx
        .runQuery(internal.sourceSpans.listSpansByPolicyInternal, {
          policyId: args.policyId,
        })
        .catch(() => []);
      const sourceExcerpts = spans.slice(0, 10).map((span) => ({
        page: span.pageStart,
        text: String(span.text ?? "").slice(0, 900),
      }));
      const result = await generateObject({
        model: await getModelForOrg(ctx, policy.orgId, "analysis"),
        providerOptions: getProviderOptionsForTask("analysis"),
        schema: LlmApprovalSchema,
        system:
          "You review whether a certificate of insurance can be certified under an MGA program rule. Be conservative: approve only if the rule clearly permits it from structured fields and source excerpts. If evidence is missing, ambiguous, or conflicts, do not approve.",
        prompt: JSON.stringify({
          program: {
            name: program.name,
            aliases: program.aliases,
            categoryLabels: program.categoryLabels,
            rule: program.approvalRuleText,
          },
          policy: {
            policyTypes: policy.policyTypes,
            policyType: policy.policyType,
            carrier: policy.carrier,
            mga: policy.mga,
            security: policy.security,
            insuredName: policy.insuredName,
            policyNumber: policy.policyNumber,
            effectiveDate: policy.effectiveDate,
            expirationDate: policy.expirationDate,
            coverages: policy.coverages,
          },
          sourceExcerpts,
        }),
      });
      const audit = {
        approvalMode,
        ruleText: program.approvalRuleText,
        confidence: result.object.confidence,
        reasoningSummary: result.object.reasoningSummary,
        evidence: result.object.evidence,
      };
      if (result.object.approved && result.object.confidence >= 0.72) {
        return {
          authorityType: "certified",
          certificationStatus: "certified",
          partnerOrgId: program.partnerOrgId,
          partnerProgramId: program._id,
          templateId: template?._id,
          approvalType: "standing_authorization",
          approvalMode,
          approvalAudit: audit,
          disclaimer: `Certified under LLM-reviewed program rules from ${program.name}.`,
        };
      }
      return {
        authorityType: "certified",
        certificationStatus: "pending",
        partnerOrgId: program.partnerOrgId,
        partnerProgramId: program._id,
        templateId: template?._id,
        approvalMode,
        approvalAudit: audit,
        disclaimer: `Certification requires approval from ${program.name}.`,
      };
    }

    return {
      authorityType: "certified",
      certificationStatus: "pending",
      partnerOrgId: program.partnerOrgId,
      partnerProgramId: program._id,
      templateId: template?._id,
      approvalMode,
      disclaimer: `Certification requires approval from ${program.name}.`,
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
      actionPayload: {
        caseId: args.caseId,
        href: `/partner/approvals?caseId=${args.caseId}`,
      },
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
    matchCandidates: v.optional(v.any()),
    approvalMode: v.optional(approvalModeValidator),
    approvalAudit: v.optional(v.any()),
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
      actionPayload: {
        requestId,
        href: `/partner/approvals?requestId=${requestId}`,
      },
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
    approvalMode: v.optional(approvalModeValidator),
    audit: v.optional(v.any()),
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
      .withIndex("by_partnerOrgId_status", (q) =>
        q.eq("partnerOrgId", access.org._id).eq("status", "pending"),
      )
      .order("desc")
      .collect();
    const policyChangeCases = await ctx.db
      .query("policyChangeCases")
      .withIndex("by_partnerOrgId_approval", (q) =>
        q.eq("partnerOrgId", access.org._id).eq("partnerApprovalStatus", "pending"),
      )
      .collect();

    return {
      certificateRequests: await Promise.all(
        certificateRequests.map(async (request) => ({
          ...request,
          policy: await ctx.db.get(request.policyId),
          program: request.partnerProgramId
            ? await ctx.db.get(request.partnerProgramId)
            : null,
          template: request.templateId ? await ctx.db.get(request.templateId) : null,
        })),
      ),
      policyChangeCases: await Promise.all(
        policyChangeCases.map(async (changeCase) => ({
          ...changeCase,
          policy: changeCase.policyId ? await ctx.db.get(changeCase.policyId) : null,
          program: changeCase.partnerProgramId
            ? await ctx.db.get(changeCase.partnerProgramId)
            : null,
        })),
      ),
    };
  },
});

export const approveCertificateRequest = action({
  args: {
    requestId: v.id("certificateRequests"),
    notes: v.optional(v.string()),
    partnerProgramId: v.optional(v.id("partnerPrograms")),
    templateId: v.optional(v.id("coiTemplates")),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<any> => {
    const viewerOrg = await ctx.runQuery(api.orgs.viewerOrg, {});
    if (!viewerOrg?.org || viewerOrg.org.type !== "partner") {
      throw new Error("Partner access required");
    }
    const request: any = await ctx.runQuery(
      internal.partnerPrograms.getCertificateRequestInternal,
      { requestId: args.requestId },
    );
    if (!request || request.partnerOrgId !== viewerOrg.org._id) {
      throw new Error("Certificate request not found");
    }
    const partnerProgramId = args.partnerProgramId ?? request.partnerProgramId;
    const templateId = args.templateId ?? request.templateId;
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
      partnerProgramId,
      templateId,
      approvalMode: request.approvalMode,
      approvalAudit: request.approvalAudit,
      disclaimer: args.notes
        ? `Certified by program administrator. Notes: ${args.notes}`
        : "Certified by program administrator.",
    });
    const approvalId = await ctx.runMutation(
      internal.partnerPrograms.recordCertificateApprovalInternal,
      {
        orgId: request.orgId,
        policyId: request.policyId,
        requestId: args.requestId,
        partnerOrgId: request.partnerOrgId,
        partnerProgramId,
        templateId,
        approvalType: "human",
        status: "approved",
        approvedByUserId: viewerOrg.membership.userId,
        approvalMode: request.approvalMode,
        audit: {
          ...(request.approvalAudit ?? {}),
          reassignedProgram: args.partnerProgramId ? true : undefined,
          reassignedTemplate: args.templateId ? true : undefined,
        },
        notes: args.notes,
      },
    );
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
    if (!request || request.partnerOrgId !== access.org._id) {
      throw new Error("Certificate request not found");
    }
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
      approvalMode: request.approvalMode,
      audit: request.approvalAudit,
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

export const getProgramInternal = internalQuery({
  args: { programId: v.id("partnerPrograms") },
  handler: async (ctx, args) => ctx.db.get(args.programId),
});

export const getTemplateInternal = internalQuery({
  args: { templateId: v.id("coiTemplates") },
  handler: async (ctx, args) => ctx.db.get(args.templateId),
});

export const getProgramEmbeddingInternal = internalQuery({
  args: { id: v.id("partnerProgramEmbeddings") },
  handler: async (ctx, args) => ctx.db.get(args.id),
});

export const getActiveTemplateForProgramInternal = internalQuery({
  args: { programId: v.id("partnerPrograms") },
  handler: async (ctx, args) => {
    const program = await ctx.db.get(args.programId);
    if (!program) return null;
    return await activeTemplate(ctx, program);
  },
});

export const upsertProgramEmbeddingInternal = internalMutation({
  args: {
    partnerOrgId: v.id("organizations"),
    programId: v.id("partnerPrograms"),
    matchText: v.string(),
    embedding: v.array(v.float64()),
    status: v.union(v.literal("active"), v.literal("inactive")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("partnerProgramEmbeddings")
      .withIndex("by_programId", (q) => q.eq("programId", args.programId))
      .first();
    const now = dayjs().valueOf();
    const patch = {
      partnerOrgId: args.partnerOrgId,
      programId: args.programId,
      matchText: args.matchText,
      embedding: args.embedding,
      status: args.status,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("partnerProgramEmbeddings", {
      ...patch,
      createdAt: now,
    });
  },
});
