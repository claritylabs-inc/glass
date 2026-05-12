import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/orgAuth";
import {
  assertCanCreatePolicyChange,
  assertCanManagePolicyChange,
  assertCanReadPolicyChange,
  getOrgAccess,
} from "./lib/access";

const caseSourceKindValidator = v.union(
  v.literal("chat"),
  v.literal("email"),
  v.literal("uploaded_document"),
  v.literal("manual"),
);

const caseStatusValidator = v.union(
  v.literal("draft"),
  v.literal("needs_info"),
  v.literal("ready"),
  v.literal("submitted"),
  v.literal("accepted"),
  v.literal("declined"),
);

function summarizeRequest(requestText: string): string {
  const firstLine = requestText.split(/[.\n]/)[0]?.trim();
  return firstLine ? firstLine.slice(0, 160) : "Policy change request";
}

function buildInitialValidation(args: {
  requestText: string;
  evidenceSourceIds?: string[];
}) {
  const issues = [];
  if (!args.requestText.trim()) {
    issues.push({
      code: "request_text_missing",
      severity: "blocking",
      message: "Policy change request text is required.",
    });
  }
  if (/"[^"]+"/.test(args.requestText) && (args.evidenceSourceIds?.length ?? 0) === 0) {
    issues.push({
      code: "quoted_value_missing_source_span",
      severity: "blocking",
      message: "Quoted policy values need linked source-span evidence before submission.",
    });
  }
  return issues;
}

function validationStatus(issues: Array<{ severity?: string }>) {
  if (issues.some((issue) => issue.severity === "blocking")) return "failed" as const;
  if (issues.length > 0) return "warning" as const;
  return "passed" as const;
}

async function insertCaseMessage(ctx: any, args: {
  orgId: any;
  caseId: any;
  direction: "inbound" | "outbound" | "system";
  channel?: "chat" | "email" | "uploaded_document" | "manual";
  content: string;
  sourceSpanIds?: string[];
  createdByUserId?: any;
  createdAt: number;
}) {
  await ctx.db.insert("caseMessages", args);
}

export const createFromChat = mutation({
  args: {
    policyId: v.optional(v.id("policies")),
    requestText: v.string(),
    evidenceSourceIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireOrgAccess(ctx);
    const access = await getOrgAccess(ctx, orgId);
    assertCanCreatePolicyChange(access);
    if (args.policyId) {
      const policy = await ctx.db.get(args.policyId);
      if (!policy || policy.orgId !== orgId) throw new Error("Policy not found");
    }
    const now = Date.now();
    const validationIssues = buildInitialValidation(args);
    const status = validationIssues.length > 0 ? "needs_info" : "draft";
    const caseId = await ctx.db.insert("policyChangeCases", {
      orgId,
      policyId: args.policyId,
      requestText: args.requestText,
      sourceKind: "chat",
      status,
      summary: summarizeRequest(args.requestText),
      validationIssues,
      evidenceSourceIds: args.evidenceSourceIds ?? [],
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });
    await insertCaseMessage(ctx, {
      orgId,
      caseId,
      direction: "inbound",
      channel: "chat",
      content: args.requestText,
      sourceSpanIds: args.evidenceSourceIds,
      createdByUserId: userId,
      createdAt: now,
    });
    await ctx.db.insert("caseValidationReports", {
      orgId,
      caseId,
      status: validationStatus(validationIssues),
      issues: validationIssues,
      createdAt: now,
    });
    return caseId;
  },
});

export const createFromChatInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
    policyId: v.optional(v.id("policies")),
    requestText: v.string(),
    evidenceSourceIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const validationIssues = buildInitialValidation(args);
    const status = validationIssues.length > 0 ? "needs_info" : "draft";
    const caseId = await ctx.db.insert("policyChangeCases", {
      orgId: args.orgId,
      policyId: args.policyId,
      requestText: args.requestText,
      sourceKind: "chat",
      status,
      summary: summarizeRequest(args.requestText),
      validationIssues,
      evidenceSourceIds: args.evidenceSourceIds ?? [],
      createdByUserId: args.userId,
      createdAt: now,
      updatedAt: now,
    });
    await insertCaseMessage(ctx, {
      orgId: args.orgId,
      caseId,
      direction: "inbound",
      channel: "chat",
      content: args.requestText,
      sourceSpanIds: args.evidenceSourceIds,
      createdByUserId: args.userId,
      createdAt: now,
    });
    await ctx.db.insert("caseValidationReports", {
      orgId: args.orgId,
      caseId,
      status: validationStatus(validationIssues),
      issues: validationIssues,
      createdAt: now,
    });
    return caseId;
  },
});

