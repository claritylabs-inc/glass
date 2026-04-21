import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// Internal mutation to create a draft application without requiring an auth session.
// Used by extractApplicationPdf action (which runs in the Convex internal action runtime).
export const createDraftInternal = internalMutation({
  args: {
    brokerOrgId: v.id("organizations"),
    clientOrgId: v.id("organizations"),
    createdByUserId: v.id("users"),
    sourceTemplateId: v.optional(v.id("applicationTemplates")),
    creationPath: v.union(v.literal("custom"), v.literal("ai"), v.literal("template"), v.literal("extracted_pdf")),
    title: v.string(),
    lineOfBusiness: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("applications", {
      brokerOrgId: args.brokerOrgId,
      clientOrgId: args.clientOrgId,
      createdByUserId: args.createdByUserId,
      sourceTemplateId: args.sourceTemplateId,
      creationPath: args.creationPath as "custom" | "ai" | "template" | "extracted_pdf",
      title: args.title,
      lineOfBusiness: args.lineOfBusiness,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const setFilledPdf = internalMutation({
  args: {
    applicationId: v.id("applications"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.applicationId, { filledPdfStorageId: args.storageId });
  },
});

export const getFilledPdfUrl = internalQuery({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const app = await ctx.db.get(args.applicationId);
    if (!app?.filledPdfStorageId) return null;
    return await ctx.storage.getUrl(app.filledPdfStorageId);
  },
});
