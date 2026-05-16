"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

type FeatureFlagCtx = Pick<ActionCtx, "runQuery">;

type OrgWithFeatureFlags = {
  featureFlags?: {
    docling?: boolean;
  };
} | null;

function readBooleanEnv(value: string | undefined): boolean {
  return value === "true" || value === "1" || value?.toLowerCase() === "yes";
}

export async function isDoclingEnabled(
  ctx: FeatureFlagCtx,
  orgId: Id<"organizations"> | undefined,
): Promise<boolean> {
  if (!orgId) return false;
  const org = await ctx.runQuery(internal.orgs.getInternal, { id: orgId }) as OrgWithFeatureFlags;
  if (!org) return false;
  const override = org.featureFlags?.docling;
  if (typeof override === "boolean") return override;
  return readBooleanEnv(process.env.DOCLING_ENABLED);
}
