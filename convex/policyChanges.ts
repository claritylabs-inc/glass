import { v } from "convex/values";
import dayjs from "dayjs";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  assertCanCreatePolicyChange,
  assertCanDraftPolicyChangeSubmission,
  assertCanManagePolicyChange,
  assertCanReadPolicyChange,
  getPolicyChangeAccessForQuery,
  getPolicyChangeCaseAccessForQuery,
  getOrgAccess,
  requireCurrentOrgAccess,
} from "./lib/access";
import { notify } from "./lib/notify";
import { declarationFactHash, extractDeclarationFactsFromPolicy } from "./lib/declarationFacts";
import { resolveBrokerIdentityForClient } from "./lib/brokerIdentity";
import type { Doc, Id } from "./_generated/dataModel";

const caseSourceKindValidator = v.union(
  v.literal("chat"),
  v.literal("email"),
  v.literal("imessage"),
  v.literal("mcp"),
  v.literal("cli"),
  v.literal("uploaded_document"),
  v.literal("manual"),
);

const caseStatusValidator = v.union(
  // Legacy statuses kept during the widened migration window.
  v.literal("draft"),
  v.literal("ready"),
  v.literal("accepted"),
  v.literal("needs_info"),
  v.literal("submitted"),
  v.literal("declined"),
  v.literal("cancelled"),
  // Current lightweight case workflow.
  v.literal("intake"),
  v.literal("ready_to_submit"),
  v.literal("waiting_for_endorsement"),
  v.literal("completed"),
);

type PolicyChangeStatus =
  | "draft"
  | "ready"
  | "accepted"
  | "needs_info"
  | "submitted"
  | "declined"
  | "cancelled"
  | "intake"
  | "ready_to_submit"
  | "waiting_for_endorsement"
  | "completed";

function nowMs(): number {
  return dayjs().valueOf();
}

function normalizeCaseStatus(status: PolicyChangeStatus | undefined): PolicyChangeStatus {
  if (status === "draft") return "intake";
  if (status === "ready") return "ready_to_submit";
  if (status === "accepted") return "completed";
  return status ?? "intake";
}

function summarizeRequest(requestText: string): string {
  const firstLine = requestText.split(/[.\n]/)[0]?.trim();
  return firstLine ? firstLine.slice(0, 160) : "Policy change request";
}

function pendingQuestionsFromMissingInfo(missingInfo: unknown): string[] {
  if (!Array.isArray(missingInfo)) return [];
  return missingInfo
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "question" in item) {
        const question = (item as { question?: unknown }).question;
        return typeof question === "string" ? question : undefined;
      }
      return undefined;
    })
    .filter((item): item is string => !!item?.trim());
}

type MissingInfoQuestion = {
  code: string;
  question: string;
  reason: string;
};

function normalizeMissingInfoQuestions(missingInfo: unknown): unknown[] {
  return Array.isArray(missingInfo) ? missingInfo : [];
}

function hasMissingBrokerRecipient(missingInfo: unknown[]): boolean {
  return missingInfo.some((item) => {
    if (item && typeof item === "object" && "code" in item) {
      return (item as { code?: unknown }).code === "broker_contact_required";
    }
    return false;
  });
}

function brokerRecipientQuestion(): MissingInfoQuestion {
  return {
    code: "broker_contact_required",
    question: "Which broker email or contact should receive this policy change request?",
    reason: "Policy change emails are broker-mediated and need an explicit broker recipient before Glass can draft or send one.",
  };
}

function withBrokerRecipientQuestion(missingInfo: unknown[], brokerSubmission: unknown): unknown[] {
  if (
    brokerSubmission &&
    typeof brokerSubmission === "object" &&
    (brokerSubmission as { needsRecipient?: unknown }).needsRecipient === true &&
    !hasMissingBrokerRecipient(missingInfo)
  ) {
    return [...missingInfo, brokerRecipientQuestion()];
  }
  return missingInfo;
}