export const createAnalyzedInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
    policyId: v.optional(v.id("policies")),
    requestText: v.string(),
    sourceKind: caseSourceKindValidator,
    summary: v.optional(v.string()),
    items: v.optional(v.any()),
    impacts: v.optional(v.any()),
    missingInfoQuestions: v.optional(v.any()),
    validationIssues: v.optional(v.any()),
    evidenceSourceIds: v.optional(v.array(v.string())),
    packetArtifacts: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const validationIssues = Array.isArray(args.validationIssues)
      ? args.validationIssues
      : buildInitialValidation(args);
    const missingInfo = Array.isArray(args.missingInfoQuestions) ? args.missingInfoQuestions : [];
    const status = validationIssues.some((issue: { severity?: string }) => issue.severity === "blocking") || missingInfo.length > 0
      ? "needs_info"
      : "ready";
    const caseId = await ctx.db.insert("policyChangeCases", {
      orgId: args.orgId,
      policyId: args.policyId,
      requestText: args.requestText,
      sourceKind: args.sourceKind,
      status,
      summary: args.summary ?? summarizeRequest(args.requestText),
      items: args.items,
      impacts: args.impacts,
      missingInfoQuestions: missingInfo,
      validationIssues,
      evidenceSourceIds: args.evidenceSourceIds ?? [],
      createdByUserId: args.userId,
      createdAt: now,
      updatedAt: now,
    });

    await insertCaseMessage(ctx, {
      orgId: args.orgId,
      caseId,
      direction: "inbound",
      channel: args.sourceKind,
      content: args.requestText,
      sourceSpanIds: args.evidenceSourceIds,
      createdByUserId: args.userId,
      createdAt: now,
    });

    for (const item of Array.isArray(args.items) ? args.items : []) {
      for (const sourceSpanId of Array.isArray(item.sourceSpanIds) ? item.sourceSpanIds : []) {
        await ctx.db.insert("caseEvidenceLinks", {
          orgId: args.orgId,
          caseId,
          itemId: typeof item.id === "string" ? item.id : undefined,
          sourceSpanId,
          createdAt: now,
        });
      }
    }

    await ctx.db.insert("caseValidationReports", {
      orgId: args.orgId,
      caseId,
      status: validationStatus(validationIssues),
      issues: validationIssues,
      createdAt: now,
    });

    if (args.packetArtifacts) {
      const packetId = await ctx.db.insert("pcePackets", {
        orgId: args.orgId,
        caseId,
        policyId: args.policyId,
        artifacts: args.packetArtifacts,
        validationIssues,
        createdAt: now,
      });
      await ctx.db.patch(caseId, { packetId });
    }

    return caseId;
  },
});

export const createFromEmail = mutation({
  args: {
    policyId: v.optional(v.id("policies")),
    requestText: v.string(),
    evidenceSourceIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireOrgAccess(ctx);
    const access = await getOrgAccess(ctx, orgId);
    assertCanCreatePolicyChange(access);
    if (args.policyId) {
      const policy = await ctx.db.get(args.policyId);
      if (!policy || policy.orgId !== orgId) throw new Error("Policy not found");
    }
    const now = Date.now();
    const validationIssues = buildInitialValidation(args);
    const caseId = await ctx.db.insert("policyChangeCases", {
      orgId,
      policyId: args.policyId,
      requestText: args.requestText,
      sourceKind: "email",
      status: validationIssues.length > 0 ? "needs_info" : "draft",
      summary: summarizeRequest(args.requestText),
      validationIssues,
      evidenceSourceIds: args.evidenceSourceIds ?? [],
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });
    await insertCaseMessage(ctx, {
      orgId,
      caseId,
      direction: "inbound",
      channel: "email",
      content: args.requestText,
      sourceSpanIds: args.evidenceSourceIds,
      createdByUserId: userId,
      createdAt: now,
    });
    return caseId;
  },
});

export const createFromUploadedDocument = mutation({
  args: {
    policyId: v.optional(v.id("policies")),
    requestText: v.string(),
    evidenceSourceIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireOrgAccess(ctx);
    const access = await getOrgAccess(ctx, orgId);
    assertCanCreatePolicyChange(access);
    if (args.policyId) {
      const policy = await ctx.db.get(args.policyId);
      if (!policy || policy.orgId !== orgId) throw new Error("Policy not found");
    }
    const now = Date.now();
    const validationIssues = buildInitialValidation(args);
    const caseId = await ctx.db.insert("policyChangeCases", {
      orgId,
      policyId: args.policyId,
      requestText: args.requestText,
      sourceKind: "uploaded_document",
      status: validationIssues.length > 0 ? "needs_info" : "draft",
      summary: summarizeRequest(args.requestText),
      validationIssues,
      evidenceSourceIds: args.evidenceSourceIds ?? [],
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });
    await insertCaseMessage(ctx, {
      orgId,
      caseId,
      direction: "inbound",
      channel: "uploaded_document",
      content: args.requestText,
      sourceSpanIds: args.evidenceSourceIds,
      createdByUserId: userId,
      createdAt: now,
    });
    return caseId;
  },
});

