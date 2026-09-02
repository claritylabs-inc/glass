"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action } from "../_generated/server";
import { generateObjectForOrg } from "../lib/models";
import {
  normalizeProcurementIntake,
  procurementIntakeExtractionSchema,
} from "../lib/procurementIntake";

const internalApi = internal as any;
const EXTRACTION_TIMEOUT_MS = 90_000;

function extractionSource(input: {
  title: string;
  originalNarrative?: string;
  requestSummary: string;
  legacyRequirements: string;
}) {
  const narrative = input.originalNarrative?.trim() || input.requestSummary.trim();
  const legacy = input.legacyRequirements.trim();
  return [
    `Request title: ${input.title}`,
    `Original client narrative:\n${narrative}`,
    legacy && legacy !== narrative ? `Existing unstructured requirements:\n${legacy}` : "",
  ].filter(Boolean).join("\n\n");
}

export const extractDrafts = action({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, args) => {
    const operatorUserId = await getAuthUserId(ctx) as Id<"users"> | null;
    if (!operatorUserId) throw new Error("Authentication required");
    const input = await ctx.runQuery(
      internalApi.procurementRequirements.getIntakeExtractionContextInternal,
      { requestId: args.requestId, operatorUserId },
    );
    const source = extractionSource(input);
    if (!source.trim()) throw new Error("The procurement request has no intake narrative to extract");

    const abortSignal = AbortSignal.timeout(EXTRACTION_TIMEOUT_MS);
    let generated;
    try {
      generated = await generateObjectForOrg(
        ctx,
        input.clientOrgId,
        "requirement_extraction",
        {
          schema: procurementIntakeExtractionSchema,
          abortSignal,
          maxOutputTokens: 8_000,
          system: `Extract two strictly separate groups from the original commercial-insurance intake narrative.

insuranceObligations are coverage, insurer-quality, or insurance-condition obligations that belong in the client's ongoing insurance requirement library after staff confirmation. Examples include limits, deductibles, required forms, additional insured or waiver provisions, carrier rating/admitted requirements, cancellation notice, certificate delivery, and claims-reporting conditions.

placementSpecifications are request-only facts and preferences used to place this risk. Examples include occupancy, operations, revenue/payroll, square footage, property values, construction, protection, locations, vehicles, employee counts, subleasing, desired effective date, and other exposure facts. Never turn these facts into insurance obligations.

Use only explicit source text. Preserve exact monetary values and units. Every item must have a short verbatim sourceExcerpt. Do not infer missing requirements or facts. Reuse the supplied active requirement's semantics when the narrative expresses the same obligation; the server performs the final exact-match decision.`,
          prompt: `${source}\n\nCurrent active client insurance requirements (reference only; do not return one unless the intake narrative states it):\n${JSON.stringify(input.activeRequirements)}`,
        },
      );
    } catch (error) {
      if (abortSignal.aborted) throw new Error("Requirement extraction took too long. Try again.");
      throw error;
    }

    const normalized = normalizeProcurementIntake(generated.object);
    const staged = await ctx.runMutation(
      internalApi.procurementRequirements.stageExtractedDraftsInternal,
      {
        requestId: args.requestId,
        operatorUserId,
        requirements: normalized.requirements,
        specifications: normalized.specifications,
      },
    );
    return {
      draftCount: staged.draftIds.length,
      specificationCount: staged.specificationCount,
    };
  },
});
