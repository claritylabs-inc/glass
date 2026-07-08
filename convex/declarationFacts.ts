import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import {
  declarationFactHash,
  extractDeclarationFactsFromPolicy,
} from "./lib/declarationFacts";
import { syncOrgProfileFromDeclarationFacts } from "./lib/orgProfileFacts";

export const syncPolicyInternal = internalMutation({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy?.orgId) return { inserted: 0 };

    const now = dayjs().valueOf();
    const existingActive = await ctx.db
      .query("policyDeclarationFacts")
      .withIndex("by_policyId_active", (q) => q.eq("policyId", args.policyId).eq("active", true))
      .collect();
    for (const fact of existingActive) {
      await ctx.db.patch(fact._id, { active: false });
    }

    if (policy.deletedAt) {
      const profile = await syncOrgProfileFromDeclarationFacts(ctx, policy.orgId);
      return { inserted: 0, profile };
    }

    const facts = extractDeclarationFactsFromPolicy(policy as unknown as Record<string, unknown>);
    let inserted = 0;
    for (const fact of facts) {
      await ctx.db.insert("policyDeclarationFacts", {
        orgId: policy.orgId,
        policyId: args.policyId,
        policyFileId: fact.policyFileId as never,
        fieldPath: fact.fieldPath,
        fieldGroup: fact.fieldGroup,
        displayValue: fact.displayValue,
        normalizedValue: fact.normalizedValue,
        structuredValue: fact.structuredValue,
        valueKind: fact.valueKind,
        sourceSpanIds: fact.sourceSpanIds,
        effectiveDate: fact.effectiveDate,
        expirationDate: fact.expirationDate,
        policyYear: fact.policyYear,
        observedAt: now,
        active: true,
        recordHash: declarationFactHash({
          policyId: String(args.policyId),
          fieldPath: fact.fieldPath,
          normalizedValue: fact.normalizedValue,
        }),
      });
      inserted += 1;
    }

    const profile = await syncOrgProfileFromDeclarationFacts(ctx, policy.orgId);
    return { inserted, profile };
  },
});
