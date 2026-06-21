"use node";

import { v } from "convex/values";
import { internalAction, action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { deletePolicyRowsInBatches } from "../lib/deletePolicyRowsInBatches";
import { compareDuplicatePolicies } from "../lib/policyDuplicateDetection";

export const detectDuplicates = internalAction({
  args: {
    policyId: v.id("policies"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const newPolicy = await ctx.runQuery(internal.policies.getInternal, {
      id: args.policyId,
    });
    if (!newPolicy) return;

    const allPolicies = (await ctx.runQuery(
      internal.policies.listAllInternal,
      {
        orgId: args.orgId,
      },
    )) as Doc<"policies">[];

    const candidates = allPolicies.filter(
      (policy: Doc<"policies">) => policy._id !== args.policyId,
    );

    if (candidates.length === 0) return;

    let topMatch: { policy: typeof candidates[number]; score: number } | null = null;

    for (const candidate of candidates) {
      const match = compareDuplicatePolicies(newPolicy, candidate);
      if (match.isMatch && (!topMatch || match.score > topMatch.score)) {
        topMatch = { policy: candidate, score: match.score };
      }
    }

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
    const orgData = await ctx.runQuery(api.orgs.viewerOrg, {}) as any;
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
      status: f.pipelineStatus ?? "idle",
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
    await deletePolicyRowsInBatches(
      ctx,
      internal.documentChunks.deleteByPolicy,
      args.secondaryPolicyId,
    );

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
