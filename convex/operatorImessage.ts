import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { normalizeUserPhone } from "./lib/userPhone";

export const resolveIdentity = internalQuery({
  args: { fromPhone: v.string() },
  handler: async (ctx, args) => {
    let phone: string | undefined;
    try {
      phone = normalizeUserPhone(args.fromPhone);
    } catch {
      return null;
    }
    if (!phone) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("phone", (q) => q.eq("phone", phone))
      .first();
    if (!user || user.accountKind !== "operator") return null;
    const profile = await ctx.db
      .query("operatorProfiles")
      .withIndex("user", (q) => q.eq("userId", user._id))
      .first();
    if (!profile || profile.status !== "active") return null;
    return {
      operatorUserId: user._id,
      phone,
      displayName: user.name ?? user.email ?? "Operator",
    };
  },
});