async function buildInitialBrokerSubmission(
  ctx: any,
  org: Doc<"organizations">,
) {
  if ((org.type ?? "client") !== "client") return undefined;
  const identity = await resolveBrokerIdentityForClient(ctx, org);
  const recipientEmail = identity.contactEmail?.trim();
  const recipientName = identity.contactName ?? identity.brokerCompanyName;
  const routingStatus = recipientEmail
    ? "recipient_ready"
    : identity.source === "none"
      ? "needs_broker_contact"
      : "needs_broker_recipient";

  return {
    routingStatus,
    source: identity.source,
    brokerOrgId: identity.brokerOrgId,
    brokerCompanyName: identity.brokerCompanyName,
    recipientEmail: recipientEmail || undefined,
    recipientName,
    contactPhone: identity.contactPhone,
    needsRecipient: !recipientEmail,
  };
}

async function notifyIfNeedsInfo(ctx: any, args: {
  orgId: any;
  caseId: any;
  policyId?: any;
  summary?: string;
  pendingQuestions?: string[];
}) {
  if (!args.pendingQuestions || args.pendingQuestions.length === 0) return;
  await notify(ctx, {
    orgId: args.orgId,
    type: "policy_change_needs_info",
    title: "Policy change needs more information",
    body: args.pendingQuestions[0] ?? "Glass needs more information to continue this policy change request.",
    actionType: args.policyId ? "view_policy" : undefined,
    actionPayload: args.policyId ? { policyId: args.policyId, tab: "changes" } : undefined,
    sourceRef: { caseId: args.caseId, policyId: args.policyId },
    coalesceKeyParts: ["policy_change_needs_info", String(args.orgId), String(args.caseId)],
  });
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
      message: "Quoted policy values need linked source-span evidence before the email is sent.",
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
  channel?: "chat" | "email" | "imessage" | "mcp" | "cli" | "uploaded_document" | "manual";
  content: string;
  sourceSpanIds?: string[];
  createdByUserId?: Id<"users">;
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
    const access = await requireCurrentOrgAccess(ctx);
    const { orgId, userId } = access;
    assertCanCreatePolicyChange(access);
    if (args.policyId) {
      const policy = await ctx.db.get(args.policyId);
      if (!policy || policy.orgId !== orgId) throw new Error("Policy not found");
    }
    const now = nowMs();
    const brokerSubmission = await buildInitialBrokerSubmission(ctx, access.org);
    const validationIssues = buildInitialValidation(args);
    const missingInfo = withBrokerRecipientQuestion([], brokerSubmission);
    const pendingQuestions = pendingQuestionsFromMissingInfo(missingInfo);
    const status = validationIssues.length > 0 || pendingQuestions.length > 0 ? "needs_info" : "intake";
    const caseId = await ctx.db.insert("policyChangeCases", {
      orgId,
      policyId: args.policyId,
      affectedPolicyIds: args.policyId ? [args.policyId] : [],
      requestText: args.requestText,
      sourceKind: "chat",
      status,
      summary: summarizeRequest(args.requestText),
      pendingQuestions,
      brokerSubmission,
      missingInfoQuestions: missingInfo,
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
    await notifyIfNeedsInfo(ctx, {
      orgId,
      caseId,
      policyId: args.policyId,
      pendingQuestions,
    });
    return caseId;
  },
});

export const canCreatePolicyChangeForUserInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) return { allowed: false, error: "Organization not found" };

    const orgType = (org.type as "broker" | "client" | "partner" | undefined) ?? "client";
    const directMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", args.orgId).eq("userId", args.userId),
      )
      .first();
    if (directMembership && (orgType === "client" || orgType === "broker")) {
      return { allowed: true };
    }

    if (orgType === "client" && org.brokerOrgId) {
      const brokerMembership = await ctx.db
        .query("orgMemberships")
        .withIndex("by_orgId_userId", (q) =>
          q.eq("orgId", org.brokerOrgId!).eq("userId", args.userId),
        )
        .first();
      if (brokerMembership) return { allowed: true };
    }

    return {
      allowed: false,
      error: "Policy change requests require direct org membership or broker access",
    };
  },
});

