import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

type OrgBrandSource = Pick<Doc<"organizations">, "website" | "iconStorageId">;

export async function orgBrandFields(ctx: QueryCtx, org?: OrgBrandSource | null) {
  const iconUrl = org?.iconStorageId
    ? await ctx.storage.getUrl(org.iconStorageId)
    : null;
  return {
    website: org?.website,
    iconStorageId: org?.iconStorageId,
    iconUrl,
  };
}
