"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";

// The scheduler-facing boundary is intentionally separate from the operator
// tools. Callers provide source-backed section updates; the mutation applies
// leases, idempotency, and demote-on-edit invariants atomically.
export const reconcile = internalAction({
  args: {
    requestId: v.id("procurementRequests"),
    sourceFingerprint: v.string(),
    sections: v.array(v.object({
      key: v.string(), body: v.string(),
      audienceProposed: v.optional(v.union(v.literal("client"), v.literal("broker"))),
      rationale: v.optional(v.string()), sourceRefs: v.array(v.string()),
    })),
  },
  handler: async (ctx, args): Promise<{ changed: boolean }> => ctx.runMutation(internal.procurementPacket.applyAgentUpdateInternal, args),
});
