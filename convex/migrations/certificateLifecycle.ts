import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * Widen-phase backfill for CLA-36.
 *
 * Run in small batches until `remaining` is 0:
 *   npx convex run migrations/certificateLifecycle:backfillCertificateLifecycle '{"limit":100}'
 *
 * This intentionally keeps legacy `certificates` rows readable while attaching
 * holder, certificate-version, and current policy-version lifecycle records.
 */
export const backfillCertificateLifecycle = action({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ processed: number; remaining: number }> => {
    const limit = Math.max(1, Math.min(args.limit ?? 100, 500));
    const legacyRows = await ctx.runQuery(
      (internal as any).certificates.listLegacyLifecycleBackfillBatchInternal,
      { limit },
    ) as Array<{ _id: string; policyId: string }>;

    let processed = 0;
    for (const row of legacyRows) {
      const policyVersionId = await ctx.runMutation(
        (internal as any).policies.snapshotCurrentVersionInternal,
        { policyId: row.policyId, eventType: "backfill" },
      );
      await ctx.runMutation(
        (internal as any).certificates.backfillLegacyCertificateInternal,
        { certificateId: row._id, policyVersionId },
      );
      processed += 1;
    }

    const remainingRows = await ctx.runQuery(
      (internal as any).certificates.listLegacyLifecycleBackfillBatchInternal,
      { limit: 1_000_000 },
    ) as unknown[];
    return { processed, remaining: remainingRows.length };
  },
});
