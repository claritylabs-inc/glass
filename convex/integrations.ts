// convex/integrations.ts
// Webhook dispatcher action + summary query.

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// ── Webhook dispatcher ─────────────────────────────────────────────────────

/**
 * Verifies Merge webhook signature and routes events to the appropriate handler.
 *
 * DEFERRED: When real Merge credentials are available, replace the stub
 * signature check with real HMAC-SHA256 verification using MERGE_WEBHOOK_SECRET.
 *
 * Supported event types:
 *   linked_account.created     → recordLinkedAccount + runInitialSync
 *   sync.completed             → runWebhookDrivenSync
 *   linked_account.deleted     → markDisconnectedInternal
 *   linked_account.reauth_required → markReauthRequiredInternal
 */
export const processWebhook = internalAction({
  args: {
    rawBody: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    // DEFERRED: real HMAC check
    // const secret = process.env.MERGE_WEBHOOK_SECRET;
    // verifyMergeSignature(args.rawBody, args.signature, secret);

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(args.rawBody);
    } catch {
      throw new Error("Invalid webhook payload — not JSON");
    }

    const eventType = (payload.hook as Record<string, unknown>)?.event as string | undefined;

    switch (eventType) {
      case "linked_account.created": {
        const data = payload.linked_account as Record<string, unknown>;
        // In the live flow, end_user_origin_id is the clientOrgId we passed to createLinkToken
        const clientOrgId = data.end_user_origin_id as string;
        const linkedAccountId = data.id as string;
        const integration = data.integration as Record<string, unknown>;

        await ctx.runMutation(
          (internal as any).integrationConnections.recordLinkedAccount,
          {
            clientOrgId,
            category: (data.category as string).toLowerCase() as "accounting" | "hris" | "payroll",
            mergeLinkedAccountId: linkedAccountId,
            accountToken: data.account_token as string,
            providerSlug: (integration?.slug as string) ?? "unknown",
            providerDisplayName: (integration?.name as string) ?? "Unknown",
          },
        );
        break;
      }

      case "sync.completed": {
        const data = payload as Record<string, unknown>;
        const linkedAccountId = (data.linked_account as Record<string, unknown>)?.id as string;
        const conn = await ctx.runQuery(
          (internal as any).integrationConnections.getByLinkedAccountIdInternal,
          { mergeLinkedAccountId: linkedAccountId },
        );
        if (conn) {
          await ctx.runAction(
            (internal as any).actions.mergeSync.runWebhookDrivenSync,
            { connectionId: conn._id, modelName: data.model_name as string | undefined },
          );
        }
        break;
      }

      case "linked_account.deleted": {
        const linkedAccountId = (payload.linked_account as Record<string, unknown>)?.id as string;
        if (linkedAccountId) {
          await ctx.runMutation(
            (internal as any).integrationConnections.markDisconnectedInternal,
            { mergeLinkedAccountId: linkedAccountId },
          );
        }
        break;
      }

      case "linked_account.reauth_required": {
        const linkedAccountId = (payload.linked_account as Record<string, unknown>)?.id as string;
        if (linkedAccountId) {
          await ctx.runMutation(
            (internal as any).integrationConnections.markReauthRequiredInternal,
            { mergeLinkedAccountId: linkedAccountId },
          );
        }
        break;
      }

      default:
        // Unknown event — log and ignore
        console.log(`[merge-webhook] Unhandled event type: ${eventType}`);
    }
  },
});
