"use node";

/**
 * One-time cleanup for the coverage-only compliance requirement model.
 * Archives active insurer/condition (and unclassified legacy) requirements.
 *
 * Run the shape backfill first so salvageable legacy rows are classified as
 * coverage before this archives the rest:
 * npx convex run actions/backfillComplianceRequirementShape:backfill --args '{"dryRun":false}'
 *
 * Dry run:
 * npx convex run actions/archiveNonCoverageRequirements:archive --args '{"dryRun":true}'
 *
 * Live run:
 * npx convex run actions/archiveNonCoverageRequirements:archive --args '{"dryRun":false}'
 */

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

type ArchiveNonCoverageRequirementsReport = {
  dryRun: boolean;
  scannedCount: number;
  archivedCount: number;
  samples: Array<{
    requirementId: Id<"insuranceRequirements">;
    title: string;
    kind: string;
  }>;
};

export const archive = internalAction({
  args: {
    orgId: v.optional(v.id("organizations")),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ArchiveNonCoverageRequirementsReport> =>
    await ctx.runMutation(
      (internal as any).compliance.archiveNonCoverageRequirementsInternal,
      args,
    ),
});
