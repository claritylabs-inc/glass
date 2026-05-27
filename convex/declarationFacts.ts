import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import {
  declarationFactHash,
  extractDeclarationFactsFromPolicy,
  findDeclarationDiscrepancies,
  shouldNotifyForDeclarationDiscrepancy,
} from "./lib/declarationFacts";
import { getOrgAccess } from "./lib/access";
import { notify } from "./lib/notify";

export const listForPolicy = query({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy?.orgId || policy.deletedAt) return [];
    const orgId = policy.orgId;

    await getOrgAccess(ctx, orgId);

    const discrepancies = await ctx.db
      .query("declarationDiscrepancies")
      .withIndex("by_orgId_status", (q) =>
        q.eq("orgId", orgId).eq("status", "notified"),
      )
      .collect();
    const openDiscrepancies = await ctx.db
      .query("declarationDiscrepancies")
      .withIndex("by_orgId_status", (q) =>
        q.eq("orgId", orgId).eq("status", "open"),
      )
      .collect();

    const candidateDiscrepancies = [...discrepancies, ...openDiscrepancies]
      .filter((discrepancy) =>
        discrepancy.affectedPolicyIds.some((id) => id === args.policyId),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const policyIds = Array.from(
      new Set(
        candidateDiscrepancies.flatMap((discrepancy) =>
          discrepancy.affectedPolicyIds.map((id) => String(id)),
        ),
      ),
    );
    const policies = await Promise.all(
      policyIds.map(async (policyId) => {
        const row = await ctx.db.get(policyId as typeof args.policyId);
        if (!row || row.deletedAt) return null;
        return [
          policyId,
          row.policyNumber ||
            row.insuredName ||
            row.fileName ||
            "Policy",
        ] as const;
      }),
    );
    const policyLabels = Object.fromEntries(policies.filter((row) => row !== null));
    const activePolicyIds = new Set(Object.keys(policyLabels));

    return candidateDiscrepancies.flatMap((discrepancy) => {
      const conflictingValues: Array<{
        displayValue?: string;
        normalizedValue?: string;
        policyIds: string[];
        policyLabels: Array<{ policyId: string; label: string }>;
        [key: string]: unknown;
      }> = discrepancy.conflictingValues.flatMap((value: {
        displayValue?: string;
        normalizedValue?: string;
        policyIds?: string[];
        [key: string]: unknown;
      }) => {
        if (
          String(discrepancy.fieldGroup).startsWith("coverage_limit:") ||
          String(discrepancy.fieldGroup).startsWith("coverage_deductible:")
        ) {
          return [];
        }
        const valuePolicyIds = Array.isArray(value.policyIds)
          ? value.policyIds.filter((policyId: string) => activePolicyIds.has(policyId))
          : [];
        if (valuePolicyIds.length === 0) return [];
        return [{
          ...value,
          policyIds: valuePolicyIds,
          policyLabels: valuePolicyIds.map((policyId: string) => ({
            policyId,
            label: policyLabels[policyId] ?? "Policy",
          })),
        }];
      });
      if (conflictingValues.length <= 1) return [];

      const affectedPolicyIds = Array.from(
        new Set(conflictingValues.flatMap((value) => value.policyIds)),
      );
      if (affectedPolicyIds.length <= 1) return [];
      if (!affectedPolicyIds.includes(String(args.policyId))) return [];

      return [{
        ...discrepancy,
        affectedPolicyIds,
        likelyCurrentValue:
          conflictingValues[0]?.displayValue as string | undefined ??
          discrepancy.likelyCurrentValue,
        affectedPolicyLabels: affectedPolicyIds.map((policyId) => ({
          policyId,
          label: policyLabels[policyId] ?? "Policy",
        })),
        conflictingValues,
      }];
    });
  },
});

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

    if (policy.deletedAt) return { inserted: 0 };

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
        valueKind: fact.valueKind,
        sourceSpanIds: fact.sourceSpanIds,
        effectiveDate: fact.effectiveDate,
        expirationDate: fact.expirationDate,
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

    return { inserted };
  },
});

