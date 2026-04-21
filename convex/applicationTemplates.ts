import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import {
  assertCanCreateBrokerTemplate,
  assertCanUseSystemTemplate,
} from "./lib/applicationCapabilities";
import { requireOrgAccess } from "./lib/orgAuth";

export const list = query({
  args: { lineOfBusiness: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const access = await assertCanUseSystemTemplate(ctx);

    const system = await ctx.db
      .query("applicationTemplates")
      .withIndex("by_ownerScope", (q) => q.eq("ownerScope", "system"))
      .collect();

    const broker = await ctx.db
      .query("applicationTemplates")
      .withIndex("by_ownerBrokerOrgId", (q) => q.eq("ownerBrokerOrgId", access.orgId))
      .collect();

    const all = [...system, ...broker];
    if (args.lineOfBusiness) {
      return all.filter((t) => t.lineOfBusiness === args.lineOfBusiness);
    }
    return all;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    lineOfBusiness: v.optional(v.string()),
    questionSet: v.array(
      v.object({
        intentKey: v.optional(v.string()),
        promptOverride: v.optional(v.string()),
        required: v.boolean(),
        conditional: v.optional(v.any()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const access = await assertCanCreateBrokerTemplate(ctx);
    return await ctx.db.insert("applicationTemplates", {
      ownerScope: "broker",
      ownerBrokerOrgId: access.orgId,
      name: args.name,
      description: args.description,
      lineOfBusiness: args.lineOfBusiness,
      questionSet: args.questionSet,
      createdAt: Date.now(),
    });
  },
});

export const fromApplication = mutation({
  args: {
    applicationId: v.id("applications"),
    name: v.string(),
    lineOfBusiness: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireOrgAccess(ctx);
    const app = await ctx.db.get(args.applicationId);
    if (!app || app.brokerOrgId !== access.orgId) throw new Error("Forbidden");
    if (!["sent", "in_progress", "awaiting_review", "complete"].includes(app.status)) {
      throw new Error("Can only save as template once application is sent");
    }

    const questions = await ctx.db
      .query("applicationQuestions")
      .withIndex("by_applicationId", (q) => q.eq("applicationId", args.applicationId))
      .collect();

    const questionSet = questions.map((q) => ({
      intentKey: q.intentKey,
      promptOverride: q.prompt,
      required: q.required,
      conditional: q.conditional,
    }));

    return await ctx.db.insert("applicationTemplates", {
      ownerScope: "broker",
      ownerBrokerOrgId: access.orgId,
      name: args.name,
      description: undefined,
      lineOfBusiness: args.lineOfBusiness ?? app.lineOfBusiness,
      questionSet,
      createdAt: Date.now(),
    });
  },
});
