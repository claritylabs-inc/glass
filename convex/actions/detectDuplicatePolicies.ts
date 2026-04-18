"use node";

/**
 * detectDuplicates — compare a newly extracted policy against all other org
 * policies and create a merge_suggestion notification if a near-duplicate is found.
 *
 * mergePolicies — public action to act on a merge suggestion: reassign all
 * policyFiles from the secondary policy to the primary, then soft-delete the
 * secondary and schedule reconciliation on the primary.
 */

import { v } from "convex/values";
import { internalAction, action } from "../_generated/server";
import { api, internal } from "../_generated/api";

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalize(s: string | undefined | null): string {
  return (s ?? "").toLowerCase().trim();
}

/**
 * Returns true if the two date ranges overlap.
 * Dates are ISO strings ("YYYY-MM-DD") or human-readable strings.
 * Falls back gracefully — if either date is unparseable, returns false.
 */
function datesOverlap(
  effA: string | undefined,
  expA: string | undefined,
  effB: string | undefined,
  expB: string | undefined,
): boolean {
  try {
    const startA = effA ? new Date(effA).getTime() : NaN;
    const endA = expA ? new Date(expA).getTime() : NaN;
    const startB = effB ? new Date(effB).getTime() : NaN;
    const endB = expB ? new Date(expB).getTime() : NaN;
    if (isNaN(startA) || isNaN(endA) || isNaN(startB) || isNaN(endB)) return false;
    // Ranges overlap when one starts before the other ends
    return startA <= endB && startB <= endA;
  } catch {
    return false;
  }
}

/**
 * Score an existing policy (candidate) against the newly extracted policy.
 *
 * Scoring:
 *   +50  same policyNumber (case-insensitive exact match)
 *   +20  same carrier (case-insensitive)
 *   +15  same insuredName (lowercase trimmed match)
 *   +10  overlapping effective/expiration date range
 *   +5   at least one overlapping policyType
 */
function scoreSimilarity(newPolicy: any, candidate: any): number {
  let score = 0;

  // Same policy number
  if (
    normalize(newPolicy.policyNumber) &&
    normalize(newPolicy.policyNumber) === normalize(candidate.policyNumber)
  ) {
    score += 50;
  }

  // Same carrier
  if (
    normalize(newPolicy.carrier) &&
    normalize(newPolicy.carrier) === normalize(candidate.carrier)
  ) {
    score += 20;
  }

  // Same insuredName
  if (
    normalize(newPolicy.insuredName) &&
    normalize(newPolicy.insuredName) === normalize(candidate.insuredName)
  ) {
    score += 15;
  }

  // Overlapping date range
  if (
    datesOverlap(
      newPolicy.effectiveDate,
      newPolicy.expirationDate,
      candidate.effectiveDate,
      candidate.expirationDate,
    )
  ) {
    score += 10;
  }

  // Overlapping policyTypes
  const typesA: string[] = newPolicy.policyTypes ?? [];
  const typesB: string[] = candidate.policyTypes ?? [];
  if (typesA.length > 0 && typesB.some((t: string) => typesA.includes(t))) {
    score += 5;
  }

  return score;
}

// ── Internal action: detectDuplicates ────────────────────────────────────────

