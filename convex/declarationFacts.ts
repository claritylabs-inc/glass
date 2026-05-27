import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
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
    if (!policy?.orgId) return [];
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

    const visible = [...discrepancies, ...openDiscrepancies]
      .filter((discrepancy) =>
        discrepancy.affectedPolicyIds.some((id) => id === args.policyId),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const policyIds = Array.from(
      new Set(
        visible.flatMap((discrepancy) =>
          discrepancy.affectedPolicyIds.map((id) => String(id)),
        ),
      ),
    );
    const policies = await Promise.all(
      policyIds.map(async (policyId) => {
        const row = await ctx.db.get(policyId as typeof args.policyId);
        return row
          ? [
              policyId,
              row.policyNumber ||
                row.insuredName ||
                row.fileName ||
                "Policy",
            ]
          : [policyId, "Policy"];
      }),
    );
    const policyLabels = Object.fromEntries(policies);

    return visible.map((discrepancy) => ({
      ...discrepancy,
      affectedPolicyLabels: discrepancy.affectedPolicyIds.map((id) => ({
        policyId: id,
        label: policyLabels[String(id)] ?? "Policy",
      })),
      conflictingValues: discrepancy.conflictingValues.map((value: {
        policyIds?: string[];
        [key: string]: unknown;
      }) => ({
        ...value,
        policyLabels: Array.isArray(value.policyIds)
          ? value.policyIds.map((policyId: string) => ({
              policyId,
              label: policyLabels[policyId] ?? "Policy",
            }))
          : [],
      })),
    }));
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
    const activeFacts = facts.filter((fact) => fact.active);
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

    return { scannedFacts: activeFacts.length, upserted, notified };
  },
});
