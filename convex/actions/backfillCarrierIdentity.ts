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

const MAX_REBUILD_RETRIES = 3;

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

async function rebuildCarrierIdentity(
  ctx: ActionCtx,
  policyId: Id<"policies">,
) {
  const snapshot = await ctx.runQuery(
    internal.carrierIdentityBackfill.getPolicySnapshotInternal,
    { policyId },
  );
  if (!snapshot) {
    await ctx.runMutation(
      internal.carrierIdentityBackfill.applyRebuildInternal,
      {
        policyId,
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
      readAllSourceSpans(ctx, policyId),
      readAllSourceNodes(ctx, policyId),
    ]);
    result = rebuildCarrierIdentityFromStoredSources({
      policyId,
      policy: snapshot.policy,
      sourceSpans,
      sourceNodes,
    });
  }
  await ctx.runMutation(
    internal.carrierIdentityBackfill.applyRebuildInternal,
    {
      policyId,
      expectedFingerprint: snapshot.fingerprint,
      result: serializeResult(result),
    },
  );
}

export const rebuildOne = internalAction({
  args: {
    policyId: v.id("policies"),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const attempt = args.attempt ?? 0;
    try {
      await rebuildCarrierIdentity(ctx, args.policyId);
    } catch (error) {
      console.error(
        `[carrier-identity-backfill] rebuild failed for ${args.policyId} on attempt ${attempt}`,
        error,
      );
      if (attempt < MAX_REBUILD_RETRIES) {
        await ctx.runMutation(
          internal.carrierIdentityBackfill.scheduleRebuildRetryInternal,
          {
            policyId: args.policyId,
            attempt: attempt + 1,
          },
        );
        return;
      }
      await ctx.runMutation(
        internal.carrierIdentityBackfill.recordRebuildFailureInternal,
        { policyId: args.policyId },
      );
    }
  },
});
