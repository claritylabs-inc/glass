"use node";
/**
 * @deprecated Use startApplicationPrefill from applicationPrefillPipeline instead.
 * This action is preserved as a thin wrapper so any legacy callers continue to work.
 * It immediately schedules the pipeline and returns placeholder counts.
 */
import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";

export const prefillFromIntelligence = action({
  args: { applicationId: v.id("applications") },
  returns: v.object({ filledCount: v.number(), skippedCount: v.number() }),
  handler: async (ctx, args): Promise<{ filledCount: number; skippedCount: number }> => {
    // Fire the new pipeline action (non-blocking) and return placeholder counts.
    // The actual prefill runs asynchronously; callers should track prefillStatus.
    void ctx.runAction(
      (api as any).actions.applicationPrefillPipeline.startApplicationPrefill,
      { applicationId: args.applicationId },
    );
    return { filledCount: 0, skippedCount: 0 };
  },
});
