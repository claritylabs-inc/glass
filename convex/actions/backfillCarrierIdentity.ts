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

type PolicyPage = {
  policyIds: Id<"policies">[];
  nextCursor: string;
  isDone: boolean;
};

const MAX_REBUILD_RETRIES = 3;
const MAX_AUDIT_PAGE_SIZE = 25;

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

function policyProjection(policy: Record<string, unknown> | undefined) {
  if (!policy) return {};
  return Object.fromEntries(
    [
      ["carrier", policy.carrier],
      ["carrierIdentity", policy.carrierIdentity],
      ["carrierLegalName", policy.carrierLegalName],
      ["security", policy.security],
      ["insurer", policy.insurer],
    ].filter((entry) => entry[1] !== undefined),
  );
}

async function decideCarrierIdentity(
  ctx: ActionCtx,
  policyId: Id<"policies">,
) {
  const snapshot = await ctx.runQuery(
    internal.carrierIdentityBackfill.getPolicySnapshotInternal,
    { policyId },
  );
  if (!snapshot) {
    return {
      expectedFingerprint: "",
      policy: undefined,
      result: {
        outcome: "failed",
        reason: "policy_missing_during_backfill",
        shouldEnrich: false,
      } satisfies CarrierIdentityBackfillResult,
    };
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
  return {
    expectedFingerprint: snapshot.fingerprint,
    policy: snapshot.policy as Record<string, unknown>,
    result,
  };
}

async function rebuildCarrierIdentity(
  ctx: ActionCtx,
  policyId: Id<"policies">,
) {
  const decision = await decideCarrierIdentity(ctx, policyId);
  await ctx.runMutation(
    internal.carrierIdentityBackfill.applyRebuildInternal,
    {
      policyId,
      expectedFingerprint: decision.expectedFingerprint,
      result: serializeResult(decision.result),
    },
  );
}

export const audit = internalAction({
  args: {
    orgId: v.optional(v.id("organizations")),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(
      Math.max(args.limit ?? 10, 1),
      MAX_AUDIT_PAGE_SIZE,
    );
    const page: PolicyPage = await ctx.runQuery(
      internal.carrierIdentityBackfill.listPolicyIdsPageInternal,
      {
        orgId: args.orgId,
        cursor: args.cursor ?? null,
        limit,
      },
    );
    const counts: Record<
      CarrierIdentityBackfillResult["outcome"],
      number
    > = {
      pending: 0,
      rebuilt: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
    };
    const reasons: Record<string, number> = {};
    const changes: Array<{
      policyId: Id<"policies">;
      outcome: CarrierIdentityBackfillResult["outcome"];
      shouldEnrich: boolean;
      before: Record<string, unknown>;
      set: Record<string, unknown>;
      unset: string[];
    }> = [];
    const exceptions: Array<{
      policyId: Id<"policies">;
      outcome: "skipped" | "failed";
      reason: string;
    }> = [];

    for (const policyId of page.policyIds) {
      const decision = await decideCarrierIdentity(ctx, policyId);
      counts[decision.result.outcome] += 1;
      if (decision.result.reason) {
        reasons[decision.result.reason] =
          (reasons[decision.result.reason] ?? 0) + 1;
      }
      const serialized = serializeResult(decision.result);
      if (
        Object.keys(serialized.set).length > 0 ||
        serialized.unset.length > 0
      ) {
        changes.push({
          policyId,
          outcome: decision.result.outcome,
          shouldEnrich: decision.result.shouldEnrich,
          before: policyProjection(decision.policy),
          set: serialized.set,
          unset: serialized.unset,
        });
      } else if (
        (decision.result.outcome === "skipped" ||
          decision.result.outcome === "failed") &&
        decision.result.reason
      ) {
        exceptions.push({
          policyId,
          outcome: decision.result.outcome,
          reason: decision.result.reason,
        });
      }
    }

    return {
      dryRun: true as const,
      scannedCount: page.policyIds.length,
      counts,
      reasons,
      changes,
      exceptions,
      isDone: page.isDone,
      nextCursor: page.isDone ? undefined : page.nextCursor,
    };
  },
});

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