export const processReply = mutation({
  args: {
    caseId: v.id("policyChangeCases"),
    replyText: v.string(),
    sourceSpanIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.caseId);
    if (!existing) throw new Error("Policy change case not found");
    const access = await getOrgAccess(ctx, existing.orgId);
    assertCanReadPolicyChange(access);
    const now = Date.now();
    await insertCaseMessage(ctx, {
      orgId: existing.orgId,
      caseId: args.caseId,
      direction: "inbound",
      channel: "manual",
      content: args.replyText,
      sourceSpanIds: args.sourceSpanIds,
      createdByUserId: access.userId,
      createdAt: now,
    });
    await ctx.db.patch(args.caseId, {
      status: "ready",
      updatedAt: now,
    });
  },
});

export const generateCarrierPacket = mutation({
  args: { caseId: v.id("policyChangeCases") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.caseId);
    if (!existing) throw new Error("Policy change case not found");
    const access = await getOrgAccess(ctx, existing.orgId);
    assertCanManagePolicyChange(access);
    const now = Date.now();
    const artifacts = [
      {
        kind: "carrier_email",
        title: "Carrier change request",
        content: `Please process this policy change request:\n\n${existing.requestText}`,
      },
      {
        kind: "validation_report",
        title: "Validation report",
        content: JSON.stringify(existing.validationIssues ?? [], null, 2),
      },
    ];
    const packetId = await ctx.db.insert("pcePackets", {
      orgId: existing.orgId,
      caseId: args.caseId,
      policyId: existing.policyId,
      artifacts,
      validationIssues: existing.validationIssues,
      createdAt: now,
    });
    await ctx.db.patch(args.caseId, {
      packetId,
      status: (existing.validationIssues as Array<{ severity?: string }> | undefined)?.some((issue) => issue.severity === "blocking")
        ? "needs_info"
        : "ready",
      updatedAt: now,
    });
    return packetId;
  },
});

export const markStatus = mutation({
  args: {
    caseId: v.id("policyChangeCases"),
    status: caseStatusValidator,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.caseId);
    if (!existing) throw new Error("Policy change case not found");
    const access = await getOrgAccess(ctx, existing.orgId);
    assertCanManagePolicyChange(access);
    await ctx.db.patch(args.caseId, { status: args.status, updatedAt: Date.now() });
  },
});

export const listByPolicy = query({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy) return [];
    if (!policy.orgId) return [];
    const access = await getOrgAccess(ctx, policy.orgId);
    assertCanReadPolicyChange(access);
    return ctx.db
      .query("policyChangeCases")
      .withIndex("by_policyId", (q) => q.eq("policyId", args.policyId))
      .order("desc")
      .collect();
  },
});

export const getCaseDetail = query({
  args: { caseId: v.id("policyChangeCases") },
  handler: async (ctx, args) => {
    const changeCase = await ctx.db.get(args.caseId);
    if (!changeCase) throw new Error("Policy change case not found");
    const access = await getOrgAccess(ctx, changeCase.orgId);
    assertCanReadPolicyChange(access);

    const [packets, messages, evidenceLinks, validationReports] = await Promise.all([
      ctx.db
        .query("pcePackets")
        .withIndex("by_caseId", (q) => q.eq("caseId", args.caseId))
        .order("desc")
        .collect(),
      ctx.db
        .query("caseMessages")
        .withIndex("by_caseId", (q) => q.eq("caseId", args.caseId))
        .order("desc")
        .collect(),
      ctx.db
        .query("caseEvidenceLinks")
        .withIndex("by_caseId", (q) => q.eq("caseId", args.caseId))
        .collect(),
      ctx.db
        .query("caseValidationReports")
        .withIndex("by_caseId", (q) => q.eq("caseId", args.caseId))
        .order("desc")
        .collect(),
    ]);

    return {
      case: changeCase,
      latestPacket: packets[0] ?? null,
      packets,
      messages,
      evidenceLinks,
      validationReports,
    };
  },
});

export const listByOrg = query({
  args: { status: v.optional(caseStatusValidator) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAccess(ctx);
    if (args.status) {
      return ctx.db
        .query("policyChangeCases")
        .withIndex("by_orgId_status", (q) => q.eq("orgId", orgId).eq("status", args.status!))
        .order("desc")
        .collect();
    }
    return ctx.db
      .query("policyChangeCases")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
  },
});
