"use node";

/**
 * Backfill stale policy-change broker-recipient snapshots.
 *
 * Target the Daly City case in production first:
 * npx convex run actions/backfillPolicyChangeBrokerRecipients:backfill --prod --args '{"caseIds":["v177dhdwnrqm3sah54y2jf1xwh88te8c"],"dryRun":true}'
 * npx convex run actions/backfillPolicyChangeBrokerRecipients:backfill --prod --args '{"caseIds":["v177dhdwnrqm3sah54y2jf1xwh88te8c"]}'
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

type BackfillPolicyChangeBrokerRecipientsResult = {
  scannedCount: number;
  changedCount: number;
  dryRun: boolean;
  changes: Array<{
    caseId: Id<"policyChangeCases">;
    orgId: Id<"organizations">;
    previousStatus: string;
    nextStatus: string;
    previous: {
      routingStatus?: string;
      source?: string;
      brokerOrgId?: Id<"organizations">;
      brokerCompanyName?: string;
      recipientEmail?: string;
      needsRecipient?: boolean;
    };
    next: {
      routingStatus?: string;
      source?: string;
      brokerOrgId?: Id<"organizations">;
      brokerCompanyName?: string;
      recipientEmail?: string;
      needsRecipient?: boolean;
    };
  }>;
};

export const backfill = internalAction({
  args: {
    orgId: v.optional(v.id("organizations")),
    caseIds: v.optional(v.array(v.id("policyChangeCases"))),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<BackfillPolicyChangeBrokerRecipientsResult> => {
    return (await ctx.runMutation(
      internal.policyChanges.backfillBrokerRecipientsInternal,
      args,
    )) as BackfillPolicyChangeBrokerRecipientsResult;
  },
});
