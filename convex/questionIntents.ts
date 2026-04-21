import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { requireOrgAccess } from "./lib/orgAuth";

export const search = query({
  args: {
    query: v.optional(v.string()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx);
    const all = await ctx.db.query("questionIntents").collect();
    return all.filter((intent) => {
      const matchesCategory = !args.category || intent.category === args.category;
      const q = (args.query ?? "").toLowerCase();
      const matchesQuery =
        !q ||
        intent.label.toLowerCase().includes(q) ||
        intent.intentKey.toLowerCase().includes(q) ||
        intent.defaultPrompt.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  },
});

/** Called by the seed script — upserts by intentKey. */
export const upsertInternal = internalMutation({
  args: {
    intentKey: v.string(),
    label: v.string(),
    defaultPrompt: v.string(),
    answerType: v.string(),
    selectOptions: v.optional(v.array(v.object({ value: v.string(), label: v.string() }))),
    passportFieldPath: v.optional(v.string()),
    integrationCandidates: v.optional(v.array(v.string())),
    category: v.string(),
    validationHint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("questionIntents")
      .withIndex("by_intentKey", (q) => q.eq("intentKey", args.intentKey))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args } as any);
    } else {
      await ctx.db.insert("questionIntents", args as any);
    }
  },
});
