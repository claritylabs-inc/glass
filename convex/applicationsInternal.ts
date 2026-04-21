import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

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