export const detectDuplicates = internalAction({
  args: {
    policyId: v.id("policies"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    // 1. Load the new policy
    const newPolicy = await ctx.runQuery(internal.policies.getInternal, {
      id: args.policyId,
    }) as any;
    if (!newPolicy) return;

    // 2. Load all other complete, non-deleted policies in the org
    const allPolicies = await ctx.runQuery(internal.policies.listAllInternal, {
      orgId: args.orgId,
    }) as any[];

    const candidates = allPolicies.filter(
      (p: any) => p._id !== args.policyId,
    );

    if (candidates.length === 0) return;

    // 3. Score each candidate
    let topMatch: { policy: any; score: number } | null = null;

    for (const candidate of candidates) {
      const score = scoreSimilarity(newPolicy, candidate);
      if (score >= 60) {
        // Keep only the highest-scoring match to avoid notification spam
        if (!topMatch || score > topMatch.score) {
          topMatch = { policy: candidate, score };
        }
      }
    }

    // 4. Create a single merge_suggestion notification for the best match
    if (topMatch) {
      const { policy: match, score } = topMatch;
      await ctx.runMutation(internal.notifications.create, {
        orgId: args.orgId,
        type: "merge_suggestion",
        title: "Possible duplicate policy detected",
        body: `"${newPolicy.policyNumber}" from ${newPolicy.carrier} appears similar to existing policy "${match.policyNumber}"`,
        severity: "info",
        actionType: "merge_policies",
        actionPayload: {
          primaryPolicyId: match._id,
          secondaryPolicyId: args.policyId,
          score,
        },
        sourceRef: { policyId: args.policyId },
      });
    }
  },
});

// ── Public action: mergePolicies ─────────────────────────────────────────────

export const mergePolicies = action({
  args: {
    primaryPolicyId: v.id("policies"),
    secondaryPolicyId: v.id("policies"),
    notificationId: v.optional(v.id("notifications")),
  },
  handler: async (ctx, args) => {
    // 1. Auth check
    const viewer = await ctx.runQuery(api.users.viewer) as any;
    if (!viewer) throw new Error("Not authenticated");
    const orgData = await ctx.runQuery(api.orgs.viewerOrg) as any;
    if (!orgData) throw new Error("No organization");
    const orgId = orgData.membership.orgId;

    // 2. Load both policies
    const primary = await ctx.runQuery(internal.policies.getInternal, {
      id: args.primaryPolicyId,
    }) as any;
    const secondary = await ctx.runQuery(internal.policies.getInternal, {
      id: args.secondaryPolicyId,
    }) as any;

    if (!primary || primary.orgId !== orgId) throw new Error("Primary policy not found");
    if (!secondary || secondary.orgId !== orgId) throw new Error("Secondary policy not found");

    // 3. Load all policyFiles from the secondary policy
    const secondaryFiles = await ctx.runQuery(
      internal.policyFiles.listByPolicyInternal,
      { policyId: args.secondaryPolicyId },
    ) as any[];

    // 4. Reassign each policyFile to the primary policy
    for (const file of secondaryFiles) {
      await ctx.runMutation(internal.policyFiles.reassignToPolicy, {
        id: file._id,
        newPolicyId: args.primaryPolicyId,
      });
    }

    // 5. Update primary policy's `files` array to include the reassigned files
    const existingFiles: any[] = primary.files ?? [];
    const newFileEntries = secondaryFiles.map((f: any) => ({
      fileId: f.fileId,
      fileName: f.fileName,
      fileType: f.fileType,
      status: f.extractionStatus,
    }));
    const mergedFiles = [
      ...existingFiles,
      ...newFileEntries.filter(
        (nf: any) =>
          !existingFiles.some((ef: any) => ef.fileId === nf.fileId),
      ),
    ];

    // 6. Add secondary's emailId(s) to primary's emailIds
    const primaryEmailIds: string[] = primary.emailIds ?? [];
    const secondaryEmailIds: string[] = [
      ...(secondary.emailIds ?? []),
      ...(secondary.emailId ? [secondary.emailId] : []),
    ];
    const mergedEmailIds = [
      ...primaryEmailIds,
      ...secondaryEmailIds.filter((id) => !primaryEmailIds.includes(id)),
    ];

    await ctx.runMutation((internal as any).policies.updateFiles, {
      id: args.primaryPolicyId,
      files: mergedFiles,
      emailIds: mergedEmailIds,
      reconciliationStatus: "pending",
    });

    // 7. Schedule reconciliation for the primary policy
    await ctx.scheduler.runAfter(0, internal.actions.reconcilePolicy.reconcilePolicy, {
      policyId: args.primaryPolicyId,
      orgId,
    });

    // 8. Delete document chunks from secondary (reconciliation will regenerate primary's)
    await ctx.runMutation(internal.documentChunks.deleteByPolicy, {
      policyId: args.secondaryPolicyId,
    });

    // 9. Soft-delete the secondary policy
    await ctx.runMutation(internal.policies.softDeleteInternal, {
      id: args.secondaryPolicyId,
    });

    // 10. Mark the notification as actioned
    if (args.notificationId) {
      await ctx.runMutation(internal.notifications.markActionedInternal, {
        notificationId: args.notificationId,
      });
    }

    return { success: true, primaryPolicyId: args.primaryPolicyId };
  },
});
