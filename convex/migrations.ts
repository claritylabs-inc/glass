import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { effectiveExtractionDataStage } from "./backfillDeclarationFacts";
import { replacePolicyDeclarationFacts } from "./declarationFacts";
import { syncOrgProfileFromDeclarationFacts } from "./lib/orgProfileFacts";

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

export const runDeclarationFactsBackfill = migrations.runner([
  internal.migrations.backfillDeclarationFacts,
  internal.migrations.syncDeclarationFactProfiles,
]);