export const scanOrgInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    notifyExternal: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const facts = await ctx.db
      .query("policyDeclarationFacts")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();
    const candidateFacts = facts.filter((fact) => fact.active);
    const policyIds = Array.from(new Set(candidateFacts.map((fact) => fact.policyId)));
    const policies = await Promise.all(policyIds.map((policyId) => ctx.db.get(policyId)));
    const activePolicyIds = new Set(
      policies
        .filter((policy) => policy && !policy.deletedAt)
        .map((policy) => String(policy!._id)),
    );
    const activeFacts = candidateFacts.filter((fact) =>
      activePolicyIds.has(String(fact.policyId)),
    );
    const discrepancies = findDeclarationDiscrepancies(activeFacts.map((fact) => ({
      orgId: String(fact.orgId),
      policyId: String(fact.policyId),
      policyFileId: fact.policyFileId ? String(fact.policyFileId) : undefined,
      fieldPath: fact.fieldPath,
      fieldGroup: fact.fieldGroup,
      displayValue: fact.displayValue,
      normalizedValue: fact.normalizedValue,
      valueKind: fact.valueKind,
      sourceSpanIds: fact.sourceSpanIds,
      effectiveDate: fact.effectiveDate,
      expirationDate: fact.expirationDate,
      observedAt: fact.observedAt,
    })));

    let upserted = 0;
    let notified = 0;
    for (const discrepancy of discrepancies) {
      const existingOpen = await ctx.db
        .query("declarationDiscrepancies")
        .withIndex("by_orgId_fieldGroup", (q) =>
          q.eq("orgId", args.orgId).eq("fieldGroup", discrepancy.fieldGroup)
        )
        .filter((q) =>
          q.or(
            q.eq(q.field("status"), "open"),
            q.eq(q.field("status"), "notified"),
          )
        )
        .first();

      const patch = {
        likelyCurrentValue: discrepancy.likelyCurrentValue,
        question: undefined,
        plainLanguageSummary: undefined,
        recommendedAction: undefined,
        conflictingValues: discrepancy.conflictingValues,
        affectedPolicyIds: discrepancy.affectedPolicyIds as never,
        severity: discrepancy.severity,
        updatedAt: now,
      };
      const discrepancyId = existingOpen
        ? (await ctx.db.patch(existingOpen._id, patch), existingOpen._id)
        : await ctx.db.insert("declarationDiscrepancies", {
            orgId: args.orgId,
            fieldGroup: discrepancy.fieldGroup,
            ...patch,
            status: "open",
            createdAt: now,
          });
      upserted += 1;

      if (args.notifyExternal && shouldNotifyForDeclarationDiscrepancy(discrepancy)) {
        const notificationId = await notify(ctx, {
          orgId: args.orgId,
          type: "policy_declaration_discrepancy",
          title: "Policy declarations do not match",
          body: `Glass found conflicting ${discrepancy.fieldGroup.replace(/_/g, " ")} values across policies. Likely current value: ${discrepancy.likelyCurrentValue ?? "needs confirmation"}.`,
          actionType: "view_policy",
          actionPayload: {
            policyId: discrepancy.affectedPolicyIds[0],
            tab: "changes",
          },
          sourceRef: { declarationDiscrepancyId: discrepancyId },
          coalesceKeyParts: ["policy_declaration_discrepancy", args.orgId, discrepancy.fieldGroup],
        });
        await ctx.db.patch(discrepancyId, { status: "notified", notificationId });
        notified += 1;
      }
    }

    const activeFieldGroups = new Set(discrepancies.map((discrepancy) => discrepancy.fieldGroup));
    const staleDiscrepancies = await ctx.db
      .query("declarationDiscrepancies")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "open"),
          q.eq(q.field("status"), "notified"),
        )
      )
      .collect();
    for (const stale of staleDiscrepancies) {
      if (activeFieldGroups.has(stale.fieldGroup)) continue;
      await ctx.db.patch(stale._id, { status: "dismissed", updatedAt: now });
    }

    return { scannedFacts: activeFacts.length, upserted, notified };
  },
});

export const listOpenForCopyInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("declarationDiscrepancies")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "open"),
          q.eq(q.field("status"), "notified"),
        )
      )
      .collect();
    return rows.filter((row) => !row.question || !row.plainLanguageSummary);
  },
});

export const updateCopyInternal = internalMutation({
  args: {
    discrepancyId: v.id("declarationDiscrepancies"),
    question: v.string(),
    plainLanguageSummary: v.string(),
    recommendedAction: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.discrepancyId, {
      question: args.question,
      plainLanguageSummary: args.plainLanguageSummary,
      recommendedAction: args.recommendedAction,
      updatedAt: dayjs().valueOf(),
    });
  },
});
