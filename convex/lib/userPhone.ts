import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const PHONE_IN_USE_MESSAGE =
  "This phone number is already used by another user.";
export const INVALID_PHONE_MESSAGE =
  "Enter a valid phone number with country code.";

export function normalizeUserPhone(value: string | undefined | null) {
  const phone = value?.trim();
  if (!phone) return undefined;
  const parsed = parsePhoneNumberFromString(phone, "US");
  if (!parsed || !parsed.isValid()) {
    throw new Error(INVALID_PHONE_MESSAGE);
  }
  return parsed.number;
}

export async function findUserByNormalizedPhone(
  ctx: QueryCtx | MutationCtx,
  normalizedPhone: string,
) {
  return await ctx.db
    .query("users")
    .withIndex("phone", (q) => q.eq("phone", normalizedPhone))
    .first();
}

export async function normalizeAvailableUserPhone(
  ctx: QueryCtx | MutationCtx,
  value: string | undefined | null,
  ownerUserId?: Id<"users">,
) {
  const normalized = normalizeUserPhone(value);
  if (!normalized) return undefined;
  const existing = await findUserByNormalizedPhone(ctx, normalized);
  if (existing && existing._id !== ownerUserId) {
    throw new Error(PHONE_IN_USE_MESSAGE);
  }
  return normalized;
}
