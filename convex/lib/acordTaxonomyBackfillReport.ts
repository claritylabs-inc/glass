import { v, type Infer } from "convex/values";

export const acordTaxonomyBackfillReportValidator = v.object({
  dryRun: v.boolean(),
  scannedCount: v.number(),
  changedCount: v.number(),
  lineChangedCount: v.number(),
  coverageCodesAdded: v.number(),
  productIdentitiesAdded: v.number(),
  skippedReasons: v.record(v.string(), v.number()),
  samples: v.array(v.object({
    policyId: v.id("policies"),
    beforeLines: v.array(v.string()),
    afterLines: v.array(v.string()),
    coverageCodesAdded: v.number(),
    productIdentityAdded: v.boolean(),
  })),
  continuationScheduled: v.boolean(),
});

export type AcordTaxonomyBackfillReport = Infer<
  typeof acordTaxonomyBackfillReportValidator
>;

export function emptyAcordTaxonomyBackfillReport(
  dryRun: boolean,
): AcordTaxonomyBackfillReport {
  return {
    dryRun,
    scannedCount: 0,
    changedCount: 0,
    lineChangedCount: 0,
    coverageCodesAdded: 0,
    productIdentitiesAdded: 0,
    skippedReasons: {},
    samples: [],
    continuationScheduled: false,
  };
}

export function mergeAcordTaxonomyBackfillReports(
  left: AcordTaxonomyBackfillReport,
  right: AcordTaxonomyBackfillReport,
): AcordTaxonomyBackfillReport {
  const skippedReasons = { ...left.skippedReasons };
  for (const [reason, count] of Object.entries(right.skippedReasons)) {
    skippedReasons[reason] = (skippedReasons[reason] ?? 0) + count;
  }
  return {
    dryRun: left.dryRun,
    scannedCount: left.scannedCount + right.scannedCount,
    changedCount: left.changedCount + right.changedCount,
    lineChangedCount:
      left.lineChangedCount + right.lineChangedCount,
    coverageCodesAdded:
      left.coverageCodesAdded + right.coverageCodesAdded,
    productIdentitiesAdded:
      left.productIdentitiesAdded + right.productIdentitiesAdded,
    skippedReasons,
    samples: [...left.samples, ...right.samples].slice(0, 25),
    continuationScheduled:
      left.continuationScheduled || right.continuationScheduled,
  };
}
