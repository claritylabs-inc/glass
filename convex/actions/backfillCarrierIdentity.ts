"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import {
  carrierIdentityBackfillSkipReason,
  rebuildCarrierIdentityFromStoredSources,
  type CarrierIdentityBackfillResult,
} from "../lib/carrierIdentityBackfill";

type EvidencePage = {
  page: Array<Record<string, unknown>>;
  continueCursor: string;
  isDone: boolean;
};

async function readAllSourceSpans(
  ctx: ActionCtx,
  policyId: Id<"policies">,
) {
  const sourceSpans: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  while (true) {
    const result: EvidencePage = await ctx.runQuery(
      internal.carrierIdentityBackfill.listSourceSpansPageInternal,
      { policyId, cursor },
    );
    sourceSpans.push(...result.page);
    if (result.isDone) return sourceSpans;
    cursor = result.continueCursor;
  }
}

async function readAllSourceNodes(
  ctx: ActionCtx,
  policyId: Id<"policies">,
) {
  const sourceNodes: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  while (true) {
    const result: EvidencePage = await ctx.runQuery(
      internal.carrierIdentityBackfill.listSourceNodesPageInternal,
      { policyId, cursor },
    );
    sourceNodes.push(...result.page);
    if (result.isDone) return sourceNodes;
    cursor = result.continueCursor;
  }
}

function serializeResult(result: CarrierIdentityBackfillResult) {
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const [key, value] of Object.entries(result.patch ?? {})) {
    if (value === undefined) unset.push(key);
    else set[key] = value;
  }
  return {
    outcome: result.outcome,
    ...(result.reason ? { reason: result.reason } : {}),
    shouldEnrich: result.shouldEnrich,
    set,
    unset,
  };
}

export const rebuildOne = internalAction({
  args: {
    policyId: v.id("policies"),
  },
  handler: async (ctx, args) => {
    const snapshot = await ctx.runQuery(
      internal.carrierIdentityBackfill.getPolicySnapshotInternal,
      { policyId: args.policyId },
    );
    if (!snapshot) {
      await ctx.runMutation(
        internal.carrierIdentityBackfill.applyRebuildInternal,
        {
          policyId: args.policyId,
          expectedFingerprint: "",
          result: serializeResult({
            outcome: "failed",
            reason: "policy_missing_during_backfill",
            shouldEnrich: false,
          }),
        },
      );
      return;
    }

    const skipReason = carrierIdentityBackfillSkipReason(snapshot.policy);
    let result: CarrierIdentityBackfillResult;
    if (skipReason) {
      result = {
        outcome: "skipped",
        reason: skipReason,
        shouldEnrich: false,
      };
    } else {
      const [sourceSpans, sourceNodes] = await Promise.all([
        readAllSourceSpans(ctx, args.policyId),
        readAllSourceNodes(ctx, args.policyId),
      ]);
      result = rebuildCarrierIdentityFromStoredSources({
        policyId: args.policyId,
        policy: snapshot.policy,
        sourceSpans,
        sourceNodes,
      });
    }
    await ctx.runMutation(
      internal.carrierIdentityBackfill.applyRebuildInternal,
      {
        policyId: args.policyId,
        expectedFingerprint: snapshot.fingerprint,
        result: serializeResult(result),
      },
    );
  },
});
