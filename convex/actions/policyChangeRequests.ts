"use node";

import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  buildBrokerSubmissionFromIdentity,
  missingBrokerRecipientInfo,
} from "../lib/policyChangeBrokerRouting";

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
    operatorInitiatedUserMessageId: v.optional(v.id("threadMessages")),
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
    operatorInitiatedUserMessageId?: Id<"threadMessages">;
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
    const operatorAccess = args.operatorInitiatedUserMessageId
      ? await ctx.runQuery((internal as any).lib.agentScope.validateOperatorInitiatedForAction, {
          orgId: args.orgId,
          userId: args.userId,
          userMessageId: args.operatorInitiatedUserMessageId,
        })
      : null;
    if (operatorAccess?.allowed) {
      return await createPolicyChangeCaseAfterAccess(ctx, args, org);
    }
    return {
      usedSdkPce: false,
      error: createAccess?.error ?? "Policy change requests require direct org membership or broker access",
    };
  }
  return await createPolicyChangeCaseAfterAccess(ctx, args, org);
}

async function createPolicyChangeCaseAfterAccess(
  ctx: any,
  args: {
    orgId: Id<"organizations">;
    userId: Id<"users">;
    policyId?: Id<"policies">;
    requestText: string;
    evidenceSourceIds?: string[];
    sourceKind?: "chat" | "email";
  },
  org: any,
): Promise<{ caseId?: string; usedSdkPce: boolean; error?: string }> {
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
