"use node";

import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

function brokerRecipientQuestion() {
  return {
    code: "broker_contact_required",
    question: "Which broker email or contact should receive this policy change request?",
    reason: "Policy change emails are broker-mediated and need an explicit broker recipient before Glass can draft or send one.",
  };
}

function buildBrokerSubmissionFromIdentity(identity: any | null) {
  if (!identity || !identity.clientOrgId) return undefined;
  const recipientEmail = typeof identity.contactEmail === "string"
    ? identity.contactEmail.trim()
    : "";
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

function missingBrokerRecipientInfo(brokerSubmission: any | undefined) {
  return brokerSubmission?.needsRecipient ? [brokerRecipientQuestion()] : [];
}

export const createFromChat = action({
  args: {
    policyId: v.optional(v.id("policies")),
    requestText: v.string(),
    evidenceSourceIds: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<{ caseId?: string; usedSdkPce: boolean; error?: string }> => {
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) return { usedSdkPce: false, error: "Not authenticated" };

    const policy = args.policyId ? await ctx.runQuery(api.policies.get, { id: args.policyId }) : null;
    if (args.policyId && !policy) return { usedSdkPce: false, error: "Policy not found" };

    const viewerOrg = await ctx.runQuery(api.orgs.viewerOrg, {});
    const orgId = (policy?.orgId ?? viewerOrg?.org?._id) as Id<"organizations"> | undefined;
    if (!orgId) return { usedSdkPce: false, error: "Organization not found" };

    return createPolicyChangeCase(ctx, {
      orgId,
      userId: viewer._id,
      policyId: args.policyId,
      requestText: args.requestText,
      evidenceSourceIds: args.evidenceSourceIds,
    });
  },
});

export const createFromChatForThread = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    policyId: v.optional(v.id("policies")),
    requestText: v.string(),
    evidenceSourceIds: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<{ caseId?: string; usedSdkPce: boolean; error?: string }> => {
    return createPolicyChangeCase(ctx, args);
  },
});

export const createFromEmailForThread = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    policyId: v.optional(v.id("policies")),
    requestText: v.string(),
    evidenceSourceIds: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<{ caseId?: string; usedSdkPce: boolean; error?: string }> => {
    return createPolicyChangeCase(ctx, { ...args, sourceKind: "email" });
  },
});

async function createPolicyChangeCase(
  ctx: any,
  args: {
    orgId: Id<"organizations">;
    userId: Id<"users">;
    policyId?: Id<"policies">;
    requestText: string;
    evidenceSourceIds?: string[];
    sourceKind?: "chat" | "email";
  },
): Promise<{ caseId?: string; usedSdkPce: boolean; error?: string }> {
    const org = await ctx.runQuery(internal.orgs.getInternal, { id: args.orgId });
    if (!org) return { usedSdkPce: false, error: "Organization not found" };
    const createAccess = await ctx.runQuery(
      internal.policyChanges.canCreatePolicyChangeForUserInternal,
      {
        orgId: args.orgId,
        userId: args.userId,
      },
    );
    if (!createAccess?.allowed) {
      return {
        usedSdkPce: false,
        error: createAccess?.error ?? "Policy change requests require direct org membership or broker access",
      };
    }
    const brokerIdentity = (org.type ?? "client") === "client"
      ? await ctx.runQuery(internal.orgs.resolveBrokerIdentityInternal, {
          clientOrgId: args.orgId,
        })
      : null;
    const brokerSubmission = buildBrokerSubmissionFromIdentity(brokerIdentity);
    const brokerMissingInfo = missingBrokerRecipientInfo(brokerSubmission);
    if (args.policyId) {
      const policy = await ctx.runQuery(internal.policies.getInternal, { id: args.policyId });
      if (!policy || policy.orgId !== args.orgId) {
        return { usedSdkPce: false, error: "Policy not found" };
      }
    }

    const caseId = await ctx.runMutation(internal.policyChanges.createFromChatInternal, {
      orgId: args.orgId,
      userId: args.userId,
      policyId: args.policyId,
      requestText: args.requestText,
      sourceKind: args.sourceKind ?? "chat",
      evidenceSourceIds: args.evidenceSourceIds,
      missingInfoQuestions: brokerMissingInfo,
      brokerSubmission,
    });
    if (args.policyId) {
      const partner = await ctx.runQuery(internal.partnerPrograms.resolvePolicyPartner, {
        policyId: args.policyId,
      });
      if (partner?.partnerOrgId) {
        await ctx.runMutation(internal.partnerPrograms.markPolicyChangePendingPartnerInternal, {
          caseId,
          partnerOrgId: partner.partnerOrgId,
          partnerProgramId: partner.partnerProgramId,
        });
      }
    }
    return { caseId: String(caseId), usedSdkPce: false };
}
