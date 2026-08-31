import { Migrations } from "@convex-dev/migrations";
import dayjs from "dayjs";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { effectiveExtractionDataStage } from "./backfillDeclarationFacts";
import { recordCarrierIdentityBackfillResult } from "./carrierIdentityBackfill";
import { replacePolicyDeclarationFacts } from "./declarationFacts";
import { carrierIdentityBackfillSkipReason } from "./lib/carrierIdentityBackfill";
import { resolveLegacyDeliveryOwner } from "./lib/policyDeliveryMigration";
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
      accentColorSource: cachedIdentity.accentColorSource,
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

// Write phase only. Audit actual stored-evidence decisions first through
// actions/backfillCarrierIdentity:audit; migration dry-run rolls back scheduling.
export const rebuildCarrierIdentitiesFromStoredSources = migrations.define({
  table: "policies",
  batchSize: 1,
  migrateOne: async (ctx, policy) => {
    const now = dayjs().valueOf();
    const skipReason = carrierIdentityBackfillSkipReason(policy);
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
    await recordCarrierIdentityBackfillResult(
      ctx,
      policy._id,
      {
        outcome: "pending",
        reason: "source_evidence_paging",
        shouldEnrich: false,
      },
      now,
    );
    await ctx.scheduler.runAfter(
      0,
      internal.actions.backfillCarrierIdentity.rebuildOne,
      { policyId: policy._id },
    );
  },
});

export const backfillPolicyDeliverySettingOwners = migrations.define({
  table: "policyDeliverySettings",
  batchSize: 50,
  migrateOne: async (ctx, settings) => {
    const deliveryOwnerOrgId = resolveLegacyDeliveryOwner(settings);
    if (!deliveryOwnerOrgId || settings.deliveryOwnerOrgId) return;
    await ctx.db.patch(settings._id, { deliveryOwnerOrgId });
  },
});

export const backfillPolicyDeliveryRuleOwners = migrations.define({
  table: "policyDeliveryRules",
  batchSize: 50,
  migrateOne: async (ctx, rule) => {
    const deliveryOwnerOrgId = resolveLegacyDeliveryOwner(rule);
    if (!deliveryOwnerOrgId || rule.deliveryOwnerOrgId) return;
    await ctx.db.patch(rule._id, { deliveryOwnerOrgId });
  },
});

export const backfillPolicyDeliveryJobOwners = migrations.define({
  table: "policyDeliveryJobs",
  batchSize: 50,
  migrateOne: async (ctx, job) => {
    if (job.deliveryOwnerOrgId) return;
    await ctx.db.patch(job._id, { deliveryOwnerOrgId: job.clientOrgId });
  },
});

export const backfillPolicyDeliveryAttemptOwners = migrations.define({
  table: "policyDeliveryAttempts",
  batchSize: 50,
  migrateOne: async (ctx, attempt) => {
    if (attempt.deliveryOwnerOrgId) return;
    await ctx.db.patch(attempt._id, {
      deliveryOwnerOrgId: attempt.clientOrgId,
    });
  },
});

export const unsetLegacyCoiAttachmentAuthorization = migrations.define({
  table: "pendingEmails",
  batchSize: 100,
  migrateOne: async (ctx, pendingEmail) => {
    if (pendingEmail.allowMultipleCoiAttachments === undefined) return;
    await ctx.db.patch(pendingEmail._id, {
      allowMultipleCoiAttachments: undefined,
    });
  },
});

export const backfillSlackInboundEventMentionsSpot = migrations.define({
  table: "slackInboundEvents",
  batchSize: 100,
  migrateOne: async (ctx, event) => {
    if (event.mentionsSpot !== undefined && event.mentionsGlass === undefined) {
      return;
    }
    await ctx.db.patch(event._id, {
      mentionsSpot: event.mentionsSpot ?? event.mentionsGlass ?? false,
      mentionsGlass: undefined,
    });
  },
});

export const runDeclarationFactsBackfill = migrations.runner([
  internal.migrations.backfillDeclarationFacts,
  internal.migrations.syncDeclarationFactProfiles,
]);

export const runCarrierIdentityBackfill = migrations.runner([
  internal.migrations.rebuildCarrierIdentitiesFromStoredSources,
]);

export const runPolicyDeliveryOwnerBackfill = migrations.runner([
  internal.migrations.backfillPolicyDeliverySettingOwners,
  internal.migrations.backfillPolicyDeliveryRuleOwners,
  internal.migrations.backfillPolicyDeliveryJobOwners,
  internal.migrations.backfillPolicyDeliveryAttemptOwners,
]);

export const runLegacyCoiAttachmentAuthorizationCleanup = migrations.runner([
  internal.migrations.unsetLegacyCoiAttachmentAuthorization,
]);

export const runSlackInboundEventMentionsSpotBackfill = migrations.runner([
  internal.migrations.backfillSlackInboundEventMentionsSpot,
]);