export const getInternal = internalQuery({
  args: { caseId: v.id("policyChangeCases") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.caseId);
  },
});

export const createFromChatInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
    policyId: v.optional(v.id("policies")),
    requestText: v.string(),
    sourceKind: v.optional(caseSourceKindValidator),
    evidenceSourceIds: v.optional(v.array(v.string())),
    missingInfoQuestions: v.optional(v.any()),
    brokerSubmission: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = nowMs();
    const validationIssues = buildInitialValidation(args);
    const missingInfo = withBrokerRecipientQuestion(
      normalizeMissingInfoQuestions(args.missingInfoQuestions),
      args.brokerSubmission,
    );
    const pendingQuestions = pendingQuestionsFromMissingInfo(missingInfo);
    const status = validationIssues.length > 0 || pendingQuestions.length > 0 ? "needs_info" : "intake";
    const caseId = await ctx.db.insert("policyChangeCases", {
      orgId: args.orgId,
      policyId: args.policyId,
      affectedPolicyIds: args.policyId ? [args.policyId] : [],
      requestText: args.requestText,
      sourceKind: args.sourceKind ?? "chat",
      status,
      summary: summarizeRequest(args.requestText),
      pendingQuestions,
      brokerSubmission: args.brokerSubmission,
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
      channel: args.sourceKind ?? "chat",
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
    await notifyIfNeedsInfo(ctx, {
      orgId: args.orgId,
      caseId,
      policyId: args.policyId,
      pendingQuestions,
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
    brokerSubmission: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = nowMs();
    const validationIssues = Array.isArray(args.validationIssues)
      ? args.validationIssues
      : buildInitialValidation(args);
    const missingInfo = withBrokerRecipientQuestion(
      normalizeMissingInfoQuestions(args.missingInfoQuestions),
      args.brokerSubmission,
    );
    const status = validationIssues.some((issue: { severity?: string }) => issue.severity === "blocking") || missingInfo.length > 0
      ? "needs_info"
      : "ready_to_submit";
    const pendingQuestions = pendingQuestionsFromMissingInfo(missingInfo);
    const caseId = await ctx.db.insert("policyChangeCases", {
      orgId: args.orgId,
      policyId: args.policyId,
      affectedPolicyIds: args.policyId ? [args.policyId] : [],
      requestText: args.requestText,
      sourceKind: args.sourceKind,
      status,
      summary: args.summary ?? summarizeRequest(args.requestText),
      pendingQuestions,
      brokerSubmission: args.brokerSubmission,
      internalPceAnalysis: {
        items: args.items,
        impacts: args.impacts,
        missingInfoQuestions: missingInfo,
        validationIssues,
      },
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

    await notifyIfNeedsInfo(ctx, {
      orgId: args.orgId,
      caseId,
      policyId: args.policyId,
      summary: args.summary,
      pendingQuestions,
    });

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
    const access = await requireCurrentOrgAccess(ctx);
    const { orgId, userId } = access;
    assertCanCreatePolicyChange(access);
    if (args.policyId) {
      const policy = await ctx.db.get(args.policyId);
      if (!policy || policy.orgId !== orgId) throw new Error("Policy not found");
    }
    const now = nowMs();
    const brokerSubmission = await buildInitialBrokerSubmission(ctx, access.org);
    const validationIssues = buildInitialValidation(args);
    const missingInfo = withBrokerRecipientQuestion([], brokerSubmission);
    const pendingQuestions = pendingQuestionsFromMissingInfo(missingInfo);
    const caseId = await ctx.db.insert("policyChangeCases", {
      orgId,
      policyId: args.policyId,
      affectedPolicyIds: args.policyId ? [args.policyId] : [],
      requestText: args.requestText,
      sourceKind: "email",
      status: validationIssues.length > 0 || pendingQuestions.length > 0 ? "needs_info" : "intake",
      summary: summarizeRequest(args.requestText),
      pendingQuestions,
      brokerSubmission,
      missingInfoQuestions: missingInfo,
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
    await notifyIfNeedsInfo(ctx, {
      orgId,
      caseId,
      policyId: args.policyId,
      pendingQuestions,
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
    const access = await requireCurrentOrgAccess(ctx);
    const { orgId, userId } = access;
    assertCanCreatePolicyChange(access);
    if (args.policyId) {
      const policy = await ctx.db.get(args.policyId);
      if (!policy || policy.orgId !== orgId) throw new Error("Policy not found");
    }
    const now = nowMs();
    const brokerSubmission = await buildInitialBrokerSubmission(ctx, access.org);
    const validationIssues = buildInitialValidation(args);
    const missingInfo = withBrokerRecipientQuestion([], brokerSubmission);
    const pendingQuestions = pendingQuestionsFromMissingInfo(missingInfo);
    const caseId = await ctx.db.insert("policyChangeCases", {
      orgId,
      policyId: args.policyId,
      affectedPolicyIds: args.policyId ? [args.policyId] : [],
      requestText: args.requestText,
      sourceKind: "uploaded_document",
      status: validationIssues.length > 0 || pendingQuestions.length > 0 ? "needs_info" : "intake",
      summary: summarizeRequest(args.requestText),
      pendingQuestions,
      brokerSubmission,
      missingInfoQuestions: missingInfo,
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
    await notifyIfNeedsInfo(ctx, {
      orgId,
      caseId,
      policyId: args.policyId,
      pendingQuestions,
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
    const now = nowMs();
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
      status: "ready_to_submit",
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
    assertCanDraftPolicyChangeSubmission(access);
    const now = nowMs();
    const artifacts = [
      {
        kind: "broker_request_packet",
        title: "Broker change request",
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
        : "ready_to_submit",
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
    await ctx.db.patch(args.caseId, {
      status: normalizeCaseStatus(args.status as PolicyChangeStatus),
      updatedAt: nowMs(),
    });
  },
});

export const cancelRequest = mutation({
  args: { caseId: v.id("policyChangeCases") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.caseId);
    if (!existing) throw new Error("Policy change case not found");
    const access = await getOrgAccess(ctx, existing.orgId);
    assertCanReadPolicyChange(access);

    const normalizedStatus = normalizeCaseStatus(existing.status as PolicyChangeStatus);
    if (normalizedStatus === "completed" || normalizedStatus === "declined") {
      throw new Error("Completed policy change requests cannot be cancelled");
    }
    if (normalizedStatus === "cancelled") return;

    const now = nowMs();
    await ctx.db.patch(args.caseId, { status: "cancelled", updatedAt: now });
    await insertCaseMessage(ctx, {
      orgId: existing.orgId,
      caseId: args.caseId,
      direction: "system",
      channel: "manual",
      content: "Policy change request cancelled.",
      createdByUserId: access.userId,
      createdAt: now,
    });
  },
});

export const addInfo = internalMutation({
  args: {
    caseId: v.id("policyChangeCases"),
    userId: v.optional(v.id("users")),
    infoText: v.string(),
    sourceSpanIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.caseId);
    if (!existing) throw new Error("Policy change case not found");

    const now = nowMs();
    await insertCaseMessage(ctx, {
      orgId: existing.orgId,
      caseId: args.caseId,
      direction: "inbound",
      channel: "manual",
      content: args.infoText,
      sourceSpanIds: args.sourceSpanIds,
      createdByUserId: args.userId,
      createdAt: now,
    });

    const nextPendingQuestions = Array.isArray(existing.pendingQuestions)
      ? existing.pendingQuestions.slice(1)
      : [];
    const nextStatus =
      nextPendingQuestions.length > 0
        ? "needs_info"
        : normalizeCaseStatus(existing.status as PolicyChangeStatus) === "needs_info"
          ? "ready_to_submit"
          : normalizeCaseStatus(existing.status as PolicyChangeStatus);

    await ctx.db.patch(args.caseId, {
      pendingQuestions: nextPendingQuestions,
      status: nextStatus,
      updatedAt: now,
    });
  },
});

export const draftSubmission = internalMutation({
  args: {
    caseId: v.id("policyChangeCases"),
    userId: v.optional(v.id("users")),
    recipientEmail: v.optional(v.string()),
    recipientName: v.optional(v.string()),
    instructions: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.caseId);
    if (!existing) throw new Error("Policy change case not found");

    const now = nowMs();
    const existingSubmission =
      existing.brokerSubmission &&
      typeof existing.brokerSubmission === "object" &&
      !Array.isArray(existing.brokerSubmission)
        ? (existing.brokerSubmission as Record<string, unknown>)
        : {};
    const recipientEmail =
      args.recipientEmail?.trim() ||
      (typeof existingSubmission.recipientEmail === "string"
        ? existingSubmission.recipientEmail.trim()
        : "");
    const recipientName =
      args.recipientName?.trim() ||
      (typeof existingSubmission.recipientName === "string"
        ? existingSubmission.recipientName.trim()
        : undefined);
    const body = [
      "Please process this policy change request:",
      "",
      existing.summary || summarizeRequest(existing.requestText),
      "",
      existing.requestText,
      args.instructions?.trim() ? `\nNotes:\n${args.instructions.trim()}` : "",
    ].filter(Boolean).join("\n");
    const brokerSubmission = {
      ...existingSubmission,
      recipientEmail: recipientEmail || undefined,
      recipientName,
      subject: `Policy change request${existing.policyId ? ` for ${String(existing.policyId)}` : ""}`,
      body,
      draftedAt: now,
      draftedByUserId: args.userId,
      needsRecipient: !recipientEmail,
      routingStatus: recipientEmail ? "recipient_ready" : "needs_broker_contact",
    };
    const existingQuestions = Array.isArray(existing.pendingQuestions)
      ? existing.pendingQuestions
      : [];
    const recipientQuestion = "Which broker email or contact should receive this policy change request?";

    await ctx.db.patch(args.caseId, {
      brokerSubmission,
      status: recipientEmail ? "ready_to_submit" : "needs_info",
      pendingQuestions: recipientEmail
        ? existingQuestions.filter((question) => question !== recipientQuestion)
        : [...new Set([...existingQuestions, recipientQuestion])],
      updatedAt: now,
    });
    await insertCaseMessage(ctx, {
      orgId: existing.orgId,
      caseId: args.caseId,
      direction: "system",
      channel: "manual",
      content: recipientEmail
        ? `Drafted broker email to ${recipientEmail}.`
        : "Drafted broker email, but a recipient is still required.",
      createdByUserId: args.userId,
      createdAt: now,
    });
    return brokerSubmission;
  },
});

export const markBrokerEmailSentInternal = internalMutation({
  args: {
    caseId: v.id("policyChangeCases"),
    userId: v.optional(v.id("users")),
    recipientEmail: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.caseId);
    if (!existing) return;
    const now = nowMs();
    await insertCaseMessage(ctx, {
      orgId: existing.orgId,
      caseId: args.caseId,
      direction: "outbound",
      channel: "email",
      content: `Sent broker email to ${args.recipientEmail}.\n\n${args.content}`,
      createdByUserId: args.userId,
      createdAt: now,
    });
    await ctx.db.patch(args.caseId, {
      status: "waiting_for_endorsement",
      updatedAt: now,
    });
  },
});

export const recordBrokerEmailReplyInternal = internalMutation({
  args: {
    caseId: v.id("policyChangeCases"),
    userId: v.optional(v.id("users")),
    fromEmail: v.string(),
    subject: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.caseId);
    if (!existing) return;
    const now = nowMs();
    await insertCaseMessage(ctx, {
      orgId: existing.orgId,
      caseId: args.caseId,
      direction: "inbound",
      channel: "email",
      content: `Broker email reply from ${args.fromEmail}.\nSubject: ${args.subject}\n\n${args.content}`,
      createdByUserId: args.userId,
      createdAt: now,
    });
    await ctx.db.patch(args.caseId, {
      updatedAt: now,
    });
  },
});

function snapshotPolicy(policy: Record<string, unknown>) {
  const keys = [
    "carrier",
    "security",
    "mga",
    "broker",
    "policyNumber",
    "policyTypes",
    "effectiveDate",
    "expirationDate",
    "insuredName",
    "premium",
    "totalCost",
    "summary",
    "coverages",
    "declarations",
    "document",
    "files",
  ];
  return Object.fromEntries(keys.map((key) => [key, policy[key]]));
}

function buildFieldDiffs(before: Record<string, unknown>, updates: Record<string, unknown>) {
  return Object.entries(updates)
    .filter(([, after]) => after !== undefined)
    .map(([fieldPath, after]) => ({
      fieldPath,
      before: before[fieldPath],
      after,
    }));
}

export const completeFromEndorsement = internalMutation({
  args: {
    caseId: v.optional(v.id("policyChangeCases")),
    userId: v.id("users"),
    policyId: v.id("policies"),
    files: v.array(v.object({
      fileId: v.id("_storage"),
      fileName: v.string(),
    })),
    summary: v.optional(v.string()),
    fieldUpdates: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy?.orgId) throw new Error("Policy not found");

    if (args.caseId) {
      const changeCase = await ctx.db.get(args.caseId);
      if (!changeCase || changeCase.orgId !== policy.orgId) {
        throw new Error("Policy change case not found");
      }
    }

    const now = nowMs();
    const policyFileIds = [];
    for (const file of args.files) {
      const policyFileId = await ctx.db.insert("policyFiles", {
        policyId: args.policyId,
        fileId: file.fileId,
        fileName: file.fileName,
        fileType: "endorsement",
        orgId: policy.orgId,
        pipelineStatus: "idle",
        createdAt: now,
      });
      policyFileIds.push(policyFileId);
    }

    const fieldUpdates = args.fieldUpdates && typeof args.fieldUpdates === "object"
      ? args.fieldUpdates as Record<string, unknown>
      : {};
    const beforeSnapshot = snapshotPolicy(policy as unknown as Record<string, unknown>);
    const fieldDiffs = buildFieldDiffs(beforeSnapshot, fieldUpdates);
    const existingFiles = Array.isArray(policy.files) ? policy.files : [];
    const appendedFiles = args.files.map((file) => ({
      fileId: file.fileId,
      fileName: file.fileName,
      fileType: "endorsement",
      status: "complete",
    }));

    await ctx.db.patch(args.policyId, {
      ...fieldUpdates,
      files: [...existingFiles, ...appendedFiles],
      reconciliationStatus: fieldDiffs.length > 0 ? "reconciled" : policy.reconciliationStatus,
    });
    const updatedPolicy = await ctx.db.get(args.policyId);
    const afterSnapshot = updatedPolicy
      ? snapshotPolicy(updatedPolicy as unknown as Record<string, unknown>)
      : undefined;
    if (updatedPolicy) {
      const existingFacts = await ctx.db
        .query("policyDeclarationFacts")
        .withIndex("by_policyId_active", (q) => q.eq("policyId", args.policyId).eq("active", true))
        .collect();
      for (const fact of existingFacts) {
        await ctx.db.patch(fact._id, { active: false });
      }
      const facts = extractDeclarationFactsFromPolicy(updatedPolicy as unknown as Record<string, unknown>);
      for (const fact of facts) {
        await ctx.db.insert("policyDeclarationFacts", {
          orgId: policy.orgId,
          policyId: args.policyId,
          fieldPath: fact.fieldPath,
          fieldGroup: fact.fieldGroup,
          displayValue: fact.displayValue,
          normalizedValue: fact.normalizedValue,
          valueKind: fact.valueKind,
          sourceSpanIds: fact.sourceSpanIds,
          effectiveDate: fact.effectiveDate,
          expirationDate: fact.expirationDate,
          observedAt: now,
          active: true,
          recordHash: declarationFactHash({
            policyId: String(args.policyId),
            fieldPath: fact.fieldPath,
            normalizedValue: fact.normalizedValue,
          }),
        });
      }
    }

    const runId = await ctx.db.insert("policyUpdateRuns", {
      orgId: policy.orgId,
      policyId: args.policyId,
      caseId: args.caseId,
      sourcePolicyFileIds: policyFileIds,
      sourceFileIds: args.files.map((file) => file.fileId),
      updateMode: "append_to_existing",
      status: "complete",
      beforeSnapshot,
      afterSnapshot,
      fieldDiffs,
      summary: args.summary,
      createdByUserId: args.userId,
      createdAt: now,
      updatedAt: now,
    });

    if (args.caseId) {
      await ctx.db.patch(args.caseId, {
        status: "completed",
        completion: {
          summary: args.summary ?? "Endorsement received and appended to the policy.",
          policyId: args.policyId,
          policyUpdateRunId: runId,
          policyFileIds,
          completedAt: now,
          completedByUserId: args.userId,
        },
        updatedAt: now,
      });
      await insertCaseMessage(ctx, {
        orgId: policy.orgId,
        caseId: args.caseId,
        direction: "system",
        channel: "manual",
        content: args.summary ?? "Endorsement received and appended to the policy.",
        createdByUserId: args.userId,
        createdAt: now,
      });
      const holds = await ctx.db
        .query("certificateRequestHolds")
        .withIndex("by_policyChangeCaseId", (q) =>
          q.eq("policyChangeCaseId", args.caseId!),
        )
        .collect();
      for (const hold of holds) {
        await ctx.db.patch(hold._id, { status: "resolved", updatedAt: now });
      }
      await ctx.runMutation(internal.certificates.createPostEndorsementReviewJobsInternal, {
        policyChangeCaseId: args.caseId,
        policyUpdateRunId: runId,
        createdByUserId: args.userId,
      });
    }

    await ctx.db.insert("policyAuditLog", {
      policyId: args.policyId,
      userId: args.userId,
      orgId: policy.orgId,
      action: "endorsement_appended",
      detail: args.summary ?? "Appended endorsement file to existing policy",
      metadata: {
        caseId: args.caseId,
        policyUpdateRunId: runId,
        policyFileIds,
        fieldDiffs,
      },
    });

    await notify(ctx, {
      orgId: policy.orgId,
      type: "policy_change_completed",
      title: "Policy change completed",
      body: args.summary ?? "An endorsement was added to the policy and the change request was marked complete.",
      actionType: "view_policy",
      actionPayload: { policyId: args.policyId, caseId: args.caseId },
      sourceRef: { policyId: args.policyId, caseId: args.caseId, policyUpdateRunId: runId },
      coalesceKeyParts: ["policy_change_completed", String(policy.orgId), String(args.caseId ?? runId)],
    });

    for (const policyFileId of policyFileIds) {
      await ctx.runMutation((internal as any).policyDelivery.enqueueInternal, {
        policyId: args.policyId,
        policyFileId,
        sourceKind: "endorsement",
      });
    }

    return { policyUpdateRunId: runId, policyFileIds };
  },
});

export const listByPolicy = query({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const policyAccess = await getPolicyChangeAccessForQuery(ctx, args.policyId);
    if (!policyAccess) return [];
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
    const caseAccess = await getPolicyChangeCaseAccessForQuery(ctx, args.caseId);
    if (!caseAccess) return null;
    const { changeCase } = caseAccess;

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
