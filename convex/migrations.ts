import { Migrations } from "@convex-dev/migrations";
import dayjs from "dayjs";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { effectiveExtractionDataStage } from "./backfillDeclarationFacts";
import { recordCarrierIdentityBackfillResult } from "./carrierIdentityBackfill";
import { replacePolicyDeclarationFacts } from "./declarationFacts";
import { rebuildCarrierIdentityFromStoredSources } from "./lib/carrierIdentityBackfill";
import { syncOrgProfileFromDeclarationFacts } from "./lib/orgProfileFacts";
import {
  applyCarrierIdentityEnrichment,
  readCarrierIdentity,
} from "./lib/carrierIdentity";

export const migrations = new Migrations<DataModel>(components.migrations);

export const backfillDeclarationFacts = migrations.define({
  table: "policies",
  batchSize: 10,
  migrateOne: async (ctx, policy) => {
    if (
      !policy.orgId ||
      effectiveExtractionDataStage(policy) !== "final"
    ) {
      return;
    }
    await replacePolicyDeclarationFacts(ctx, policy._id, undefined, false);
  },
});

export const syncDeclarationFactProfiles = migrations.define({
  table: "organizations",
  batchSize: 10,
  migrateOne: async (ctx, org) => {
    await syncOrgProfileFromDeclarationFacts(ctx, org._id);
  },
});

export const consolidateCarrierIdentityBranding = migrations.define({
  table: "policies",
  batchSize: 25,
  migrateOne: async (ctx, policy) => {
    if (!policy.carrierBrandId) return;
    const identity = readCarrierIdentity(policy.carrierIdentity);
    const cachedIdentity = await ctx.db.get(policy.carrierBrandId);
    if (!identity || !cachedIdentity) return;

    const carrierIdentity = applyCarrierIdentityEnrichment(identity, {
      publicName: cachedIdentity.publicName,
      nameRelationship: cachedIdentity.nameRelationship,
      website: cachedIdentity.website,
      websiteTitle: cachedIdentity.websiteTitle,
      iconStorageId: cachedIdentity.iconStorageId,
      accentColor: cachedIdentity.accentColor,
      confidence: cachedIdentity.confidence,
      sourceUrls: cachedIdentity.sourceUrls,
      enrichmentVersion: cachedIdentity.enrichmentVersion ?? 0,
      updatedAt: cachedIdentity.updatedAt,
    });
    await ctx.db.patch(policy._id, {
      carrier: carrierIdentity.displayName,
      carrierIdentity,
      carrierIdentityEnrichmentStatus: "ready",
      carrierBrandId: undefined,
      carrierBrandStatus: undefined,
      carrierBrandAttempts: undefined,
      carrierBrandAttemptedAt: undefined,
    });
  },
});

export const rebuildCarrierIdentitiesFromStoredSources = migrations.define({
  table: "policies",
  batchSize: 1,
  migrateOne: async (ctx, policy) => {
    const now = dayjs().valueOf();
    const skipReason =
      policy.deletedAt !== undefined
        ? "archived_policy"
        : policy.pipelineStatus === "error"
          ? "failed_extraction"
          : effectiveExtractionDataStage(policy) !== "final"
            ? "not_final_policy"
            : undefined;
    if (skipReason) {
      await recordCarrierIdentityBackfillResult(
        ctx,
        policy._id,
        {
          outcome: "skipped",
          reason: skipReason,
          shouldEnrich: false,
        },
        now,
      );
      return;
    }
    const [sourceSpans, sourceNodes] = await Promise.all([
      ctx.db
        .query("sourceSpans")
        .withIndex("by_policyId", (query) =>
          query.eq("policyId", policy._id)
        )
        .collect(),
      ctx.db
        .query("sourceNodes")
        .withIndex("by_policyId", (query) =>
          query.eq("policyId", policy._id)
        )
        .collect(),
    ]);
    const result = rebuildCarrierIdentityFromStoredSources({
      policyId: policy._id,
      policy,
      sourceSpans,
      sourceNodes,
    });
    if (result.patch) {
      await ctx.db.patch(policy._id, result.patch);
    }
    await recordCarrierIdentityBackfillResult(
      ctx,
      policy._id,
      result,
      now,
    );
    if (result.shouldEnrich) {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.enrichCarrierIdentity.ensureInternal,
        { policyId: policy._id },
      );
    }
  },
});

export const runDeclarationFactsBackfill = migrations.runner([
  internal.migrations.backfillDeclarationFacts,
  internal.migrations.syncDeclarationFactProfiles,
]);

export const runCarrierIdentityBackfill = migrations.runner([
  internal.migrations.rebuildCarrierIdentitiesFromStoredSources,
]);
