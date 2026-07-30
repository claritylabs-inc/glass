import type { QueryCtx } from "../_generated/server";
import {
  readCarrierIdentity,
  type CarrierIdentity,
} from "./carrierIdentity";

type StorageContext = Pick<QueryCtx, "storage">;

export async function resolveCarrierIdentity(
  ctx: StorageContext,
  value: unknown,
): Promise<CarrierIdentity | undefined> {
  const identity = readCarrierIdentity(value);
  if (!identity?.branding) return identity;

  const iconUrl = identity.branding.iconStorageId
    ? await ctx.storage.getUrl(identity.branding.iconStorageId)
    : null;
  return {
    ...identity,
    branding: {
      ...identity.branding,
      iconUrl,
    },
  };
}
