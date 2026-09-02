"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { generateObjectForOrg } from "../lib/models";
import {
  normalizeProposalReview,
  proposalReviewSchema,
} from "../lib/proposalReview";

const internalApi = internal as any;
const REVIEW_TIMEOUT_MS = 120_000;

function compact(value: unknown) {
  return JSON.stringify(
    value,
    (_key, item) => {
      if (typeof item === "string" && item.length > 4000)
        return `${item.slice(0, 4000)}…`;
      return item;
    },
    2,
  ).slice(0, 180_000);
}

export const generateReview = action({
  args: { proposalId: v.id("procurementProposals") },
  handler: async (ctx, args) => {
    const operatorUserId = await getAuthUserId(ctx);
    if (!operatorUserId) throw new Error("Authentication required");
    await ctx.runQuery(internalApi.operator.requireOperatorForUserInternal, {
      userId: operatorUserId as Id<"users">,
    });
    const input = await ctx.runQuery(
      internalApi.procurementProposals.getReviewInputInternal,
      { proposalId: args.proposalId },
    );
    if (!input) throw new Error("Proposal extraction is not ready for review");

    const abortSignal = AbortSignal.timeout(REVIEW_TIMEOUT_MS);
    let generated;
    try {
      generated = await generateObjectForOrg(
        ctx,
        input.clientOrgId,
        "analysis",
        {
          schema: proposalReviewSchema,
          abortSignal,
          maxOutputTokens: 8_000,
          system: `You are a careful commercial-insurance proposal reviewer. Compare a private broker proposal only with the supplied confirmed insurance requirements and request-scoped specifications. Use only the supplied extracted offer and its source references. Never invent a carrier term, limit, deductible, premium, condition, exclusion, source node, source span, page, or document ID.

Return exactly one finding for every supplied requirement and specification. A finding is "meets" only when cited proposal evidence clearly satisfies it, "has_gap" when cited evidence clearly conflicts with or falls short of it, and "insufficient_evidence" when the proposal does not establish an answer. The overall conclusion is meets_requirements only when every item meets, has_gaps when at least one item has a supported gap, and insufficient_evidence otherwise.`,
          prompt: `Review this proposal snapshot.

Requirements and specifications are authoritative only for this review revision. Evidence references must be copied exactly from extractedOffer.evidence or an item's evidence array.

${compact({
  extractedOffer: input.extractedOffer,
  requirements: input.requirements,
  specifications: input.specifications,
})}`,
        },
      );
    } catch (error) {
      if (abortSignal.aborted)
        throw new Error("Proposal review took too long. Try again.");
      throw error;
    }
    const review = normalizeProposalReview(generated.object, {
      requirementIds: input.requirements.map((requirement: { _id: string }) =>
        String(requirement._id),
      ),
      specificationIds: input.specifications.map(
        (specification: { _id: string }) => String(specification._id),
      ),
      extractedOffer: input.extractedOffer,
    });
    const saved = await ctx.runMutation(
      internalApi.procurementProposals.saveGeneratedReviewInternal,
      {
        operatorUserId,
        proposalId: input.proposalId,
        extractionFingerprint: input.extractionFingerprint,
        requirementRevision: input.requirementRevision,
        specificationRevision: input.specificationRevision,
        findings: review.findings,
        conclusion: review.conclusion,
      },
    );
    return {
      ...saved,
      conclusion: review.conclusion,
      findingCount: review.findings.length,
    };
  },
});
