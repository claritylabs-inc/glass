"use node";

import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { makeGenerateObject } from "../lib/sdkCallbacks";
import { modelCapabilitiesForTask } from "../lib/modelCatalog";

type SourceSpanDoc = {
  spanId: string;
  documentId?: string;
  pageStart?: number;
  sectionId?: string;
  formNumber?: string;
  text: string;
  metadata?: Record<string, string>;
};

function toEvidenceSource(span: SourceSpanDoc) {
  return {
    id: span.spanId,
    label: span.formNumber ?? span.sectionId ?? "Source span",
    documentId: span.documentId,
    page: span.pageStart,
    fieldPath: span.sectionId,
    text: span.text,
    metadata: span.metadata,
  };
}

async function runSdkPceIfAvailable(params: {
  requestText: string;
  evidenceSources: ReturnType<typeof toEvidenceSource>[];
}) {
  const sdk = await import("@claritylabs/cl-sdk") as Record<string, any>;
  if (typeof sdk.createPceAgent !== "function") return null;

  const agent = sdk.createPceAgent({
    generateObject: makeGenerateObject("analysis"),
    executionMode: "auto",
    modelCapabilities: modelCapabilitiesForTask("analysis"),
  });
  const result = await agent.processChangeRequest({
    requestText: params.requestText,
    evidenceSources: params.evidenceSources,
  });
  const packet = agent.generateSubmissionPacket({ state: result.state });
  return { state: result.state, packet };
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
    const spans = args.policyId
      ? await ctx.runQuery(internal.sourceSpans.listSpansByPolicyInternal, { policyId: args.policyId })
      : [];
    const filteredSpans = args.evidenceSourceIds?.length
      ? spans.filter((span: SourceSpanDoc) => args.evidenceSourceIds!.includes(span.spanId))
      : spans.slice(0, 12);
    const evidenceSources = filteredSpans.map((span: SourceSpanDoc) => toEvidenceSource(span));

    try {
      const sdkResult = await runSdkPceIfAvailable({
        requestText: args.requestText,
        evidenceSources,
      });
      if (sdkResult) {
      const caseId = await ctx.runMutation(internal.policyChanges.createAnalyzedInternal, {
          orgId: args.orgId,
          userId: args.userId,
          policyId: args.policyId,
          requestText: args.requestText,
          sourceKind: args.sourceKind ?? "chat",
          summary: sdkResult.state.summary,
          items: sdkResult.state.items,
          impacts: sdkResult.state.impacts,
          missingInfoQuestions: sdkResult.state.missingInfoQuestions,
          validationIssues: sdkResult.state.validationIssues,
          evidenceSourceIds: sdkResult.state.evidenceSources?.map((source: { id: string }) => source.id) ?? args.evidenceSourceIds,
          packetArtifacts: sdkResult.packet.artifacts,
        });
        return { caseId: String(caseId), usedSdkPce: true };
      }
    } catch (error) {
      console.warn(`SDK PCE action failed; falling back to deterministic case creation: ${error instanceof Error ? error.message : String(error)}`);
    }

    const caseId = args.sourceKind === "email"
      ? await ctx.runMutation(internal.policyChanges.createAnalyzedInternal, {
          orgId: args.orgId,
          userId: args.userId,
          policyId: args.policyId,
          requestText: args.requestText,
          sourceKind: "email",
          evidenceSourceIds: args.evidenceSourceIds,
        })
      : await ctx.runMutation(internal.policyChanges.createFromChatInternal, {
          orgId: args.orgId,
          userId: args.userId,
          policyId: args.policyId,
          requestText: args.requestText,
          evidenceSourceIds: args.evidenceSourceIds,
        });
    return { caseId: String(caseId), usedSdkPce: false };
}
